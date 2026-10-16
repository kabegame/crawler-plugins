// @ts-nocheck
// 合集 / 系列 / 收藏夹三种列表页。对应 yt-dlp 的
// BilibiliCollectionListIE / BilibiliSeriesListIE / BilibiliFavoritesListIE。
//
// 与 space.ts 的区别：这三个接口都**不需要 WBI 签名**，只要求 Referer 指向原页面。
// 它们同样只产出 BV 列表，下载复用 video.ts。
import { sleep } from "@kabegame/plugin-sdk";

import { FAV_IDS_API, FAV_LIST_API, LIST_PAGE_SIZE, SEASON_API, SERIES_API, SPACE_BASE } from "./consts";
import { checkBilibiliRisk, coerceStr, fetchJson, isUnavailableTitle } from "./util";

const { warn } = Kabegame;

/**
 * 从列表页链接解析出类型与 id。支持：
 *   space.bilibili.com/<mid>/lists/<sid>?type=season|series
 *   space.bilibili.com/<mid>/channel/collectiondetail?sid=<sid>
 *   space.bilibili.com/<mid>/channel/seriesdetail?sid=<sid>
 *   space.bilibili.com/<mid>/favlist?fid=<fid>
 *   bilibili.com/medialist/detail/ml<fid>
 */
export function parseListUrl(raw) {
  const work = coerceStr(raw).trim();
  const mid = work.match(/space\.bilibili\.com\/(\d+)/)?.[1] || "";

  const fav = work.match(/[?&]fid=(\d+)/)?.[1]
    || work.match(/medialist\/detail\/ml(\d+)/)?.[1];
  if (fav) return { kind: "favlist", mid, sid: fav };

  const seriesDetail = work.match(/channel\/seriesdetail\/?\?.*\bsid=(\d+)/)?.[1];
  if (seriesDetail) return { kind: "series", mid, sid: seriesDetail };

  const collectionDetail = work.match(/channel\/collectiondetail\/?\?.*\bsid=(\d+)/)?.[1];
  if (collectionDetail) return { kind: "season", mid, sid: collectionDetail };

  const lists = work.match(/\/lists\/(\d+)/)?.[1];
  if (lists) {
    // /lists/<sid> 默认是合集；只有显式 type=series 才是系列。
    const kind = /[?&]type=series\b/.test(work) ? "series" : "season";
    return { kind, mid, sid: lists };
  }

  return { kind: "", mid: "", sid: "" };
}

// 合集与系列返回结构几乎一样，只有分页字段名不同：
// season → page.page_size，series → page.size。
async function fetchArchivesPage(target, pageNo, referer) {
  const isSeason = target.kind === "season";
  const url = isSeason
    ? `${SEASON_API}?mid=${target.mid}&season_id=${target.sid}`
      + `&page_num=${pageNo}&page_size=${LIST_PAGE_SIZE}`
    : `${SERIES_API}?mid=${target.mid}&series_id=${target.sid}`
      + `&pn=${pageNo}&ps=${LIST_PAGE_SIZE}`;

  const json = await fetchJson(url, { Referer: referer });
  if (json?.code !== 0) {
    checkBilibiliRisk(json?.code);
    throw new Error(
      `${isSeason ? "合集" : "系列"}接口失败（${json?.code}）: ${coerceStr(json?.message)}`,
    );
  }

  const data = json.data;
  const pageSize = Number((isSeason ? data?.page?.page_size : data?.page?.size) ?? LIST_PAGE_SIZE);
  return {
    archives: Array.isArray(data?.archives) ? data.archives : [],
    total: Number(data?.page?.total ?? 0),
    pageSize: pageSize > 0 ? pageSize : LIST_PAGE_SIZE,
    name: coerceStr(data?.meta?.name),
  };
}

async function collectArchives(target, vars, intervalMs, referer) {
  if (!target.mid) {
    throw new Error("合集 / 系列需要 UP 主 UID，请粘贴完整的 space.bilibili.com 链接");
  }

  const startPage = Math.max(1, Number(vars.start_page ?? 1));
  const endPage = Math.max(startPage, Number(vars.end_page ?? startPage));
  const maxVideos = Math.max(1, Number(vars.max_videos ?? 5));

  const entries = [];
  let dead = 0;
  let total = 0;
  let pageCount = 0;
  let name = "";

  for (let pageNo = startPage; pageNo <= endPage; pageNo += 1) {
    if (entries.length >= maxVideos) break;
    if (pageNo > startPage) await sleep(intervalMs);

    const page = await fetchArchivesPage(target, pageNo, referer);
    total = page.total || total;
    pageCount = Math.ceil(total / page.pageSize);
    if (page.name) name = page.name;
    if (page.archives.length === 0) break;

    for (const item of page.archives) {
      if (entries.length >= maxVideos) break;
      const bvid = coerceStr(item?.bvid);
      if (!bvid) continue;
      const title = coerceStr(item?.title);
      if (isUnavailableTitle(title)) {
        dead += 1;
        continue;
      }
      entries.push({ bvid, title });
    }

    if (pageNo >= pageCount) break;
  }

  if (dead > 0) warn(`列表里有 ${dead} 个已失效稿件，已跳过。`);
  const label = target.kind === "season" ? "合集" : "系列";
  console.log(
    `[bilibili-video] ${label}「${name || target.sid}」共 ${total} 个视频 / ${pageCount} 页，`
    + `本次取第 ${startPage}~${Math.min(endPage, pageCount || endPage)} 页，命中 ${entries.length} 个（上限 ${maxVideos}）`,
  );
  return entries;
}

/**
 * 收藏夹的 ids 接口一次返回全部条目、不分页，所以这里用「起始页」换算 offset，
 * 再按 max_videos 截断——保持和其他列表模式一致的翻页语义。
 */
async function collectFavlist(target, vars, referer) {
  const info = await fetchJson(`${FAV_LIST_API}?media_id=${target.sid}&pn=1&ps=20`, { Referer: referer });
  if (info?.code === -403) {
    throw new Error("这是私密收藏夹：需要以收藏夹所有者的身份登录，请先在畅游登录对应账号。");
  }
  if (info?.code !== 0) {
    checkBilibiliRisk(info?.code);
    throw new Error(`收藏夹信息接口失败（${info?.code}）: ${coerceStr(info?.message)}`);
  }
  const name = coerceStr(info?.data?.info?.title);

  const ids = await fetchJson(`${FAV_IDS_API}?media_id=${target.sid}`, { Referer: referer });
  if (ids?.code !== 0) {
    checkBilibiliRisk(ids?.code);
    throw new Error(`收藏夹条目接口失败（${ids?.code}）: ${coerceStr(ids?.message)}`);
  }

  const all = Array.isArray(ids?.data) ? ids.data : [];
  if (all.length === 0) {
    throw new Error(`收藏夹「${name || target.sid}」是空的（接口返回 0 个条目）。`);
  }

  const startPage = Math.max(1, Number(vars.start_page ?? 1));
  const maxVideos = Math.max(1, Number(vars.max_videos ?? 5));
  const offset = (startPage - 1) * LIST_PAGE_SIZE;

  const entries = [];
  for (const item of all.slice(offset)) {
    if (entries.length >= maxVideos) break;
    // type 2 = 普通视频稿件；其它（音频、专栏等）本插件处理不了。
    if (Number(item?.type ?? 2) !== 2) continue;
    const bvid = coerceStr(item?.bvid);
    if (bvid) entries.push({ bvid, title: "" });
  }

  const skipped = all.length - all.filter((item) => Number(item?.type ?? 2) === 2).length;
  if (skipped > 0) warn(`收藏夹里有 ${skipped} 个非视频条目（音频 / 专栏等）已跳过。`);

  console.log(
    `[bilibili-video] 收藏夹「${name || target.sid}」共 ${all.length} 个条目，`
    + `从第 ${offset + 1} 个起取，命中 ${entries.length} 个（上限 ${maxVideos}）`,
  );
  return entries;
}

/** 统一入口：按链接自动识别合集 / 系列 / 收藏夹，返回 [{ bvid, title }]。 */
export async function collectListEntries(vars, intervalMs) {
  const target = parseListUrl(vars.list_url);
  if (!target.kind) {
    throw new Error(
      "无法识别列表链接。支持合集（/lists/<id> 或 /channel/collectiondetail?sid=）、"
      + "系列（?type=series 或 /channel/seriesdetail?sid=）、收藏夹（?fid= 或 /medialist/detail/ml<id>）",
    );
  }

  const referer = coerceStr(vars.list_url).startsWith("http")
    ? coerceStr(vars.list_url)
    : `${SPACE_BASE}/${target.mid}`;

  const entries = target.kind === "favlist"
    ? await collectFavlist(target, vars, referer)
    : await collectArchives(target, vars, intervalMs, referer);

  if (entries.length === 0) throw new Error("未取到任何视频，请检查链接与页码范围");
  return entries;
}

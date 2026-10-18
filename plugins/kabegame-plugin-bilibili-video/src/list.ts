// 合集 / 系列 / 收藏夹三种列表页。对应 yt-dlp 的
// BilibiliCollectionListIE / BilibiliSeriesListIE / BilibiliFavoritesListIE。
//
// 与 space.ts 的区别：这三个接口都**不需要 WBI 签名**，只要求 Referer 指向原页面。
// 它们同样只产出 BV 列表，下载复用 video.ts。
import { sleep } from "@kabegame/plugin-sdk";

import { FAV_IDS_API, FAV_LIST_API, LIST_PAGE_SIZE, SEASON_API, SERIES_API, SPACE_BASE } from "./consts";
import { t } from "./i18n";
import type { BilibiliVars, ListEntry } from "./types";
import { checkBilibiliRisk, coerceStr, fetchJson, isUnavailableTitle } from "./util";

const { warn } = Kabegame;

/** 列表页类型；"" 表示链接无法识别。 */
type ListKind = "favlist" | "series" | "season" | "";

/** 从列表页链接解析出的目标。 */
type ListTarget = {
  kind: ListKind;
  mid: string;
  sid: string;
};

type ArchiveItem = {
  bvid?: string | null;
  title?: string | null;
};

type ArchivesPage = {
  page?: {
    page_size?: number | null;
    size?: number | null;
    total?: number | null;
  } | null;
  archives?: ArchiveItem[] | null;
  meta?: {
    name?: string | null;
  } | null;
};

type ArchivesResponse = {
  code?: number | null;
  message?: string | null;
  data?: ArchivesPage | null;
};

type FavInfoResponse = {
  code?: number | null;
  message?: string | null;
  data?: {
    info?: {
      title?: string | null;
    } | null;
  } | null;
};

type FavResource = {
  type?: number | null;
  bvid?: string | null;
};

type FavIdsResponse = {
  code?: number | null;
  message?: string | null;
  data?: FavResource[] | null;
};

type ArchivesPageResult = {
  archives: ArchiveItem[];
  total: number;
  pageSize: number;
  name: string;
};

/**
 * 从列表页链接解析出类型与 id。支持：
 *   space.bilibili.com/<mid>/lists/<sid>?type=season|series
 *   space.bilibili.com/<mid>/channel/collectiondetail?sid=<sid>
 *   space.bilibili.com/<mid>/channel/seriesdetail?sid=<sid>
 *   space.bilibili.com/<mid>/favlist?fid=<fid>
 *   bilibili.com/medialist/detail/ml<fid>
 */
export function parseListUrl(raw: unknown): ListTarget {
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
    const kind: ListKind = /[?&]type=series\b/.test(work) ? "series" : "season";
    return { kind, mid, sid: lists };
  }

  return { kind: "", mid: "", sid: "" };
}

// 合集与系列返回结构几乎一样，只有分页字段名不同：
// season → page.page_size，series → page.size。
async function fetchArchivesPage(
  target: ListTarget,
  pageNo: number,
  referer: string,
): Promise<ArchivesPageResult> {
  const isSeason = target.kind === "season";
  const url = isSeason
    ? `${SEASON_API}?mid=${target.mid}&season_id=${target.sid}`
      + `&page_num=${pageNo}&page_size=${LIST_PAGE_SIZE}`
    : `${SERIES_API}?mid=${target.mid}&series_id=${target.sid}`
      + `&pn=${pageNo}&ps=${LIST_PAGE_SIZE}`;

  const json = await fetchJson<ArchivesResponse>(url, { Referer: referer });
  if (json?.code !== 0) {
    checkBilibiliRisk(json?.code);
    throw new Error(t("archivesFailed", {
      label: isSeason ? t("seasonLabel") : t("seriesLabel"),
      code: json?.code,
      message: coerceStr(json?.message),
    }));
  }

  const data = json.data;
  const pageSize = Number((isSeason ? data?.page?.page_size : data?.page?.size) ?? LIST_PAGE_SIZE);
  const archives = data?.archives;
  return {
    archives: Array.isArray(archives) ? archives : [],
    total: Number(data?.page?.total ?? 0),
    pageSize: pageSize > 0 ? pageSize : LIST_PAGE_SIZE,
    name: coerceStr(data?.meta?.name),
  };
}

async function collectArchives(
  target: ListTarget,
  vars: BilibiliVars,
  intervalMs: number,
  referer: string,
): Promise<ListEntry[]> {
  if (!target.mid) {
    throw new Error(t("archivesMidRequired"));
  }

  const startPage = Math.max(1, Number(vars.start_page ?? 1));
  const endPage = Math.max(startPage, Number(vars.end_page ?? startPage));
  const maxVideos = Math.max(1, Number(vars.max_videos ?? 5));

  const entries: ListEntry[] = [];
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

  if (dead > 0) warn(t("listDeadSkipped", { count: dead }));
  const label = target.kind === "season" ? t("seasonLabel") : t("seriesLabel");
  console.log(t("archivesSummary", {
    label,
    name: name || target.sid,
    total,
    pages: pageCount,
    start: startPage,
    end: Math.min(endPage, pageCount || endPage),
    count: entries.length,
    max: maxVideos,
  }));
  return entries;
}

/**
 * 收藏夹的 ids 接口一次返回全部条目、不分页，所以这里用「起始页」换算 offset，
 * 再按 max_videos 截断——保持和其他列表模式一致的翻页语义。
 */
async function collectFavlist(
  target: ListTarget,
  vars: BilibiliVars,
  referer: string,
): Promise<ListEntry[]> {
  const info = await fetchJson<FavInfoResponse>(
    `${FAV_LIST_API}?media_id=${target.sid}&pn=1&ps=20`,
    { Referer: referer },
  );
  if (info?.code === -403) {
    throw new Error(t("privateFavlist"));
  }
  if (info?.code !== 0) {
    checkBilibiliRisk(info?.code);
    throw new Error(t("favInfoFailed", { code: info?.code, message: coerceStr(info?.message) }));
  }
  const name = coerceStr(info?.data?.info?.title);

  const ids = await fetchJson<FavIdsResponse>(`${FAV_IDS_API}?media_id=${target.sid}`, {
    Referer: referer,
  });
  if (ids?.code !== 0) {
    checkBilibiliRisk(ids?.code);
    throw new Error(t("favIdsFailed", { code: ids?.code, message: coerceStr(ids?.message) }));
  }

  const idList = ids?.data;
  const all: FavResource[] = Array.isArray(idList) ? idList : [];
  if (all.length === 0) {
    throw new Error(t("favEmpty", { name: name || target.sid }));
  }

  const startPage = Math.max(1, Number(vars.start_page ?? 1));
  const maxVideos = Math.max(1, Number(vars.max_videos ?? 5));
  const offset = (startPage - 1) * LIST_PAGE_SIZE;

  const entries: ListEntry[] = [];
  for (const item of all.slice(offset)) {
    if (entries.length >= maxVideos) break;
    // type 2 = 普通视频稿件；其它（音频、专栏等）本插件处理不了。
    if (Number(item?.type ?? 2) !== 2) continue;
    const bvid = coerceStr(item?.bvid);
    if (bvid) entries.push({ bvid, title: "" });
  }

  const skipped = all.length - all.filter((item) => Number(item?.type ?? 2) === 2).length;
  if (skipped > 0) warn(t("favNonVideoSkipped", { count: skipped }));

  console.log(t("favSummary", {
    name: name || target.sid,
    total: all.length,
    offset: offset + 1,
    count: entries.length,
    max: maxVideos,
  }));
  return entries;
}

/** 统一入口：按链接自动识别合集 / 系列 / 收藏夹，返回 [{ bvid, title }]。 */
export async function collectListEntries(
  vars: BilibiliVars,
  intervalMs: number,
): Promise<ListEntry[]> {
  const target = parseListUrl(vars.list_url);
  if (!target.kind) {
    throw new Error(t("listUrlUnrecognized"));
  }

  const referer = coerceStr(vars.list_url).startsWith("http")
    ? coerceStr(vars.list_url)
    : `${SPACE_BASE}/${target.mid}`;

  const entries = target.kind === "favlist"
    ? await collectFavlist(target, vars, referer)
    : await collectArchives(target, vars, intervalMs, referer);

  if (entries.length === 0) throw new Error(t("listEmpty"));
  return entries;
}

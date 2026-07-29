// @ts-nocheck
// UP 主投稿列表（space.bilibili.com/<mid>/video）。
// 对应 yt-dlp `BilibiliSpaceVideoIE`；它只产出 BV 列表，下载复用 video.ts。
import { sleep } from "@kabegame/plugin-sdk";

import { SPACE_API, SPACE_BASE, SPACE_PAGE_SIZE } from "./consts";
import { checkBilibiliRisk, coerceStr, fetchJson, isUnavailableTitle, nowSeconds, parseMid } from "./util";
import { buildDmParams, signQuery } from "./wbi";

const { warn } = Kabegame;

/**
 * space 接口的风控比 playurl 严得多：翻页太快就吃 412 / -401 / -352。
 * 这三种都不该重试，直接终止让用户改天再来（yt-dlp 同样处理）。
 */
function checkSpaceBlocked(code) {
  if (code === -401 || code === -352 || code === 412) {
    throw new Error(
      `UP 主投稿接口被风控拦截（${code}）：请稍后再试，或先在畅游登录 bilibili 降低触发概率。`,
    );
  }
}

async function fetchSpacePage(mid, pageNo, order, keys) {
  const params = {
    mid,
    keyword: "",
    order: order || "pubdate",
    order_avoided: "true",
    platform: "web",
    pn: String(pageNo),
    ps: String(SPACE_PAGE_SIZE),
    tid: "0",
    special_type: "",
    index: "0",
    web_location: "333.1387",
    wts: String(nowSeconds()),
    ...buildDmParams(),
  };
  // space 接口校验来源，必须是 space 域而非 www；缺 Accept-Language 也更容易被拦。
  const headers = {
    Referer: `${SPACE_BASE}/${mid}/video`,
    Origin: SPACE_BASE,
    "Accept-Language": "en,zh-CN;q=0.9,zh;q=0.8",
  };

  let json;
  try {
    json = await fetchJson(signQuery(SPACE_API, params, keys.img, keys.sub), headers);
  } catch (error) {
    // fetchJson 对非 2xx 抛 `HTTP <status>`，412 是风控的常见形态。
    if (coerceStr(error?.message).includes("HTTP 412")) checkSpaceBlocked(412);
    throw error;
  }
  if (json?.code !== 0) {
    checkSpaceBlocked(json?.code);
    checkBilibiliRisk(json?.code);
    throw new Error(`UP 主投稿接口失败（${json?.code}）: ${coerceStr(json?.message)}`);
  }
  return json.data;
}

/** 返回 [{ bvid, title }]，按页收集并受 max_videos 截断。页间等待 intervalMs。 */
export async function collectSpaceEntries(vars, keys, intervalMs) {
  const mid = parseMid(vars.mid);
  if (!mid) throw new Error("请填写 UP 主 UID（纯数字）或主页链接（space.bilibili.com/<UID>）");

  const startPage = Math.max(1, Number(vars.start_page ?? 1));
  const endPage = Math.max(startPage, Number(vars.end_page ?? startPage));
  const maxVideos = Math.max(1, Number(vars.max_videos ?? 5));

  const entries = [];
  let dead = 0;
  let totalCount = 0;
  let pageCount = 0;

  for (let pageNo = startPage; pageNo <= endPage; pageNo += 1) {
    if (entries.length >= maxVideos) break;
    if (pageNo > startPage) await sleep(intervalMs);

    const data = await fetchSpacePage(mid, pageNo, coerceStr(vars.order), keys);
    totalCount = Number(data?.page?.count ?? totalCount);
    pageCount = Math.ceil(totalCount / Number(data?.page?.ps ?? SPACE_PAGE_SIZE));

    const vlist = Array.isArray(data?.list?.vlist) ? data.list.vlist : [];
    if (vlist.length === 0) break;

    for (const item of vlist) {
      if (entries.length >= maxVideos) break;
      // attribute 156 = 隐藏模式合集，投稿列表里不展开其视频，需要走合集接口。
      if (Number(item?.meta?.attribute ?? 0) === 156) {
        warn(`跳过隐藏模式合集「${coerceStr(item?.title)}」：需要合集接口，当前插件尚未支持。`);
        continue;
      }
      const bvid = coerceStr(item?.bvid);
      if (!bvid) continue;
      const title = coerceStr(item?.title);
      // 失效稿件仍留在投稿列表里，只是标题被换成占位文案。
      if (isUnavailableTitle(title)) {
        dead += 1;
        continue;
      }
      entries.push({ bvid, title });
    }

    if (pageNo >= pageCount) break;
  }

  console.log(
    `[bilibili-video] UP 主 ${mid} 共 ${totalCount} 个投稿 / ${pageCount} 页，`
    + `本次取第 ${startPage}~${Math.min(endPage, pageCount || endPage)} 页，命中 ${entries.length} 个（上限 ${maxVideos}）`,
  );
  if (dead > 0) warn(`投稿列表里有 ${dead} 个已失效稿件，已跳过。`);
  if (entries.length === 0) throw new Error("未取到任何投稿，请检查 UID 与页码范围");
  return entries;
}

// @ts-nocheck
// bilibili 专栏 / 图文插件入口。
//
// 模块分工：
//   consts  端点与常量           wbi      WBI 签名核心与密钥获取
//   util    取值/HTTP/输入解析    replies  评论区拉取与精简（入 metadata）
//   article 传统专栏（cv）链路    opus     图文帖链路（结构化取图 + 实况图）
//   search  专栏关键词搜索        feed     UP 主图文 / 图文收藏列表
import { sleep } from "@kabegame/plugin-sdk";

import { processOneCv } from "./article";
import { UA } from "./consts";
import { collectFavOpusIds, collectSpaceOpusIds } from "./feed";
import { processOneOpus } from "./opus";
import { collectArticleIds, signSearchUrl } from "./search";
import {
  coerceStr, checkBilibiliRisk, fetchWith509Retry, parseCvIdFromInput, parseMidFromInput, parseOpusIdFromInput,
} from "./util";
import { getWbiKeys } from "./wbi";

const { addProgress, requireCookie, setHeader, warn } = Kabegame;

export async function crawl(_common, custom) {
  const vars = custom || {};
  setHeader("User-Agent", UA);
  setHeader("Referer", "https://www.bilibili.com/");
  setHeader("Origin", "https://www.bilibili.com");

  // 机会注入：从畅游取 B 站 Cookie（脚本拿不到明文）。取不到不阻断——
  // 公开专栏搜索等路径仍可跑；真正需要登录时会在接口返回 -101 处硬失败。
  if (!requireCookie()) {
    warn("未从畅游获取到 B 站 Cookie，将以未登录状态抓取；部分内容可能失败。如需完整结果请先在畅游登录 bilibili。");
  }

  const livePhoto = vars.live_photo !== false;

  if (vars.mode === "single") {
    const opusId = parseOpusIdFromInput(vars.cv_id_or_url);
    if (opusId) {
      let keys = { img: "", sub: "" };
      try {
        keys = await getWbiKeys();
      } catch {
        // Opus image extraction can still work without WBI metadata.
      }
      await processOneOpus(opusId, 100.0, keys.img, keys.sub, livePhoto);
      addProgress(100.0);
      return;
    }
  }

  if (vars.mode === "space" || vars.mode === "favlist") {
    // WBI 只服务于 opus 关联 cv 的元数据与评论，拿不到也不阻断批量取图。
    let keys = { img: "", sub: "" };
    try {
      keys = await getWbiKeys();
    } catch {
      // 同上。
    }
    const maxArticles = Math.max(1, Number(vars.max_articles ?? 20));
    let opusIds;
    if (vars.mode === "space") {
      const mid = parseMidFromInput(vars.mid);
      if (!mid) throw new Error("请填写 UP 主 UID（纯数字）或主页链接（space.bilibili.com/<UID>）");
      opusIds = await collectSpaceOpusIds(mid, maxArticles);
      if (opusIds.length === 0) throw new Error(`UP 主 ${mid} 没有任何图文动态`);
    } else {
      opusIds = await collectFavOpusIds(maxArticles);
      if (opusIds.length === 0) throw new Error("图文收藏是空的（该收藏属于当前登录账号，请确认已在畅游登录 bilibili）");
    }

    console.log(`[bilibili] 共取到 ${opusIds.length} 篇图文（上限 ${maxArticles}），开始逐篇下载`);
    const perOpus = 100.0 / opusIds.length;
    let failed = 0;
    for (let index = 0; index < opusIds.length; index += 1) {
      if (index > 0) await sleep(1000);
      try {
        await processOneOpus(opusIds[index], perOpus, keys.img, keys.sub, livePhoto);
      } catch (error) {
        failed += 1;
        warn(`opus ${opusIds[index]} 下载失败：${coerceStr(error?.message ?? error)}`);
        addProgress(perOpus);
      }
    }
    if (failed > 0 && failed === opusIds.length) throw new Error("所有图文均下载失败");
    if (failed > 0) warn(`共 ${opusIds.length} 篇图文，其中 ${failed} 篇失败。`);
    addProgress(100.0);
    return;
  }

  const keys = await getWbiKeys();
  const allIds = [];
  if (vars.mode === "single") {
    const cvId = parseCvIdFromInput(vars.cv_id_or_url);
    if (!cvId) throw new Error("单篇模式请填写：专栏 cv 数字或 read/cv 链接，或图文帖 opus 链接（含 /opus/）");
    allIds.push({ id: cvId, desc: "" });
  } else {
    const startPage = Number(vars.start_page ?? 1);
    const endPage = Number(vars.end_page ?? startPage);
    if (endPage < startPage) throw new Error("结束页须大于等于起始页");
    for (let page = startPage; page <= endPage; page += 1) {
      const search = await fetchWith509Retry(
        () => signSearchUrl(vars, page, keys.img, keys.sub),
        "搜索接口",
      );
      if (search?.code !== 0) {
        checkBilibiliRisk(search?.code);
        warn(`搜索第 ${page} 页失败: ${coerceStr(search?.message)}`);
      } else {
        allIds.push(...collectArticleIds(search.data));
      }
    }
  }

  if (allIds.length === 0) {
    warn("未找到专栏 id，请检查关键词；若遇风控或接口异常，可先在畅游登录 bilibili 后重试。");
    addProgress(100.0);
    return;
  }

  const perCv = 100.0 / allIds.length;
  for (const row of allIds) {
    await processOneCv(coerceStr(row.id), keys.img, keys.sub, perCv, coerceStr(row.desc));
  }
  addProgress(100.0);
}

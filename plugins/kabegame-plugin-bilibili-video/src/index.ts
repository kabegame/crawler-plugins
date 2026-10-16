// @ts-nocheck
// bilibili 视频下载插件入口。
//
// 接口与签名算法参照 yt-dlp 的 BilibiliBaseIE / BiliBiliIE / BilibiliSpaceVideoIE
// （Unlicense，public domain）：ignore/yt-dlp/yt_dlp/extractor/bilibili.py
// WBI 签名与 bilibili 专栏插件同源，两者用的是同一套 nav mixin key。
//
// 模块分工：
//   consts  端点与常量        wbi     WBI 签名与反爬指纹参数
//   util    取值/HTTP/输入解析 formats DASH 流挑选
//   vfs     Range 分块下载     ingest  DASH 挑流→下载→合流→入库（UGC/PGC 共用）
//   video   单视频链路（view→playurl→ingest）
//   space   UP 主投稿列表      bangumi 番剧 PGC 链路（season→playurl→ingest）
import { sleep } from "@kabegame/plugin-sdk";

import { crawlBangumi, parseBangumiId } from "./bangumi";
import { UA, WEB_BASE } from "./consts";
import { collectListEntries } from "./list";
import { collectSearchEntries } from "./search";
import { collectSpaceEntries } from "./space";
import { coerceStr, parseVideoId } from "./util";
import { cleanupStaleTmp } from "./vfs";
import { downloadWithRetry } from "./video";
import { getWbiKeys } from "./wbi";

const { addProgress, fs, requireCookie, setHeader, warn } = Kabegame;

/** 批量模式共用的下载循环：逐个下、间隔等待、单个失败不中断整批。 */
async function runBatch(entries, keys, vars, intervalMs, retries) {
  const budget = 100.0 / entries.length;
  let failed = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    // 视频之间固定间隔，避免连续 playurl + 大流量下载触发风控。
    if (index > 0) await sleep(intervalMs);
    const title = entry.title ? ` 「${entry.title}」` : "";
    console.log(`[bilibili-video] (${index + 1}/${entries.length}) ${entry.bvid}${title}`);
    try {
      // 批量模式固定只取 P1：一个 23P 的稿件会炸出 23 个文件。
      await downloadWithRetry(entry, keys, vars, budget, 1, intervalMs, retries);
    } catch (error) {
      failed += 1;
      warn(`${entry.bvid} 最终失败：${coerceStr(error?.message ?? error)}`);
      addProgress(budget);
    }
  }

  if (failed === entries.length) throw new Error("所有视频均下载失败");
  if (failed > 0) warn(`共 ${entries.length} 个视频，其中 ${failed} 个失败。`);
}

export async function crawl(_common, custom) {
  const vars = custom || {};
  setHeader("User-Agent", UA);
  setHeader("Referer", `${WEB_BASE}/`);
  setHeader("Origin", WEB_BASE);

  // 机会注入：拿不到 Cookie 也能跑，只是高档位受限。
  if (!requireCookie()) {
    warn("未从畅游获取到 B 站 Cookie，将以未登录状态抓取，画质会被限制。如需高画质请先在畅游登录 bilibili。");
  }

  await cleanupStaleTmp(fs.getRoot());

  const intervalMs = Math.max(0, Number(vars.interval ?? 10)) * 1000;
  const retries = Math.max(0, Number(vars.retries ?? 1));

  const { keys: wbiKeys, isLoggedIn } = await getWbiKeys();
  // 未登录靠 try_look（试看）通常仍能拿到 1080P，但 4K / HDR / 杜比等档位必然缺席。
  if (!isLoggedIn) warn("当前为未登录状态，4K / HDR / 杜比等档位不可用。");
  const keys = { ...wbiKeys, isLoggedIn };

  if (vars.mode === "space") {
    await runBatch(await collectSpaceEntries(vars, keys, intervalMs), keys, vars, intervalMs, retries);
    return;
  }

  if (vars.mode === "list") {
    // 合集 / 系列 / 收藏夹按链接自动识别，这三个接口都不需要 WBI。
    await runBatch(await collectListEntries(vars, intervalMs), keys, vars, intervalMs, retries);
    return;
  }

  if (vars.mode === "search") {
    await runBatch(await collectSearchEntries(vars, keys, intervalMs), keys, vars, intervalMs, retries);
    return;
  }

  if (vars.mode === "bangumi") {
    // PGC 接口不吃 WBI，keys 无需传入。
    await crawlBangumi(vars, intervalMs, retries);
    return;
  }

  const { bvid, aid } = parseVideoId(vars.video);
  if (!bvid && !aid) {
    // 常见误用：把番剧链接贴进「单个视频」。给出可行动的提示而不是笼统报错。
    if (parseBangumiId(vars.video).kind) {
      throw new Error("这是番剧 / 剧集链接，请把「模式」切换为「番剧」再试");
    }
    throw new Error("请填写 BV 号（BV13x41117TL）、av 号（av1074402）或视频链接");
  }
  await downloadWithRetry(
    { bvid, aid }, keys, vars, 100.0, Number(vars.page_index ?? 1), intervalMs, retries,
  );
}

// @ts-nocheck
// 取值归一、日志与分页窗口解析。

import { DEFAULT_END_PAGE, DEFAULT_START_PAGE } from "./consts";

const { warn } = Kabegame;

export function log(message, level) {
  if (level === "warn") {
    warn(String(message ?? ""));
    return;
  }
  console.log(String(message ?? ""));
}

export function coerceStr(value) {
  return value == null ? "" : String(value);
}

export function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 起始页（1 基）→ 内部跳过页数。
 * 分页游标必须从第一页顺次取，所以「从第 N 页开始」= 前 N-1 页只翻页不下载。
 */
export function skipPagesOf(vars) {
  const startPage = toInt(vars.start_page, DEFAULT_START_PAGE);
  return startPage > 1 ? startPage - 1 : 0;
}

/**
 * 全站流的页码窗口：起始页 + 结束页（含）→ { skipPages, maxPages }。
 * 结束页早于起始页时按「只爬起始页」处理，避免整轮空跑。
 */
export function globalPageWindow(vars) {
  const skipPages = skipPagesOf(vars);
  const endPage = toInt(vars.end_page, DEFAULT_END_PAGE);
  if (endPage < skipPages + 1) {
    log(`[PixAI] 结束页 ${endPage} 早于起始页 ${skipPages + 1}，按只爬起始页处理`, "warn");
    return { skipPages, maxPages: skipPages + 1 };
  }
  return { skipPages, maxPages: endPage };
}

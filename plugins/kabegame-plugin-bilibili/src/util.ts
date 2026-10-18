// 通用小工具：取值归一、风控码判定、HTTP JSON、-509 退避、图链与输入解析。
import { sleep } from "@kabegame/plugin-sdk";

import { t } from "./i18n";

const { warn } = Kabegame;

/** B 站接口统一外壳：code=0 成功，出错时 message 给原因；字段按需建模，可能缺失。 */
export type BilibiliResponse<TData = unknown> = {
  code?: number | null;
  message?: string | null;
  data?: TData | null;
};

/** 只关心状态码的接口外壳（请求函数与各响应类型共用）。 */
export type BilibiliStatus = {
  code?: number | null;
};

export function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

/** JSON 对象收窄：排除 null 与数组。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** catch 变量收窄：保持原 `error?.message ?? error` 的字符串回退语义。 */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message != null) return String(message);
  }
  return String(error);
}

// 未登录（-101）：登录态缺失或已失效 → 硬失败终止，提示去畅游登录。
// 风控（-352）：不一定与登录有关，保持告警不中断。
export function checkBilibiliRisk(code: unknown): void {
  if (code === -101) {
    throw new Error(t("loginExpired"));
  }
  if (code === -352) {
    warn(t("riskControl"));
  }
}

export async function fetchJson<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  // 宿主返回的 body 是外部 JSON，断言只出现在这个边界上。
  return (await response.json()) as T;
}

export async function fetchWith509Retry<T extends BilibiliStatus = BilibiliResponse>(
  makeUrl: () => string,
  label: string,
): Promise<T> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const json = await fetchJson<T>(makeUrl());
    if (json?.code !== -509) return json;
    warn(t("rateLimited", { label, attempt, total: 5 }));
    if (attempt >= 5) return json;
    await sleep(3000);
  }
  throw new Error(label);
}

export function ensureHttpsBfs(path: unknown): string {
  const p = coerceStr(path);
  return p.startsWith("//") ? `https:${p}` : p;
}

/** 从 HTML/正文里正则抠 bfs 图链（cv 正文的主路径，opus 的回退路径）。 */
export function collectImageUrlsFromContent(html: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\/\/i[0-2]\.hdslb\.com\/bfs\/(?:article|new_dyn)\/[^"'\s>\\)]+/g;
  let match;
  while ((match = re.exec(coerceStr(html)))) {
    const url = ensureHttpsBfs(match[0]);
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

export function parseCvIdFromInput(raw: unknown): string {
  const work = coerceStr(raw).trim().split(/[?#]/, 1)[0];
  if (/^\d+$/.test(work)) return work;
  return work.match(/cv(\d+)/i)?.[1] || "";
}

export function parseOpusIdFromInput(raw: unknown): string {
  const work = coerceStr(raw).trim().split(/[?#]/, 1)[0];
  const fromPath = work.match(/\/opus\/(\d+)/)?.[1];
  if (fromPath) return fromPath;
  return /^\d{15,}$/.test(work) ? work : "";
}

export function parseMidFromInput(raw: unknown): string {
  const work = coerceStr(raw).trim();
  const fromUrl = work.match(/space\.bilibili\.com\/(\d+)/)?.[1];
  if (fromUrl) return fromUrl;
  return /^\d+$/.test(work) ? work : "";
}

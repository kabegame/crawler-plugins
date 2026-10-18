// 通用小工具：宿主桥接（日志 / 请求头 / 登录提示）、取值归一、文本清洗、风控判定、HTTP JSON。
import { REQUEST_HEADERS } from "./consts";
import { t } from "./i18n";

const { createImageMetadata: createImageMetadataRow, setHeader, warn } = Kabegame;

/** 插件配置（宿主传入的 custom 对象）：键值都是外部来源，由各调用点再收窄。 */
export type XhhVars = Record<string, unknown>;

// 本次任务是否成功从畅游注入了 Cookie（用于失败时给出登录提示）
let cookieAvailable = false;

export function setCookieAvailable(value: unknown): void {
  cookieAvailable = !!value;
}

/** 未登录时给告警补一句去畅游登录的提示；已登录返回空串。 */
export function loginHint(): string {
  return cookieAvailable ? "" : t("loginHint");
}

export function setRequestHeaders(): void {
  for (const [key, value] of Object.entries(REQUEST_HEADERS)) {
    setHeader(key, value);
  }
}

export function log(message: unknown, level?: string): void {
  if (level === "warn") {
    warn(String(message ?? ""));
    return;
  }
  console.log(String(message ?? ""));
}

export const createImageMetadata = (metadata: KabegameJsonValue): number =>
  Number(createImageMetadataRow(metadata, null));

export function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

/**
 * 把 catch 到的未知值收窄成字符串：优先取 `message`，否则退化成 `String(error)`。
 * 与原先 `coerceStr(error?.message ?? error)` 的回退语义一致。
 */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message != null) return String(message);
  }
  return String(error);
}

export function stripTags(html: unknown): string {
  return coerceStr(html).replace(/<[^>]*>/g, "");
}

export function stripUrlQuery(url: unknown): string {
  return coerceStr(url).split("?", 1)[0];
}

export function stripEmojiBracketTokens(value: unknown): string {
  return coerceStr(value)
    .replace(/\[[a-z]+_[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function validHttpUrl(url: unknown): boolean {
  return /^https?:\/\//i.test(coerceStr(url));
}

export function extractLinkId(shareUrl: unknown): string {
  if (!shareUrl) return "";
  const match = String(shareUrl).match(/[?&]link_id=([^&#]+)/);
  return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
}

export function isChallenge(status: unknown): boolean {
  const s = String(status ?? "");
  return s === "show_captcha" || s === "need_verify" || s.includes("captcha");
}

export function challengeError(where: unknown, status: unknown): never {
  throw new Error(t("challengeError", { where, status: status ?? "nil" }));
}

export async function fetchJson<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url);
  // 站点 JSON 是外部边界：在这里声明响应的静态形状，调用方按需收窄具体字段。
  return (await response.json()) as T;
}

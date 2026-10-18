// 通用工具：取值归一、JSON 请求（含登录失效识别）、输入解析。
import { md5, sleep } from "@kabegame/plugin-sdk";

import { SUPERTOPIC_PREFIX } from "./consts";
import { t } from "./i18n";
import type { WeiboJsonObject, WeiboUserInput } from "./types";

export function str(value: unknown): string {
  return value == null ? "" : String(value);
}

/**
 * 取对象：非对象/数组一律当空对象。返回值可在外部 JSON 边界标注为目标结构，
 * 所以这里是唯一允许做类型断言的地方（站点 JSON 的形状由调用处约定）。
 */
export function record<T = WeiboJsonObject>(value: unknown): T {
  return (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as T;
}

/** 随机抖动的间隔，避免固定节奏。 */
export function pause(ms: number): Promise<void> {
  return sleep(ms + Math.floor(Math.random() * ms * 0.5));
}

export class LoginError extends Error {}

function loginError() {
  return new LoginError(t("loginExpired"));
}

/** 统一把 catch 到的值转成可展示字符串，语义同原来的 `error?.message ?? error`。 */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message != null) return String(message);
  }
  return String(error);
}

/**
 * GET JSON。被重定向到 passport.weibo.com 或返回 ok=-100 时视为未登录，抛 LoginError 终止任务；
 * 其余非 2xx 抛普通 Error，由调用方决定跳过还是中断。
 */
export async function fetchJson<T = unknown>(url: string, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(url, headers ? { headers } : undefined);
  if (str(response.url).includes("passport.weibo.com")) throw loginError();
  const body = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    // 非 JSON：多半是登录页或风控页
  }
  const payload = record(json);
  if (payload.ok === -100) throw loginError();
  if (!response.ok) {
    const msg = str(payload.msg || payload.message || body.slice(0, 80));
    throw new Error(`HTTP ${response.status}: ${msg}`);
  }
  if (json == null) throw new Error(t("notJson", { body: body.slice(0, 80) }));
  return json as T;
}

export async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, { headers: { Accept: "text/html,application/xhtml+xml" } });
  if (str(response.url).includes("passport.weibo.com")) throw loginError();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
}

export function https(url: unknown): string {
  const u = str(url);
  if (u.startsWith("//")) return `https:${u}`;
  return u.replace(/^http:\/\//i, "https://");
}

/** "Thu Oct 15 12:00:00 +0800 2026" → ISO 字符串；解析失败原样返回。 */
export function isoTime(value: unknown): string {
  const raw = str(value);
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

/**
 * 用户输入 → { uid } | { custom } | { screenName }。
 * 支持：纯数字 UID、weibo.com/u/<uid>、weibo.com/<uid>、weibo.com/n/<昵称>、weibo.com/<个性域名>、
 * m.weibo.cn/u/<uid>、m.weibo.cn/profile/<uid>，其余按昵称处理。
 */
export function parseUserInput(raw: unknown): WeiboUserInput | null {
  const text = str(raw).trim().replace(/^@/, "");
  if (!text) return null;
  if (/^\d{5,}$/.test(text)) return { uid: text };
  const m = text.match(/^(?:https?:\/\/)?(?:www\.|m\.)?weibo\.(?:com|cn)\/([^?#]*)/i);
  if (!m) return { screenName: text };
  const parts = m[1].split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  if (parts.length === 0) return null;
  if ((parts[0] === "u" || parts[0] === "profile") && /^\d+$/.test(parts[1] || "")) return { uid: parts[1] };
  if (parts[0] === "n" && parts[1]) return { screenName: parts[1] };
  if (/^\d{5,}$/.test(parts[0])) return { uid: parts[0] };
  return { custom: parts[0] };
}

/**
 * 单条微博链接 → id（mblogid 或数字 mid，statuses/show 两者都接受）。
 * 支持：weibo.com/<uid>/<mblogid|mid>、weibo.com/detail/<mid>、m.weibo.cn/detail/<mid>、
 * m.weibo.cn/status/<id>、纯 id。
 */
export function parsePostInput(raw: unknown): string {
  const text = str(raw).trim();
  if (!text) return "";
  if (/^[A-Za-z0-9]{9}$|^\d{16}$/.test(text)) return text;
  const path = text.replace(/^(?:https?:\/\/)?[^/]+/, "").split(/[?#]/, 1)[0];
  const parts = path.split("/").filter(Boolean);
  if ((parts[0] === "detail" || parts[0] === "status") && parts[1]) return parts[1];
  if (parts.length >= 2 && /^\d+$/.test(parts[0])) return parts[1];
  return "";
}

/**
 * 超话输入 → 超话 id（100808 + 32 位 hex）。
 * 支持：超话名（原神 / 原神超话 / #原神[超话]#）、weibo.com/p/100808…、huati.weibo.com/k/<名>、裸 id。
 * id 的后 32 位是超话名的 md5，所以名字可以直接换算，无需搜索。
 */
export function parseSupertopicInput(raw: unknown): string {
  const text = str(raw).trim();
  if (!text) return "";
  const idMatch = text.match(/100808[0-9a-f]{32}/i);
  if (idMatch) return idMatch[0].toLowerCase();
  const huati = text.match(/huati\.weibo\.com\/k\/([^/?#]+)/i);
  let name = huati ? decodeURIComponent(huati[1]) : text;
  name = name.replace(/^#/, "").replace(/#$/, "").replace(/\[超话\]$/, "").replace(/超话$/, "").trim();
  return name ? `${SUPERTOPIC_PREFIX}${md5(name)}` : "";
}

// @ts-nocheck
// 通用小工具：取值归一、风控码判定、HTTP JSON、-509 退避、图链与输入解析。
import { sleep } from "@kabegame/plugin-sdk";

const { warn } = Kabegame;

export function coerceStr(value) {
  return value == null ? "" : String(value);
}

// 未登录（-101）：登录态缺失或已失效 → 硬失败终止，提示去畅游登录。
// 风控（-352）：不一定与登录有关，保持告警不中断。
export function checkBilibiliRisk(code) {
  if (code === -101) {
    throw new Error("B 站接口返回未登录（-101）：未获取到有效登录态，请先在畅游登录 bilibili 后重试。");
  }
  if (code === -352) {
    warn("B 站接口触发风控（-352），可稍后重试或更换网络；若持续失败请在畅游重新登录 bilibili。");
  }
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

export async function fetchWith509Retry(makeUrl, label) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const json = await fetchJson(makeUrl());
    if (json?.code !== -509) return json;
    warn(`${label} -509 过于频繁，${attempt}/5`);
    if (attempt >= 5) return json;
    await sleep(3000);
  }
  throw new Error(label);
}

export function ensureHttpsBfs(path) {
  const p = coerceStr(path);
  return p.startsWith("//") ? `https:${p}` : p;
}

/** 从 HTML/正文里正则抠 bfs 图链（cv 正文的主路径，opus 的回退路径）。 */
export function collectImageUrlsFromContent(html) {
  const out = [];
  const seen = new Set();
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

export function parseCvIdFromInput(raw) {
  const work = coerceStr(raw).trim().split(/[?#]/, 1)[0];
  if (/^\d+$/.test(work)) return work;
  return work.match(/cv(\d+)/i)?.[1] || "";
}

export function parseOpusIdFromInput(raw) {
  const work = coerceStr(raw).trim().split(/[?#]/, 1)[0];
  const fromPath = work.match(/\/opus\/(\d+)/)?.[1];
  if (fromPath) return fromPath;
  return /^\d{15,}$/.test(work) ? work : "";
}

export function parseMidFromInput(raw) {
  const work = coerceStr(raw).trim();
  const fromUrl = work.match(/space\.bilibili\.com\/(\d+)/)?.[1];
  if (fromUrl) return fromUrl;
  return /^\d+$/.test(work) ? work : "";
}

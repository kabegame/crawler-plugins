/**
 * 抓取米游社 userPostList 连续两页（作者帖子流）。
 *
 * 用法：
 *   # 最简（若接口当前对匿名可用）
 *   node src-crawler-plugins/plugins/miyoushe/scripts/fetch-user-post-list.mjs --uid 389769816
 *
 *   # 带 Cookie / DS / x-rpc-*（推荐按抓包还原）
 *   MYS_COOKIE="cookie_token=...; account_id=...;" \
 *   MYS_DS="1775213364,xxxx,xxxxxxxx" \
 *   MYS_DEVICE_ID="9a215eab-b4c7-43a2-9ee6-bca0c4fe7d76" \
 *   MYS_DEVICE_FP="38d81728d34a6" \
 *   MYS_APP_VERSION="2.102.0" \
 *   MYS_CLIENT_TYPE="4" \
 *   node src-crawler-plugins/plugins/miyoushe/scripts/fetch-user-post-list.mjs --uid 389769816
 *
 *   # 手动指定第二页 offset（不指定则自动从第一页响应推导）
 *   node .../fetch-user-post-list.mjs --uid 389769816 --offset 73376481
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_DIR = join(__dirname, "..", "json");

const API_BASE = "https://bbs-api.miyoushe.com";
const API_PATH = "/painter/wapi/userPostList";
const DEFAULT_SIZE = 20;

function parseArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return "";
}

function requireArg(name) {
  const v = parseArg(name);
  if (!v) throw new Error(`缺少参数 ${name}`);
  return v;
}

function buildHeaders() {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    Referer: "https://www.miyoushe.com/",
    Origin: "https://www.miyoushe.com",
    "x-rpc-app_version": process.env.MYS_APP_VERSION || "2.102.0",
    "x-rpc-client_type": process.env.MYS_CLIENT_TYPE || "4",
  };

  if (process.env.MYS_COOKIE) headers.Cookie = process.env.MYS_COOKIE;
  if (process.env.MYS_DS) headers.DS = process.env.MYS_DS;
  if (process.env.MYS_DEVICE_ID) headers["x-rpc-device_id"] = process.env.MYS_DEVICE_ID;
  if (process.env.MYS_DEVICE_FP) headers["x-rpc-device_fp"] = process.env.MYS_DEVICE_FP;

  return headers;
}

function buildUrl(uid, size, offset = "") {
  const q = new URLSearchParams({
    uid: String(uid),
    size: String(size),
  });
  if (offset !== "") q.set("offset", String(offset));
  return `${API_BASE}${API_PATH}?${q.toString()}`;
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`非 JSON 响应 HTTP ${res.status} url=${url} 前 200 字: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} retcode=${body?.retcode} message=${body?.message} url=${url}`);
  }
  return body;
}

function pickNextOffset(body) {
  const d = body?.data || {};
  // 兼容不同命名，优先 next_offset / offset
  if (d.next_offset != null && d.next_offset !== "") return String(d.next_offset);
  if (d.offset != null && d.offset !== "") return String(d.offset);
  if (d.last_id != null && d.last_id !== "") return String(d.last_id);

  // 某些场景仅给列表，兜底取最后一条 post_id 作为 offset（与你提供样例一致）
  const list = Array.isArray(d.list) ? d.list : [];
  const last = list.length ? list[list.length - 1] : null;
  const pid = last?.post?.post_id;
  if (pid != null && pid !== "") return String(pid);
  return "";
}

function ensureOk(body, tag) {
  if (body?.retcode !== 0) {
    throw new Error(`${tag} retcode=${body?.retcode} message=${body?.message || ""}`);
  }
}

async function main() {
  const uid = requireArg("--uid");
  const size = Number(parseArg("--size") || DEFAULT_SIZE);
  const offsetArg = parseArg("--offset");
  const headers = buildHeaders();

  mkdirSync(JSON_DIR, { recursive: true });

  const p1Url = buildUrl(uid, size);
  const p1 = await fetchJson(p1Url, headers);
  ensureOk(p1, "page1");
  const p1Out = join(JSON_DIR, `userPostList-uid_${uid}-p1.json`);
  writeFileSync(p1Out, JSON.stringify(p1, null, 2), "utf8");
  console.log(`已写入: ${p1Out}`);

  const nextOffset = offsetArg || pickNextOffset(p1);
  if (!nextOffset) {
    console.warn("未能从第一页推导 next offset，跳过第二页。可通过 --offset 手动传入。");
    return;
  }

  const p2Url = buildUrl(uid, size, nextOffset);
  const p2 = await fetchJson(p2Url, headers);
  ensureOk(p2, "page2");
  const p2Out = join(JSON_DIR, `userPostList-uid_${uid}-p2-offset_${nextOffset}.json`);
  writeFileSync(p2Out, JSON.stringify(p2, null, 2), "utf8");
  console.log(`已写入: ${p2Out}`);
  console.log(`uid=${uid} size=${size} page2_offset=${nextOffset}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


/**
 * 连续请求 GET /bbs/app/link/tree，观察第几次出现 show_captcha 等风控。
 * - 默认：无 Cookie（与 items-api.md 无 Cookie 场景一致）。
 * - 带 Cookie：设置环境变量 HEYBOX_COOKIE（浏览器里整段复制即可），会解析 heybox_id 写入 query。
 *
 * 用法：
 *   node probe-tree-nocookie-limit.mjs
 *   HEYBOX_COOKIE='...' node probe-tree-nocookie-limit.mjs
 *
 * 依赖：与 xhh-sign-test.mjs 相同的 hkey 算法。
 */
import crypto from "node:crypto";

const CHARSET = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";

function mapStringWithCharset(str, charset, sliceEnd) {
  const pool = charset.slice(0, sliceEnd);
  let out = "";
  for (let i = 0; i < str.length; i++) {
    out += pool[str.charCodeAt(i) % pool.length];
  }
  return out;
}
function substituteByIndex(str, charset) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    out += charset[str.charCodeAt(i) % charset.length];
  }
  return out;
}
function interleaveColumnMajor(parts) {
  const maxLen = Math.max(...parts.map((p) => p.length));
  let t = "";
  for (let r = 0; r < maxLen; r++) {
    for (const s of parts) {
      if (r < s.length) t += s[r];
    }
  }
  return t;
}
function Vm(e) {
  return 128 & e ? 255 & ((e << 1) ^ 27) : e << 1;
}
function qm(e) {
  return Vm(e) ^ e;
}
function $m(e) {
  return qm(Vm(e));
}
function Ym(e) {
  return $m(qm(Vm(e)));
}
function Gm(e) {
  return Ym(e) ^ $m(e) ^ qm(e);
}
function mixFourBytesInPlace(e) {
  const t = [0, 0, 0, 0];
  t[0] = Gm(e[0]) ^ Ym(e[1]) ^ $m(e[2]) ^ qm(e[3]);
  t[1] = qm(e[0]) ^ Gm(e[1]) ^ Ym(e[2]) ^ $m(e[3]);
  t[2] = $m(e[0]) ^ qm(e[1]) ^ Gm(e[2]) ^ Ym(e[3]);
  t[3] = Ym(e[0]) ^ $m(e[1]) ^ qm(e[2]) ^ Gm(e[3]);
  e[0] = t[0];
  e[1] = t[1];
  e[2] = t[2];
  e[3] = t[3];
  return e;
}
function normalizeRequestPath(urlOrPath) {
  const trimmed = urlOrPath.trim();
  const pathOnly = trimmed.includes("://") ? new URL(trimmed).pathname : trimmed;
  const segs = pathOnly.split("/").filter(Boolean);
  return `/${segs.join("/")}/`;
}
function computeHkey(requestPath, timeSec, nonceUpper) {
  const pathNorm = normalizeRequestPath(requestPath);
  const tInner = timeSec + 1;
  const partA = mapStringWithCharset(String(tInner), CHARSET, -2);
  const partB = substituteByIndex(pathNorm, CHARSET);
  const partC = substituteByIndex(nonceUpper, CHARSET);
  const interleaved = interleaveColumnMajor([partA, partB, partC]).slice(0, 20);
  const md5hex = crypto.createHash("md5").update(interleaved, "utf8").digest("hex");
  const last6Codes = md5hex
    .slice(-6)
    .split("")
    .map((c) => c.charCodeAt(0));
  mixFourBytesInPlace(last6Codes);
  const twoDigit = String(last6Codes.reduce((a, b) => a + b, 0) % 100).padStart(2, "0");
  const prefix = mapStringWithCharset(md5hex.substring(0, 5), CHARSET, -4);
  return `${prefix}${twoDigit}`;
}
function computeNonce(timeSec) {
  const raw = String(timeSec) + String(Math.random());
  return crypto.createHash("md5").update(raw, "utf8").digest("hex").toUpperCase();
}

const PATH_SEARCH = "/bbs/app/api/general/search/v1";
const PATH_TREE = "/bbs/app/link/tree";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

function parseHeyboxIdFromCookie(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== "string") return "";
  const m = /(?:^|;\s*)(?:user_)?heybox_id=(\d+)/i.exec(cookieHeader.trim());
  return m ? m[1] : "";
}

function buildHeaders(cookieHeader) {
  const h = {
    Accept: "*/*",
    Origin: "https://www.xiaoheihe.cn",
    Referer: "https://www.xiaoheihe.cn/",
    "User-Agent": UA,
  };
  if (cookieHeader && String(cookieHeader).length > 0) {
    h.Cookie = String(cookieHeader).trim();
  }
  return h;
}

function buildSignedUrl(pathname, extraParams, heyboxId) {
  const nowSec = Math.floor(Date.now() / 1000);
  const nonce = computeNonce(nowSec);
  const hkey = computeHkey(pathname, nowSec, nonce);
  const base = {
    os_type: "web",
    app: "heybox",
    client_type: "web",
    version: "999.0.4",
    web_version: "2.5",
    x_client_type: "web",
    x_app: "heybox_website",
    heybox_id: heyboxId != null && String(heyboxId).length > 0 ? String(heyboxId) : "",
    x_os_type: "Windows",
    device_info: "Chrome",
    device_id: "e74176167abd6d974278328a8175b855",
    hkey,
    _time: String(nowSec),
    nonce,
  };
  const params = new URLSearchParams({ ...base, ...extraParams });
  return `https://api.xiaoheihe.cn${pathname}?${params.toString()}`;
}

async function fetchSearchFirstPage(headers, heyboxId) {
  const url = buildSignedUrl(
    PATH_SEARCH,
    {
      q: "软香",
      search_type: "general",
      is_pull_down: "0",
      dw: "628",
      offset: "0",
      limit: "30",
      no_more: "false",
    },
    heyboxId,
  );
  const res = await fetch(url, { headers });
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`search 非 JSON HTTP ${res.status} 前200: ${text.slice(0, 200)}`);
  }
  return { http: res.status, j, url: url.slice(0, 120) + "…" };
}

async function fetchTree(linkId, hSrc, headers, heyboxId) {
  const extra = {
    link_id: String(linkId),
    is_first: "1",
    page: "1",
    index: "1",
    limit: "20",
    owner_only: "0",
  };
  if (hSrc != null && String(hSrc).length > 0) extra.h_src = String(hSrc);
  const url = buildSignedUrl(PATH_TREE, extra, heyboxId);
  const res = await fetch(url, { headers });
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { http: res.status, status: "parse_error", rawHead: text.slice(0, 160), linkId };
  }
  return {
    http: res.status,
    status: j.status,
    msg: j.msg,
    resultKeys: j.result && typeof j.result === "object" ? Object.keys(j.result) : [],
    linkId,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cookie = process.env.HEYBOX_COOKIE ?? "";
  const hasCookie = cookie.length > 0;
  const heyboxId = parseHeyboxIdFromCookie(cookie);
  const headers = buildHeaders(hasCookie ? cookie : undefined);
  console.log("模式:", hasCookie ? "带 HEYBOX_COOKIE" : "无 Cookie", hasCookie ? `(heybox_id query=${heyboxId || "(未从 Cookie 解析到)"})` : "");

  console.log("--- 1) 搜索一页，收集 linkid ---");
  const { http, j } = await fetchSearchFirstPage(headers, heyboxId);
  if (http !== 200) console.warn("search HTTP", http);
  const st = j.status;
  if (st !== "ok") {
    console.log("搜索未 ok:", st, j.msg, JSON.stringify(j).slice(0, 400));
    process.exit(1);
  }
  const items = Array.isArray(j.result?.items) ? j.result.items : [];
  const rows = [];
  for (const it of items) {
    if (it?.type === "link" && it.info?.linkid != null) {
      rows.push({ linkid: it.info.linkid, h_src: it.info.h_src });
    }
  }
  console.log("items 总数:", items.length, "其中 link 条数:", rows.length);
  if (rows.length === 0) {
    console.log("无 linkid，结束");
    process.exit(1);
  }

  console.log("--- 2) 按列表顺序依次 tree（每次现算签名 + 带 h_src），间隔 150ms ---");
  let n = 0;
  for (const row of rows) {
    n += 1;
    const r = await fetchTree(row.linkid, row.h_src, headers, heyboxId);
    const risk =
      r.status === "show_captcha" ||
      r.status === "need_captcha" ||
      (r.status && String(r.status).includes("captcha"));
    console.log(`#${n} link_id=${row.linkid} http=${r.http} status=${r.status}`, r.msg != null ? `msg=${r.msg}` : "", risk ? ">>> 风控特征 <<<" : "");
    if (r.status === "parse_error") {
      console.log("  raw:", r.rawHead);
      break;
    }
    if (risk) {
      console.log("\n结论: 第", n, "次 tree 请求触发风控类 status:", r.status);
      process.exit(0);
    }
    if (r.status !== "ok") {
      console.log("\n结论: 第", n, "次 tree 非 ok 非 captcha，result.keys:", r.resultKeys);
      await sleep(150);
      continue;
    }
    await sleep(150);
  }
  console.log("\n结论: 本轮连续", n, "次 tree 均为 ok，未在本轮触发 show_captcha（可能因样本数、IP、时间窗口变化）。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

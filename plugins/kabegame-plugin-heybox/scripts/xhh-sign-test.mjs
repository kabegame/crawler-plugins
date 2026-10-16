/**
 * 与 xhh.js 中 Web 端请求签名一致：路径 + 秒级时间 + 随机 nonce -> hkey
 * 仅用于本地验证算法，非产品代码。
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

/** 按列优先把多段字符串交错拼成一行（与 bundle 内一致） */
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
/** 对 4 字节做一轮类 AES MixColumns 的变换（bundle 内同名逻辑） */
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
  const pathOnly = trimmed.includes("://")
    ? (() => {
        try {
          return new URL(trimmed).pathname;
        } catch {
          return trimmed;
        }
      })()
    : trimmed;
  const segs = pathOnly.split("/").filter(Boolean);
  return `/${segs.join("/")}/`;
}

/**
 * 由「规范化路径、秒级 _time、nonce」生成 hkey（对应 lv.g -> ov(..., _time+1, nonce)）
 */
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

// --- 自测：用你抓包里的 feeds 参数应得到 hkey XTII792 ---
const capturedTime = 1775022418;
const capturedNonce = "0EA78E147DF3177C810D8AA032566199";
const feedsPath = "/bbs/app/feeds";
const expectedHkey = "XTII792";
const got = computeHkey(feedsPath, capturedTime, capturedNonce);
if (got !== expectedHkey) {
  console.error("算法自检失败:", { got, expected: expectedHkey });
  process.exit(1);
}
console.log("算法自检通过: feeds + 抓包 _time/nonce -> hkey", got);

// --- 模拟一次新请求（当前时间）---
const nowSec = Math.floor(Date.now() / 1000);
const nonce = computeNonce(nowSec);
const hkey = computeHkey(feedsPath, nowSec, nonce);

const params = new URLSearchParams({
  pull: "0",
  offset: "0",
  dw: "604",
  os_type: "web",
  app: "heybox",
  x_app: "heybox_website",
  client_type: "web",
  version: "999.0.4",
  web_version: "2.5",
  heybox_id: "",
  x_client_type: "web",
  hkey,
  _time: String(nowSec),
  nonce,
  x_os_type: "Windows",
  device_info: "Chrome",
  device_id: "e74176167abd6d974278328a8175b855",
});

const url = `https://api.xiaoheihe.cn/bbs/app/feeds?${params.toString()}`;
console.log("模拟请求 URL（节选）:", url.slice(0, 120) + "...");
console.log(JSON.stringify({ _time: nowSec, nonce, hkey }, null, 2));

const res = await fetch(url, {
  headers: {
    Accept: "*/*",
    Origin: "https://www.xiaoheihe.cn",
    Referer: "https://www.xiaoheihe.cn/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  },
});
const text = await res.text();
console.log("HTTP", res.status, "body 前 200 字:", text.slice(0, 200));

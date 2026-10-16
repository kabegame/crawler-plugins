/**
 * 调试搜索接口，打印完整响应结构
 * 用法：node debug-search.mjs [关键词]
 */
import crypto from "node:crypto";

const CHARSET = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";
const keyword = process.argv[2] ?? "精美壁纸";

function mapString(str, sliceEnd) {
  const pool = CHARSET.slice(0, sliceEnd);
  return [...str].map(c => pool[c.charCodeAt(0) % pool.length]).join("");
}
function interleave(parts) {
  const maxLen = Math.max(...parts.map(p => p.length));
  let t = "";
  for (let r = 0; r < maxLen; r++) for (const s of parts) if (r < s.length) t += s[r];
  return t;
}
function Vm(e) { return 128 & e ? 255 & ((e << 1) ^ 27) : e << 1; }
function qm(e) { return Vm(e) ^ e; }
function $m(e) { return qm(Vm(e)); }
function Ym(e) { return $m(qm(Vm(e))); }
function Gm(e) { return Ym(e) ^ $m(e) ^ qm(e); }
function mixFour(e) {
  const t = [Gm(e[0])^Ym(e[1])^$m(e[2])^qm(e[3]), qm(e[0])^Gm(e[1])^Ym(e[2])^$m(e[3]),
             $m(e[0])^qm(e[1])^Gm(e[2])^Ym(e[3]), Ym(e[0])^$m(e[1])^qm(e[2])^Gm(e[3])];
  [e[0],e[1],e[2],e[3]] = t;
}
function normPath(p) {
  const path = p.includes("://") ? new URL(p).pathname : p;
  return "/" + path.split("/").filter(Boolean).join("/") + "/";
}
function hkey(path, t, nonce) {
  const pn = normPath(path);
  const a = mapString(String(t+1), -2), b = [...pn].map(c => CHARSET[c.charCodeAt(0)%CHARSET.length]).join(""),
        c = [...nonce].map(c => CHARSET[c.charCodeAt(0)%CHARSET.length]).join("");
  const hex = crypto.createHash("md5").update(interleave([a,b,c]).slice(0,20)).digest("hex");
  const codes = [...hex.slice(-6)].map(c => c.charCodeAt(0));
  mixFour(codes);
  return mapString(hex.slice(0,5), -4) + String(codes.reduce((a,b)=>a+b,0) % 100).padStart(2,"0");
}
function nonce(t) {
  return crypto.createHash("md5").update(String(t)+String(Math.random())).digest("hex").toUpperCase();
}

const t = Math.floor(Date.now()/1000);
const n = nonce(t), h = hkey("/bbs/app/api/general/search/v1", t, n);
const params = new URLSearchParams({
  os_type:"web", app:"heybox", client_type:"web", version:"999.0.4", web_version:"2.5",
  x_client_type:"web", x_app:"heybox_website", heybox_id:"", x_os_type:"Windows",
  device_info:"Chrome", hkey:h, _time:String(t), nonce:n,
  q:keyword, search_type:"general", offset:"0", limit:"30"
});
const url = `https://api.xiaoheihe.cn/bbs/app/api/general/search/v1?${params}`;
const HEADERS = {
  "Accept":"*/*", "Accept-Language":"ja", "Cache-Control":"no-cache",
  "Origin":"https://www.xiaoheihe.cn", "Referer":"https://www.xiaoheihe.cn/",
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
};

console.log("请求:", url, "\n");
const res = await fetch(url, { headers: HEADERS });
const text = await res.text();
console.log("原始响应（前 800 字符）:", text.slice(0, 800), "\n");
const data = JSON.parse(text);

// 打印顶层结构
console.log("顶层 keys:", Object.keys(data));
console.log("status:", data.status);
console.log("result keys:", data.result ? Object.keys(data.result) : "无 result");

const result = data.result ?? {};
// 找所有数组字段
for (const [k, v] of Object.entries(result)) {
  if (Array.isArray(v)) {
    console.log(`result.${k}: array len=${v.length}`);
    if (v.length > 0) {
      console.log(`  [0] keys:`, Object.keys(v[0]));
      if (v[0].info) console.log(`  [0].info keys:`, Object.keys(v[0].info));
    }
  } else if (v && typeof v === "object") {
    console.log(`result.${k}: object keys=`, Object.keys(v));
  } else {
    console.log(`result.${k}:`, v);
  }
}

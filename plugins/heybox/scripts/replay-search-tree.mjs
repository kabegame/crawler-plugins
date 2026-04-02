/**
 * 1) 重放抓包 URL（search + tree，含 Cookie/头）
 * 2) 校验抓包 _time+nonce+路径 是否还原 hkey
 * 3) 用同一套业务参数现算 nonce/hkey 再请求 search → 首条 item 的 linkid/h_src 调 tree
 * 4) 无 Cookie 调 tree（与无痕分享参数一致，用于对照 show_captcha）
 * 5) 同一 search URL：有 Cookie / 无 Cookie，对比 result.items[].info.share_url
 * 6) 无 Cookie 且 device_id 为空：现算 search + tree（观察是否 ok / show_captcha）
 *
 * 用法：node replay-search-tree.mjs
 * Cookie 等敏感信息请自行替换；默认使用你提供的示例串仅作连通性演示。
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
  const pathOnly = trimmed.includes("://")
    ? new URL(trimmed).pathname
    : trimmed;
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

/** 抓包自检：应分别得到 X0PS719、I7VX796 */
const CAPTURED = {
  search: { _time: 1775039288, nonce: "8BCB3109D7D96CDFD7D9D6B129BDAF42", hkey: "X0PS719" },
  tree: { _time: 1775039327, nonce: "E19934B4A5315B5C93CCC9D9BC96A945", hkey: "I7VX796" },
};

const COOKIE =
  "Hm_lvt_dfc8b88f31d0ba1cef80180022f4b3df=1768416560; user_pkey=MTc3NTAyMzc2Mi41Ml84ODk0MzI4NGd6cHFtZmZsaXdtZHVvZHY__; user_heybox_id=88943284; heybox_id=88943284; avatar=https%3A//cdn.max-c.com/app/heybox/icon_83.5@3x.png%3FimageMogr2/thumbnail/%21100p/format/jpg; level=3; nickname=%u73A9%u5BB688943284; x_xhh_tokenid=BbdqyK8yfw+0vuQVVqCicXDfsuq2M+0TaMSDqwHeNO3JXfqh5PmGuMF9BWLo0imqx/brFD2PeATpO/4OnnHnDGQ%3D%3D";

const BROWSER_HEADERS = {
  Accept: "*/*",
  "Accept-Language": "ja,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7,zh;q=0.6,ko;q=0.5",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  Cookie: COOKIE,
  Origin: "https://www.xiaoheihe.cn",
  Pragma: "no-cache",
  Referer: "https://www.xiaoheihe.cn/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

const URL_SEARCH_REPLAY =
  "https://api.xiaoheihe.cn/bbs/app/api/general/search/v1?os_type=web&app=heybox&client_type=web&version=999.0.4&web_version=2.5&x_client_type=web&x_app=heybox_website&heybox_id=88943284&x_os_type=Windows&device_info=Chrome&device_id=e74176167abd6d974278328a8175b855&hkey=X0PS719&_time=1775039288&nonce=8BCB3109D7D96CDFD7D9D6B129BDAF42&q=%E5%8E%9F%E7%A5%9E&search_type=general&is_pull_down=0&dw=628&offset=0&limit=30&no_more=false";

const URL_TREE_REPLAY =
  "https://api.xiaoheihe.cn/bbs/app/link/tree?os_type=web&app=heybox&client_type=web&version=999.0.4&web_version=2.5&x_client_type=web&x_app=heybox_website&heybox_id=88943284&x_os_type=Windows&device_info=Chrome&device_id=e74176167abd6d974278328a8175b855&hkey=I7VX796&_time=1775039327&nonce=E19934B4A5315B5C93CCC9D9BC96A945&h_src=ZXNfZ2VuZXJhbF92MV9fbGlua19pZF9fMTc0MDIxNTY0X19yZXF1ZXN0X2lkX184QkNCMzEwOUQ3RDk2Q0RGRDdEOUQ2QjEyOUJEQUY0Ml9fcXVlcnlfX-WOn-elnl9fc2VuZF9saXN0X2luZGV4X18wX19zZWFyY2hfY2F0ZWdvcmllc19fWyJHQU1FIiwiQ1JFQVRPUiIsIkFDVElWSVRZIiwiTUlOSV9BUFAiXV9fc2VhcmNoX3JlY2FsbF9zcmNfX1sxOSw1XQ==&link_id=174021564&is_first=1&page=1&index=1&limit=20&owner_only=0";

function assertHkey(name, path, rec) {
  const got = computeHkey(path, rec._time, rec.nonce);
  const ok = got === rec.hkey;
  console.log(`[hkey 自检 ${name}] 期望 ${rec.hkey} 得到 ${got} → ${ok ? "OK" : "FAIL"}`);
  return ok;
}

function summarizeJson(text, label) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    console.log(`[${label}] 非 JSON，前 300 字:`, text.slice(0, 300));
    return;
  }
  const status = j.status ?? j.msg;
  const keys = j.result != null && typeof j.result === "object" ? Object.keys(j.result) : [];
  console.log(`[${label}] status 字段:`, status, "result.keys:", keys.slice(0, 12));
  if (label.includes("search") && Array.isArray(j.result?.items)) {
    const first = j.result.items.find((it) => it?.info?.linkid);
    console.log(
      `[${label}] items 条数:`,
      j.result.items.length,
      "首个含 linkid:",
      first?.info?.linkid,
      "h_src 前 40 字:",
      String(first?.info?.h_src ?? "").slice(0, 40),
    );
  }
}

/** 统计 items 中 info.share_url 出现情况（与 items.json 中 info.share_url 字段对照） */
function analyzeSearchItemsShareUrl(items, label) {
  if (!Array.isArray(items)) {
    console.log(`[${label}] 无 result.items 或非数组`);
    return;
  }
  let withInfo = 0;
  let withShareUrl = 0;
  const samples = [];
  for (const it of items) {
    if (!it?.info || typeof it.info !== "object") continue;
    withInfo++;
    const su = it.info.share_url;
    if (su != null && String(su).length > 0) {
      withShareUrl++;
      if (samples.length < 2) {
        samples.push({
          type: it.type,
          linkid: it.info.linkid,
          share_url: String(su).slice(0, 120),
        });
      }
    }
  }
  console.log(`[${label}] items=${items.length} 含 info=${withInfo} 含 info.share_url=${withShareUrl}`);
  if (samples.length) console.log(`[${label}] share_url 示例`, samples);
}

async function main() {
  console.log("--- 1) 抓包三元组 → hkey 是否一致 ---");
  assertHkey("search", PATH_SEARCH, CAPTURED.search);
  assertHkey("tree", PATH_TREE, CAPTURED.tree);
  // 分享入口 tree：无 h_src，link_id 为十六进制短串（抓包见下）
  assertHkey("tree-share", PATH_TREE, {
    _time: 1775039551,
    nonce: "470DF138A1DF5377BA2561F3A5A4D93D",
    hkey: "WVWZ378",
  });
  // 无痕、未登录账号：仅 x_xhh_tokenid，heybox_id 为空
  assertHkey("tree-incognito", PATH_TREE, {
    _time: 1775039757,
    nonce: "FE3B3A82946F982B9672DAA627B51787",
    hkey: "YWDDS78",
  });

  console.log("\n--- 2) 重放抓包 URL（fetch + 与你 curl 相同的头/Cookie）---");
  const r1 = await fetch(URL_SEARCH_REPLAY, { headers: BROWSER_HEADERS });
  const t1 = await r1.text();
  console.log("[重放 search] HTTP", r1.status, "body 长度", t1.length);
  summarizeJson(t1, "重放 search");

  const r2 = await fetch(URL_TREE_REPLAY, { headers: BROWSER_HEADERS });
  const t2 = await r2.text();
  console.log("[重放 tree] HTTP", r2.status, "body 长度", t2.length);
  summarizeJson(t2, "重放 tree");

  console.log("\n--- 3) 客户端现算 nonce/hkey（同一业务参数 + Cookie）---");
  const nowSec = Math.floor(Date.now() / 1000);
  const nonceS = computeNonce(nowSec);
  const hkeyS = computeHkey(PATH_SEARCH, nowSec, nonceS);

  const searchParams = new URLSearchParams({
    os_type: "web",
    app: "heybox",
    client_type: "web",
    version: "999.0.4",
    web_version: "2.5",
    x_client_type: "web",
    x_app: "heybox_website",
    heybox_id: "88943284",
    x_os_type: "Windows",
    device_info: "Chrome",
    device_id: "e74176167abd6d974278328a8175b855",
    hkey: hkeyS,
    _time: String(nowSec),
    nonce: nonceS,
    q: "原神",
    search_type: "general",
    is_pull_down: "0",
    dw: "628",
    offset: "0",
    limit: "30",
    no_more: "false",
  });
  const urlSignedSearch = `https://api.xiaoheihe.cn${PATH_SEARCH}?${searchParams.toString()}`;
  console.log("[现算 search]", { _time: nowSec, nonce: nonceS, hkey: hkeyS });

  const rs = await fetch(urlSignedSearch, { headers: BROWSER_HEADERS });
  const ts = await rs.text();
  console.log("[现算 search] HTTP", rs.status, "body 长度", ts.length);
  let data;
  try {
    data = JSON.parse(ts);
  } catch {
    console.log("解析失败，前 200 字:", ts.slice(0, 200));
    return;
  }
  const first = Array.isArray(data.result?.items)
    ? data.result.items.find((it) => it?.info?.linkid != null)
    : null;
  if (!first?.info?.linkid) {
    console.log("[现算] 未找到带 linkid 的 item，跳过 tree");
    return;
  }
  const linkId = String(first.info.linkid);
  const hSrc = first.info.h_src != null ? String(first.info.h_src) : "";

  const tTree = Math.floor(Date.now() / 1000);
  const nonceT = computeNonce(tTree);
  const hkeyT = computeHkey(PATH_TREE, tTree, nonceT);
  const treeParams = new URLSearchParams({
    os_type: "web",
    app: "heybox",
    client_type: "web",
    version: "999.0.4",
    web_version: "2.5",
    x_client_type: "web",
    x_app: "heybox_website",
    heybox_id: "88943284",
    x_os_type: "Windows",
    device_info: "Chrome",
    device_id: "e74176167abd6d974278328a8175b855",
    hkey: hkeyT,
    _time: String(tTree),
    nonce: nonceT,
    h_src: hSrc,
    link_id: linkId,
    is_first: "1",
    page: "1",
    index: "1",
    limit: "20",
    owner_only: "0",
  });
  const urlSignedTree = `https://api.xiaoheihe.cn${PATH_TREE}?${treeParams.toString()}`;
  console.log("[现算 tree]", { link_id: linkId, h_src_len: hSrc.length, _time: tTree, nonce: nonceT, hkey: hkeyT });

  const rt = await fetch(urlSignedTree, { headers: BROWSER_HEADERS });
  const tt = await rt.text();
  console.log("[现算 tree] HTTP", rt.status, "body 长度", tt.length);
  summarizeJson(tt, "现算 tree");

  console.log("\n--- 4) tree 无 Cookie（现算签名，参数对齐无痕分享：无 h_src、heybox_id 空、hex link_id）---");
  const headersNoCookie = { ...BROWSER_HEADERS };
  delete headersNoCookie.Cookie;
  const tNc = Math.floor(Date.now() / 1000);
  const nonceNc = computeNonce(tNc);
  const hkeyNc = computeHkey(PATH_TREE, tNc, nonceNc);
  const treeParamsNc = new URLSearchParams({
    os_type: "web",
    app: "heybox",
    client_type: "web",
    version: "999.0.4",
    web_version: "2.5",
    x_client_type: "web",
    x_app: "heybox_website",
    heybox_id: "",
    x_os_type: "Windows",
    device_info: "Chrome",
    device_id: "e74176167abd6d974278328a8175b855",
    hkey: hkeyNc,
    _time: String(tNc),
    nonce: nonceNc,
    link_id: "dcbe71750e99",
    is_first: "1",
    page: "1",
    index: "1",
    limit: "20",
    owner_only: "0",
  });
  const urlTreeNoCookie = `https://api.xiaoheihe.cn${PATH_TREE}?${treeParamsNc.toString()}`;
  console.log("[无 Cookie tree]", { _time: tNc, nonce: nonceNc, hkey: hkeyNc });
  const rNc = await fetch(urlTreeNoCookie, { headers: headersNoCookie });
  const tNcBody = await rNc.text();
  console.log("[无 Cookie tree] HTTP", rNc.status, "body 长度", tNcBody.length);
  summarizeJson(tNcBody, "无 Cookie tree");

  console.log("\n--- 5) search 有/无 Cookie：同一现算 URL，对比 info.share_url ---");
  const tCmp = Math.floor(Date.now() / 1000);
  const nonceCmp = computeNonce(tCmp);
  const hkeyCmp = computeHkey(PATH_SEARCH, tCmp, nonceCmp);
  const searchParamsCmp = new URLSearchParams({
    os_type: "web",
    app: "heybox",
    client_type: "web",
    version: "999.0.4",
    web_version: "2.5",
    x_client_type: "web",
    x_app: "heybox_website",
    heybox_id: "88943284",
    x_os_type: "Windows",
    device_info: "Chrome",
    device_id: "e74176167abd6d974278328a8175b855",
    hkey: hkeyCmp,
    _time: String(tCmp),
    nonce: nonceCmp,
    q: "原神",
    search_type: "general",
    is_pull_down: "0",
    dw: "628",
    offset: "0",
    limit: "30",
    no_more: "false",
  });
  const urlSearchSame = `https://api.xiaoheihe.cn${PATH_SEARCH}?${searchParamsCmp.toString()}`;
  const headersNoSearch = { ...BROWSER_HEADERS };
  delete headersNoSearch.Cookie;
  console.log("[对比 search] 同一 URL（节选）", urlSearchSame.slice(0, 100) + "…");

  const rSc = await fetch(urlSearchSame, { headers: BROWSER_HEADERS });
  const txtC = await rSc.text();
  const rSn = await fetch(urlSearchSame, { headers: headersNoSearch });
  const txtN = await rSn.text();
  let jSc;
  let jSn;
  try {
    jSc = JSON.parse(txtC);
  } catch {
    console.log("[search 有 Cookie] JSON 解析失败，前 200 字:", txtC.slice(0, 200));
  }
  try {
    jSn = JSON.parse(txtN);
  } catch {
    console.log("[search 无 Cookie] JSON 解析失败，前 200 字:", txtN.slice(0, 200));
  }
  console.log(
    "[search 有 Cookie] HTTP",
    rSc.status,
    "status:",
    jSc?.status,
    "| [search 无 Cookie] HTTP",
    rSn.status,
    "status:",
    jSn?.status,
  );
  analyzeSearchItemsShareUrl(jSc?.result?.items, "search 有 Cookie");
  analyzeSearchItemsShareUrl(jSn?.result?.items, "search 无 Cookie");

  console.log("\n--- 6) 无 Cookie + device_id 为空（query 仍传 device_id=）---");
  const headersBare = { ...BROWSER_HEADERS };
  delete headersBare.Cookie;

  const t6s = Math.floor(Date.now() / 1000);
  const n6s = computeNonce(t6s);
  const h6s = computeHkey(PATH_SEARCH, t6s, n6s);
  const searchParamsBare = new URLSearchParams({
    os_type: "web",
    app: "heybox",
    client_type: "web",
    version: "999.0.4",
    web_version: "2.5",
    x_client_type: "web",
    x_app: "heybox_website",
    heybox_id: "",
    x_os_type: "Windows",
    device_info: "Chrome",
    device_id: "",
    hkey: h6s,
    _time: String(t6s),
    nonce: n6s,
    q: "原神",
    search_type: "general",
    is_pull_down: "0",
    dw: "628",
    offset: "0",
    limit: "30",
    no_more: "false",
  });
  const urlSearchBare = `https://api.xiaoheihe.cn${PATH_SEARCH}?${searchParamsBare.toString()}`;
  const r6s = await fetch(urlSearchBare, { headers: headersBare });
  const body6s = await r6s.text();
  let j6s;
  try {
    j6s = JSON.parse(body6s);
  } catch {
    console.log("[无Cookie+空device_id search] JSON 失败，前 200 字:", body6s.slice(0, 200));
  }
  console.log("[无Cookie+空device_id search] HTTP", r6s.status, "status:", j6s?.status);
  summarizeJson(body6s, "无Cookie+空device_id search");
  analyzeSearchItemsShareUrl(j6s?.result?.items, "无Cookie+空device_id search");

  const t6t = Math.floor(Date.now() / 1000);
  const n6t = computeNonce(t6t);
  const h6t = computeHkey(PATH_TREE, t6t, n6t);
  const treeParamsBare = new URLSearchParams({
    os_type: "web",
    app: "heybox",
    client_type: "web",
    version: "999.0.4",
    web_version: "2.5",
    x_client_type: "web",
    x_app: "heybox_website",
    heybox_id: "",
    x_os_type: "Windows",
    device_info: "Chrome",
    device_id: "",
    hkey: h6t,
    _time: String(t6t),
    nonce: n6t,
    link_id: "dcbe71750e99",
    is_first: "1",
    page: "1",
    index: "1",
    limit: "20",
    owner_only: "0",
  });
  const urlTreeBare = `https://api.xiaoheihe.cn${PATH_TREE}?${treeParamsBare.toString()}`;
  const r6t = await fetch(urlTreeBare, { headers: headersBare });
  const body6t = await r6t.text();
  console.log("[无Cookie+空device_id tree] HTTP", r6t.status, "body 长度", body6t.length);
  summarizeJson(body6t, "无Cookie+空device_id tree");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * 按 items-api.md §10.3：综合搜索（默认关键词「原神 图片」）→ 对**当前页**每条可进详情的帖子拉 tree →
 * 从 tree 的 result.link.text 解析正文块里 type=img 的缩略图 url，再请求
 * GET /bbs/app/api/original/image?url=<thumb>（签名同 items-api）取 result.imgs 原图 URL 并下载。
 *
 * 默认：offset=0、limit=30（一页）。环境：无 Cookie、query 不传 device_id；tree 与手抓 curl 形态一致。
 *
 * 用法：node download-search-first-item.mjs
 * 单张原图下载成功后默认等待 3s（环境变量 XHH_POST_DOWNLOAD_DELAY_MS 可改）。
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHARSET = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";

/** 综合搜索 q（空格会由 URLSearchParams 编码为 +/%20） */
const SEARCH_Q = "丝柯克 美图";
/** 下载目录名片段（空格改为 -，避免路径里多空格） */
const SEARCH_Q_DIR = SEARCH_Q.replace(/\s+/g, "-");

const SEARCH_OFFSET = 0;
const SEARCH_LIMIT = 30;
/** 相邻两次 tree 请求间隔（毫秒）；整页多帖时需略长，可设环境变量 XHH_TREE_DELAY_MS */
const TREE_DELAY_MS = Number(process.env.XHH_TREE_DELAY_MS ?? "2200");
/** show_captcha 时等待后重试次数 */
const TREE_CAPTCHA_RETRIES = 2;

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
  const md5hex = crypto
    .createHash("md5")
    .update(interleaved, "utf8")
    .digest("hex");
  const last6Codes = md5hex
    .slice(-6)
    .split("")
    .map((c) => c.charCodeAt(0));
  mixFourBytesInPlace(last6Codes);
  const twoDigit = String(last6Codes.reduce((a, b) => a + b, 0) % 100).padStart(
    2,
    "0",
  );
  const prefix = mapStringWithCharset(md5hex.substring(0, 5), CHARSET, -4);
  return `${prefix}${twoDigit}`;
}

function computeNonce(timeSec) {
  const raw = String(timeSec) + String(Math.random());
  return crypto
    .createHash("md5")
    .update(raw, "utf8")
    .digest("hex")
    .toUpperCase();
}

const PATH_SEARCH = "/bbs/app/api/general/search/v1";
const PATH_TREE = "/bbs/app/link/tree";
const PATH_ORIGINAL_IMAGE = "/bbs/app/api/original/image";

/** 两次 original/image 请求间隔（毫秒，用于 API 失败/无 imgs 等分支） */
const ORIGINAL_DELAY_MS = Number(process.env.XHH_ORIGINAL_DELAY_MS ?? "350");
/** 单张原图下载成功后的等待（毫秒） */
const POST_DOWNLOAD_DELAY_MS = Number(
  process.env.XHH_POST_DOWNLOAD_DELAY_MS ?? "3000",
);

const FETCH_HEADERS = {
  Accept: "*/*",
  "Accept-Language": "ja",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  Origin: "https://www.xiaoheihe.cn",
  Pragma: "no-cache",
  Referer: "https://www.xiaoheihe.cn/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  "sec-ch-ua":
    '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

function parseLinkIdFromShareUrl(shareUrl) {
  if (!shareUrl || typeof shareUrl !== "string") return null;
  try {
    const u = new URL(shareUrl);
    const id = u.searchParams.get("link_id");
    return id && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

function resolveLinkId(info) {
  if (!info || typeof info !== "object") return null;
  const fromShare = parseLinkIdFromShareUrl(
    info.share_url != null ? String(info.share_url) : "",
  );
  if (fromShare) return fromShare;
  if (info.linkid != null) return String(info.linkid);
  return null;
}

/**
 * 从 tree 响应的 result.link.text 提取正文里 type=img 的缩略图 URL（与 tree-text.json / tree2.json 结构一致）。
 */
function thumbUrlsFromLinkText(treeData) {
  const result = treeData?.result ?? treeData;
  const raw = result?.link?.text;
  if (raw == null || typeof raw !== "string") return [];
  const t = raw.trim();
  if (!t.startsWith("[")) return [];
  let blocks;
  try {
    blocks = JSON.parse(t);
  } catch {
    return [];
  }
  if (!Array.isArray(blocks)) return [];
  const out = [];
  for (const b of blocks) {
    if (b && b.type === "img" && typeof b.url === "string") out.push(b.url);
  }
  return out;
}

/**
 * 解析 original/image 返回的 result.imgs（字符串：单 URL，或 JSON 数组字符串等多形态）。
 */
function parseImgsField(imgs) {
  if (imgs == null) return [];
  const s = String(imgs).trim();
  if (!s) return [];
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      const p = JSON.parse(s);
      if (Array.isArray(p)) return p.filter((x) => typeof x === "string");
      if (typeof p === "string") return [p];
    } catch {
      /* fallthrough */
    }
  }
  if (/^https?:\/\//i.test(s)) return [s];
  return s
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter((x) => /^https?:\/\//i.test(x));
}

async function fetchOriginalImageJson(thumbUrl) {
  const t = Math.floor(Date.now() / 1000);
  const n = computeNonce(t);
  const h = computeHkey(PATH_ORIGINAL_IMAGE, t, n);
  const params = new URLSearchParams({
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
    hkey: h,
    _time: String(t),
    nonce: n,
    url: thumbUrl,
  });
  const url = `https://api.xiaoheihe.cn${PATH_ORIGINAL_IMAGE}?${params.toString()}`;
  const res = await fetch(url, { headers: FETCH_HEADERS });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`original/image 非 JSON: ${text.slice(0, 200)}`);
  }
  const st = data.status ?? data.msg;
  if (st && String(st) !== "ok") {
    throw new Error(`original/image status: ${st} ${text.slice(0, 160)}`);
  }
  return data;
}

function extFromUrl(u) {
  try {
    const pathname = new URL(u).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (ext && ext.length <= 8) return ext;
  } catch {
    /* fallthrough */
  }
  return "";
}

async function downloadFile(url, destPath) {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTreeJsonOnce(linkId) {
  const tTree = Math.floor(Date.now() / 1000);
  const nTree = computeNonce(tTree);
  const hTree = computeHkey(PATH_TREE, tTree, nTree);
  const treeParams = new URLSearchParams({
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
    hkey: hTree,
    _time: String(tTree),
    nonce: nTree,
    link_id: linkId,
    is_first: "1",
    page: "1",
    index: "1",
    limit: "20",
    owner_only: "0",
  });
  const urlTree = `https://api.xiaoheihe.cn${PATH_TREE}?${treeParams.toString()}`;
  const rTree = await fetch(urlTree, { headers: FETCH_HEADERS });
  const textTree = await rTree.text();
  let dataTree;
  try {
    dataTree = JSON.parse(textTree);
  } catch {
    throw new Error(`tree 非 JSON: ${textTree.slice(0, 200)}`);
  }
  const treeStatus = dataTree.status ?? dataTree.msg;
  if (
    treeStatus === "show_captcha" ||
    (dataTree.result &&
      typeof dataTree.result === "object" &&
      Object.keys(dataTree.result).length === 0)
  ) {
    const err = new Error(
      `tree 风控/空: ${treeStatus} ${textTree.slice(0, 120)}`,
    );
    err.captcha = treeStatus === "show_captcha";
    throw err;
  }
  if (treeStatus && String(treeStatus) !== "ok") {
    throw new Error(`tree status: ${treeStatus}`);
  }
  return dataTree;
}

async function fetchTreeJson(linkId) {
  let lastErr;
  for (let attempt = 0; attempt <= TREE_CAPTCHA_RETRIES; attempt++) {
    try {
      return await fetchTreeJsonOnce(linkId);
    } catch (e) {
      lastErr = e;
      if (e.captcha && attempt < TREE_CAPTCHA_RETRIES) {
        const wait = 9000 * (attempt + 1);
        console.warn(
          `  show_captcha，${wait}ms 后重试 (${attempt + 1}/${TREE_CAPTCHA_RETRIES})…`,
        );
        await delay(wait);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const pageLabel = `offset${SEARCH_OFFSET}-limit${SEARCH_LIMIT}`;
  const pageRoot = path.join(
    __dirname,
    "..",
    "sample-downloads",
    `search-${SEARCH_Q_DIR}-${pageLabel}`,
  );

  const tSearch = Math.floor(Date.now() / 1000);
  const nSearch = computeNonce(tSearch);
  const hSearch = computeHkey(PATH_SEARCH, tSearch, nSearch);
  const searchParams = new URLSearchParams({
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
    hkey: hSearch,
    _time: String(tSearch),
    nonce: nSearch,
    q: SEARCH_Q,
    search_type: "general",
    is_pull_down: "0",
    dw: "628",
    offset: String(SEARCH_OFFSET),
    limit: String(SEARCH_LIMIT),
    no_more: "false",
    time_range: "",
  });
  const urlSearch = `https://api.xiaoheihe.cn${PATH_SEARCH}?${searchParams.toString()}`;
  console.log("[search] GET", urlSearch.slice(0, 96) + "…");

  const rSearch = await fetch(urlSearch, { headers: FETCH_HEADERS });
  const textSearch = await rSearch.text();
  let dataSearch;
  try {
    dataSearch = JSON.parse(textSearch);
  } catch {
    console.error("[search] 非 JSON，前 400 字:\n", textSearch.slice(0, 400));
    process.exit(1);
  }

  const status = dataSearch.status ?? dataSearch.msg;
  if (status && String(status) !== "ok") {
    console.error(
      "[search] status:",
      status,
      "result:",
      JSON.stringify(dataSearch.result ?? {}).slice(0, 200),
    );
    process.exit(1);
  }

  const items = dataSearch.result?.items;
  if (!Array.isArray(items) || items.length === 0) {
    console.error("[search] 无 result.items");
    process.exit(1);
  }

  const posts = [];
  const seenIds = new Set();
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const lid = resolveLinkId(it?.info);
    if (!lid || seenIds.has(lid)) continue;
    seenIds.add(lid);
    posts.push({
      index: idx,
      link_id: lid,
      type: it.type,
      title: String(it?.info?.title ?? it?.title ?? "").slice(0, 120),
    });
  }

  console.log(
    `[search] items 共 ${items.length} 条，可拉 tree 的帖子 ${posts.length} 条（去重 link_id）`,
  );

  if (posts.length === 0) {
    console.error("[search] 本页无带 linkid/share_url 的帖子");
    process.exit(1);
  }

  await fs.mkdir(pageRoot, { recursive: true });
  const pageReport = {
    q: SEARCH_Q,
    offset: SEARCH_OFFSET,
    limit: SEARCH_LIMIT,
    posts: [],
  };

  for (let pi = 0; pi < posts.length; pi++) {
    const p = posts[pi];
    const subDir = `${String(pi + 1).padStart(2, "0")}-${p.link_id}`;
    const outDir = path.join(pageRoot, subDir);
    console.log(
      `\n[${pi + 1}/${posts.length}] link_id=${p.link_id} title=${p.title || "(无)"}`,
    );

    let dataTree;
    try {
      dataTree = await fetchTreeJson(p.link_id);
    } catch (e) {
      console.error("  tree FAIL:", e.message ?? e);
      pageReport.posts.push({
        ...p,
        error: String(e.message ?? e),
        downloaded: 0,
      });
      if (pi < posts.length - 1) await delay(TREE_DELAY_MS);
      continue;
    }

    const thumbUrls = thumbUrlsFromLinkText(dataTree);
    console.log(
      `  link.text 中 type=img: ${thumbUrls.length} 张（经 original/image 取原图）`,
    );

    await fs.mkdir(outDir, { recursive: true });
    if (thumbUrls.length === 0) {
      await fs.writeFile(
        path.join(outDir, "tree-link-text-sample.txt"),
        String(dataTree?.result?.link?.text ?? "").slice(0, 12000),
        "utf8",
      );
      await fs.writeFile(
        path.join(outDir, "manifest.json"),
        JSON.stringify(
          {
            link_id: p.link_id,
            title: p.title,
            thumb_urls: [],
            note: "link.text 无可解析的 […] 图片块，见 tree-link-text-sample.txt",
          },
          null,
          2,
        ),
        "utf8",
      );
      pageReport.posts.push({
        ...p,
        downloaded: 0,
        thumbs: 0,
        note: "no img blocks in link.text",
      });
      if (pi < posts.length - 1) await delay(TREE_DELAY_MS);
      continue;
    }

    const resolved = [];
    let ok = 0;
    for (let i = 0; i < thumbUrls.length; i++) {
      const thumb = thumbUrls[i];
      let dataOrig;
      try {
        dataOrig = await fetchOriginalImageJson(thumb);
      } catch (e) {
        console.log(
          `    [${i + 1}/${thumbUrls.length}] original/image FAIL:`,
          e.message ?? e,
        );
        resolved.push({ thumb, error: String(e.message ?? e) });
        if (i < thumbUrls.length - 1) await delay(ORIGINAL_DELAY_MS);
        continue;
      }
      const imgs = parseImgsField(dataOrig?.result?.imgs ?? dataOrig?.imgs);
      const downloadUrl = imgs[0];
      if (!downloadUrl) {
        console.log(`    [${i + 1}/${thumbUrls.length}] 无 imgs`);
        resolved.push({ thumb, error: "empty imgs" });
        if (i < thumbUrls.length - 1) await delay(ORIGINAL_DELAY_MS);
        continue;
      }
      const ext = extFromUrl(downloadUrl) || ".bin";
      const base =
        path.basename(new URL(downloadUrl).pathname) || `img-${i + 1}`;
      const safe = base.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const fname = `${String(i + 1).padStart(3, "0")}-${safe}${safe.includes(".") ? "" : ext}`;
      const dest = path.join(outDir, fname);
      process.stdout.write(`    [${i + 1}/${thumbUrls.length}] ${fname} … `);
      try {
        await downloadFile(downloadUrl, dest);
        ok += 1;
        resolved.push({ thumb, original: downloadUrl });
        console.log("ok");
        if (i < thumbUrls.length - 1) await delay(POST_DOWNLOAD_DELAY_MS);
      } catch (e) {
        console.log("FAIL", e.message ?? e);
        resolved.push({
          thumb,
          original: downloadUrl,
          error: String(e.message ?? e),
        });
        if (i < thumbUrls.length - 1) await delay(ORIGINAL_DELAY_MS);
      }
    }

    await fs.writeFile(
      path.join(outDir, "manifest.json"),
      JSON.stringify(
        {
          link_id: p.link_id,
          title: p.title,
          thumb_urls: thumbUrls,
          resolved,
        },
        null,
        2,
      ),
      "utf8",
    );

    pageReport.posts.push({ ...p, downloaded: ok, thumbs: thumbUrls.length });

    if (pi < posts.length - 1) await delay(TREE_DELAY_MS);
  }

  await fs.writeFile(
    path.join(pageRoot, "page-report.json"),
    JSON.stringify(pageReport, null, 2),
    "utf8",
  );
  console.log("\n完成，目录:", pageRoot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

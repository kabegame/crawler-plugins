// @ts-nocheck
// nekos.moe V8 爬虫：按排序 + NSFW 过滤翻页抓取搜索结果。
//
// 数据来自开源后端（github.com/Nekos-moe/api）的 POST /api/v1/images/search：
// - sort：newest（缺省）/ likes / oldest；relevance 只在带 tags 时生效，不带 tags 时等同自然顺序，不提供；
// - nsfw：true / false，缺省（不传）表示全部；
// - limit ≤ 50（超过会被服务端回落成 20），skip ≤ 2500（超过返回 400）；
// - 按 IP 限流：10 秒固定窗口最多 5 次，超出返回 429 和 retryAfter（毫秒）。
// 一条记录里已带齐标签、画师、上传者、审核者、点赞与收藏，不用再请求详情接口；
// 原图是 /image/<id>，无需 Referer。

import { sleep } from "@kabegame/plugin-sdk";

const { addProgress, downloadImage, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://nekos.moe";
const MAX_LIMIT = 50;
const MAX_SKIP = 2500;
// 10 秒最多 5 次：两次搜索之间至少隔 2.1 秒，任意 10 秒窗口内就不会超过 5 次
const SEARCH_INTERVAL_MS = 2100;
const MAX_RETRIES = 3;
const SORTS = new Set(["newest", "likes", "oldest"]);

function log(message) {
  console.log(`[nekos-moe] ${message}`);
}

let lastSearchAt = 0;

async function searchPage(baseUrl, body) {
  for (let attempt = 0; ; attempt += 1) {
    const wait = lastSearchAt + SEARCH_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastSearchAt = Date.now();
    const res = await fetch(`${baseUrl}/api/v1/images/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(data?.retryAfter) > 0 ? Number(data.retryAfter) : 10000;
      log(`触发限流，${Math.ceil(retryAfter / 1000)} 秒后重试（${attempt + 1}/${MAX_RETRIES}）`);
      await sleep(retryAfter + 500);
      continue;
    }
    if (!res.ok) throw new Error(`搜索接口 HTTP ${res.status}${data?.message ? `：${data.message}` : ""}`);
    return Array.isArray(data?.images) ? data.images : [];
  }
}

// label key 只允许 [a-zA-Z0-9_-]、英文括号与空格（不在首尾、不连续），≤ 64 字节。
// 先丢弃字符集之外的字符（`emilia (re:zero)` → `emilia (rezero)`）；
// 派生为空但原文含非 ASCII 文字的（日文画师名），按码点编码成 `u-xxxx-…` 作稳定 key；
// 纯符号（`:t`、`^ ^` 这类表情）派生为空，跳过。
function labelKey(value) {
  const raw = String(value || "").trim();
  const key = raw
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (key) return key.length <= 64 ? key : "";
  if (!/[^\x00-\x7f]/.test(raw)) return "";
  const encoded = `u-${Array.from(raw, (ch) => ch.codePointAt(0).toString(16)).join("-")}`;
  return encoded.length <= 64 ? encoded : "";
}

function buildLabels(image) {
  const labels = [];
  const artistKey = labelKey(image.artist);
  if (artistKey) labels.push({ key: artistKey, category: "nekos-moe/artist", name: String(image.artist).trim() });
  for (const tag of image.tags || []) {
    const key = labelKey(tag);
    if (key) labels.push({ key, category: "nekos-moe/tag", name: String(tag).trim() });
  }
  return labels;
}

function pickUser(user) {
  if (!user || !user.username) return null;
  return { id: user.id || "", username: user.username };
}

// metadata 存足以还原源站详情页（/post/<id>）的字段：Post Info（上传者、审核者、上传时间、画师）、
// 点赞与收藏、标签（保持站点顺序）以及 NSFW 标记。templates/description.ejs 消费。
function buildMetadata(image, baseUrl) {
  return {
    schema: 1,
    id: image.id,
    page_url: `${baseUrl}/post/${image.id}`,
    image_url: `${baseUrl}/image/${image.id}`,
    thumbnail_url: `${baseUrl}/thumbnail/${image.id}`,
    nsfw: !!image.nsfw,
    artist: image.artist || "",
    uploader: pickUser(image.uploader),
    approver: pickUser(image.approver),
    created_at: image.createdAt || "",
    likes: image.likes ?? 0,
    favorites: image.favorites ?? 0,
    tags: (image.tags || []).map((t) => String(t)),
  };
}

// 元数据搜索片段覆盖详情面板里的文字：画师、上传者、审核者、标签与 ID。
function searchTextsFromMetadata(meta) {
  const values = ["nekos.moe", meta.id, meta.artist, meta.uploader?.username, meta.approver?.username, ...meta.tags];
  return [...new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))];
}

function displayName(image) {
  return `${String(image.artist || "").trim() || "nekos.moe"} #${image.id}`;
}

export async function crawl(common, custom) {
  const baseUrl = String(common?.base_url || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const vars = custom || {};
  const sort = SORTS.has(vars.sort) ? vars.sort : "newest";
  const nsfw = ["sfw", "nsfw", "all"].includes(vars.nsfw) ? vars.nsfw : "sfw";
  const pageSize = Math.min(MAX_LIMIT, Math.max(1, Number(vars.page_size ?? MAX_LIMIT) || MAX_LIMIT));
  const startPage = Math.max(1, Number(vars.start_page ?? 1) || 1);
  let endPage = Math.max(startPage, Number(vars.end_page ?? startPage) || startPage);

  // 服务端 skip 上限 2500：能翻到的最后一页是 skip = (page - 1) * pageSize ≤ 2500
  const maxPage = Math.floor(MAX_SKIP / pageSize) + 1;
  if (startPage > maxPage) {
    warn(`[nekos-moe] 每页 ${pageSize} 张时最多翻到第 ${maxPage} 页（站点限制 skip ≤ ${MAX_SKIP}），起始页 ${startPage} 超出范围`);
    addProgress(100);
    return;
  }
  if (endPage > maxPage) {
    log(`每页 ${pageSize} 张时最多翻到第 ${maxPage} 页，结束页 ${endPage} 按 ${maxPage} 处理`);
    endPage = maxPage;
  }

  const pctPerPage = 100 / (endPage - startPage + 1);
  log(`排序 ${sort}，NSFW ${nsfw}，每页 ${pageSize} 张，第 ${startPage}~${endPage} 页`);

  for (let page = startPage; page <= endPage; page += 1) {
    const body = { limit: pageSize, skip: (page - 1) * pageSize, sort };
    if (nsfw !== "all") body.nsfw = nsfw === "nsfw";
    let images;
    try {
      images = await searchPage(baseUrl, body);
    } catch (e) {
      warn(`[nekos-moe] 第 ${page} 页读取失败：${e?.message ?? e}`);
      addProgress(pctPerPage);
      continue;
    }
    if (images.length === 0) {
      log(`第 ${page} 页没有结果，已到最后一页`);
      addProgress(100);
      break;
    }

    log(`┌ 第 ${page} 页：${images.length} 张`);
    const pctPerImage = pctPerPage / images.length;
    for (const image of images) {
      try {
        if (!image?.id) throw new Error("记录缺少 id");
        const metadata = buildMetadata(image, baseUrl);
        const opts = {
          name: displayName(image),
          url: metadata.page_url,
          metadata,
          searchTexts: searchTextsFromMetadata(metadata),
        };
        const labels = buildLabels(image);
        if (labels.length > 0) opts.labels = labels;
        await downloadImage(metadata.image_url, opts);
      } catch (e) {
        warn(`[nekos-moe] 图片 ${image?.id} 下载失败：${e?.message ?? e}`);
      }
      addProgress(pctPerImage);
    }
    log(`└ 第 ${page} 页完成`);

    if (images.length < pageSize) {
      log(`第 ${page} 页不足 ${pageSize} 张，已到最后一页`);
      addProgress(100);
      break;
    }
  }
}

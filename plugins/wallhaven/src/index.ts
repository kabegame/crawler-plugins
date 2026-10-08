// @ts-nocheck
// wallhaven V8 爬虫：搜索条件 / 搜索 URL 两种模式。
//
// 站点的 /latest、/toplist 只是 /search 的预设（匿名默认 categories=110&purity=100，实测 Latest /
// Toplist 第 2 页与 API /api/v1/search 同参数的 ID 序列逐项一致）。插件既可直接配置搜索参数，也可
// 粘贴 /search URL；Latest / Toplist 作为推荐配置提供。每页 24 条，匿名访问没有 NSFW。列表条目里有原图 path、尺寸、
// 大小、配色、来源等，但没有上传者和标签，所以每张再调一次 /api/v1/w/<id> 补齐。
// API 匿名限流 45 次/分钟，所有 API 请求经 apiGet 串行节流，429 时等待后重试。

import { sleep } from "@kabegame/plugin-sdk";

const { addProgress, downloadImage, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://wallhaven.cc";
// 45 次/分钟 ≈ 1.33s 一次，留余量取 1.5s
const API_MIN_INTERVAL_MS = 1500;
const API_RETRY_WAIT_MS = 20000;
const API_MAX_RETRIES = 4;

function log(message) {
  console.log(`[wallhaven] ${message}`);
}

let lastApiAt = 0;

async function throttledGet(url) {
  for (let attempt = 0;; attempt += 1) {
    const wait = lastApiAt + API_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastApiAt = Date.now();
    const res = await fetch(url);
    if (res.status === 429 && attempt < API_MAX_RETRIES) {
      log(
        `限流（429），${API_RETRY_WAIT_MS / 1000}s 后重试 ${
          attempt + 1
        }/${API_MAX_RETRIES}`,
      );
      await sleep(API_RETRY_WAIT_MS);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
}

async function apiGet(url) {
  return await (await throttledGet(url)).json();
}

const SORTINGS = [
  "date_added",
  "relevance",
  "random",
  "views",
  "favorites",
  "toplist",
  "hot",
];
const TOP_RANGES = ["1d", "3d", "1w", "1M", "3M", "6M", "1y"];

// 站点比例表的四列；landscape / portrait 是站点的 All Wide / All Portrait，实际按宽 > 高 / 高 > 宽
// 匹配，也包含表外比例（4:3、3:4…）。
const WIDE_RATIOS = ["16x9", "16x10", "21x9", "32x9", "48x9"];
const PORTRAIT_RATIOS = ["9x16", "10x16", "9x18"];
const SQUARE_RATIOS = ["1x1", "3x2", "4x3", "5x4"];
const ALL_RATIOS = [...WIDE_RATIOS, ...PORTRAIT_RATIOS, ...SQUARE_RATIOS];

// 2K / 4K 的短边；长边按比例换算，横屏/竖屏 token 按 16:9 计（即 2560×1440、3840×2160）。
const SHORT_SIDE = { "2k": 1440, "4k": 2160 };

// checkbox 值是 { variable: bool }；兼容数组（推荐配置里的写法）。
function checked(value, variables) {
  if (Array.isArray(value)) return variables.filter((v) => value.includes(v));
  if (value && typeof value === "object") {
    return variables.filter((v) => value[v] === true);
  }
  return [];
}

function bits(selected, variables) {
  return variables.map((v) => (selected.includes(v) ? "1" : "0")).join("");
}

// 比例并集。站点在 ratios 里只要出现具体比例就整个忽略 landscape/portrait（实测
// `1x1,landscape` 只返回 1x1），所以混用时把 token 展开成表里对应的列。
function resolveRatios(orientation, ratios) {
  const exact = new Set(ratios);
  if (orientation.includes("square")) {
    SQUARE_RATIOS.forEach((r) => exact.add(r));
  }
  const tokens = orientation.filter((o) =>
    o === "landscape" || o === "portrait"
  );
  if (exact.size === 0) return tokens;
  if (tokens.includes("landscape")) WIDE_RATIOS.forEach((r) => exact.add(r));
  if (tokens.includes("portrait")) PORTRAIT_RATIOS.forEach((r) => exact.add(r));
  return ALL_RATIOS.filter((r) => exact.has(r));
}

// 每个比例给出一个「短边 = S、长边 = S × 比例」的框，atleast 取所有框逐边最小值。站点只要求图片
// 落在所选比例里且不小于 atleast，所以任一所选比例的图都满足短边 ≥ S；没选比例时为 S×S。
function atLeastFor(minResolution, ratioList) {
  const short = SHORT_SIDE[minResolution];
  if (!short) return "";
  const boxes = ratioList.map((r) => {
    if (r === "landscape") return [Math.round((short * 16) / 9), short];
    if (r === "portrait") return [short, Math.round((short * 16) / 9)];
    const [w, h] = r.split("x").map(Number);
    return w >= h
      ? [Math.round((short * w) / h), short]
      : [short, Math.round((short * h) / w)];
  });
  if (boxes.length === 0) return `${short}x${short}`;
  const width = Math.min(...boxes.map((b) => b[0]));
  const height = Math.min(...boxes.map((b) => b[1]));
  return `${width}x${height}`;
}

function buildSearchParams(vars) {
  const params = {};
  const q = String(vars.q ?? "").trim();
  if (q) params.q = q;

  let categories = checked(vars.categories, ["general", "anime", "people"]);
  if (categories.length === 0) {
    // categories=000 时 API 返回全部分类，这里显式写出
    log("未勾选分类，按全部分类搜索");
    categories = ["general", "anime", "people"];
  }
  params.categories = bits(categories, ["general", "anime", "people"]);

  let purity = checked(vars.purity, ["sfw", "sketchy"]);
  if (purity.length === 0) {
    // purity=000 时站点网页与 API 都退回只搜 SFW（总数与 purity=100 相同），这里显式写出
    warn("[wallhaven] SFW 与擦边都未勾选，站点会退回只搜 SFW");
    purity = ["sfw"];
  }
  params.purity = `${bits(purity, ["sfw", "sketchy"])}0`;

  const sorting = SORTINGS.includes(vars.sorting) ? vars.sorting : "date_added";
  params.sorting = sorting;
  if (sorting !== "random") {
    params.order = vars.order === "asc" ? "asc" : "desc";
  }
  if (sorting === "toplist") {
    params.topRange = TOP_RANGES.includes(vars.top_range)
      ? vars.top_range
      : "1M";
  }

  const ratioList = resolveRatios(
    checked(vars.orientation, ["landscape", "portrait", "square"]),
    checked(vars.ratios, ALL_RATIOS),
  );
  if (ratioList.length > 0) params.ratios = ratioList.join(",");
  const atleast = atLeastFor(vars.min_resolution, ratioList);
  if (atleast) params.atleast = atleast;
  return params;
}

// 搜索页 /search?… 的查询参数与 /api/v1/search 同名，页面把它们原样转给接口（实测前两页
// ID 序列逐项一致），所以直接搬过来，只去掉 page（由起止页控制）。接受完整 URL，也接受只
// 粘贴了 `?categories=…` 的查询串。
function parseSearchUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("请填写搜索 URL");
  let url;
  try {
    url = new URL(
      raw.startsWith("?") ? `${DEFAULT_BASE_URL}/search${raw}` : raw,
    );
  } catch {
    throw new Error(`不是合法的 URL：${raw}`);
  }
  if (
    !/(^|\.)wallhaven\.cc$/i.test(url.hostname) ||
    url.pathname.replace(/\/+$/, "") !== "/search"
  ) {
    throw new Error(
      `请填写 wallhaven 搜索页地址（https://wallhaven.cc/search?…），收到：${raw}`,
    );
  }
  const params = new URLSearchParams(url.search);
  params.delete("page");
  return Object.fromEntries(params);
}

// label key 只允许 [a-zA-Z0-9_-]、英文括号与空格（不在首尾、不连续），≤ 64 字节；
// 派生为空或超长（如纯中日文标签）时退回稳定的 `tag-<id>`，原名仍作为显示名。
function labelKey(tag) {
  const key = String(tag?.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (key && key.length <= 64) return key;
  return tag?.id != null ? `tag-${tag.id}` : "";
}

// 站点标签分类有几十个子类（Fictional Characters、Games、Clothing…），不按它建目录，统一挂到 wallhaven/tag；
// 子类保留在 metadata.tags[].category 里。
function labelsFromTags(tags) {
  const labels = [];
  for (const tag of tags || []) {
    const key = labelKey(tag);
    if (!key) continue;
    labels.push({
      key,
      category: "wallhaven/tag",
      name: String(tag.name).trim(),
    });
  }
  return labels;
}

function pickUploader(uploader) {
  if (!uploader) return null;
  const avatar = uploader.avatar || {};
  return {
    username: uploader.username || "",
    group: uploader.group || "",
    avatar: avatar["128px"] || avatar["200px"] || avatar["32px"] || "",
  };
}

// metadata 存足以还原源站详情页侧栏的字段（templates/description.ejs 消费）：
// 分辨率、来源、配色、标签（含纯度与分类）、上传者与时间、分类、纯度、大小与格式、浏览、收藏、短链。
// detail 拿不到时（请求失败）退回列表条目，uploader / tags 为空。
function buildMetadata(item, detail) {
  const w = detail || item;
  return {
    schema: 1,
    id: w.id,
    url: w.url || "",
    short_url: w.short_url || "",
    path: w.path || "",
    thumbs: w.thumbs || {},
    purity: w.purity || "",
    category: w.category || "",
    dimension_x: w.dimension_x,
    dimension_y: w.dimension_y,
    ratio: w.ratio || "",
    file_size: w.file_size,
    file_type: w.file_type || "",
    created_at: w.created_at || "",
    colors: Array.isArray(w.colors) ? w.colors : [],
    views: w.views ?? 0,
    favorites: w.favorites ?? 0,
    source: w.source || "",
    uploader: pickUploader(detail?.uploader),
    tags: (detail?.tags || []).map((t) => ({
      id: t.id,
      name: t.name,
      alias: t.alias || "",
      category_id: t.category_id,
      category: t.category || "",
      purity: t.purity || "",
    })),
  };
}

// 站点没有标题，页面 <title> 是标签串；展示名取第一个标签加编号。
function displayName(item, detail) {
  const head = detail?.tags?.[0]?.name;
  return head ? `${head} #${item.id}` : `wallhaven #${item.id}`;
}

// 随机排序要靠 seed 让各页来自同一份随机序列。API 虽然返回 meta.seed，但请求里带 seed 会被忽略
// （实测同 seed 同页两次结果不同），网页 /search 才认 seed，所以随机排序改从网页取 ID，
// 原图地址等字段由逐张的详情接口补齐。
function randomSeed() {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let seed = "";
  for (let i = 0; i < 6; i += 1) {
    seed += chars[Math.floor(Math.random() * chars.length)];
  }
  return seed;
}

async function fetchWebListPage(baseUrl, search, page) {
  const params = new URLSearchParams({ ...search, page: String(page) });
  const html = await (await throttledGet(`${baseUrl}/search?${params}`)).text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items = [...doc.querySelectorAll("figure.thumb[data-wallpaper-id]")]
    .map((el) => ({
      id: el.getAttribute("data-wallpaper-id"),
    }));
  // 标题「501,643 Wallpapers found」；第 1 页没有「Page N / M」页头，页数按每页 24 条换算
  const total = Number(
    doc.querySelector("header.listing-header h1")?.textContent?.match(/[\d,]+/)
      ?.[0]?.replace(/,/g, "") || 0,
  );
  return {
    items,
    total,
    lastPage: total > 0 ? Math.ceil(total / 24) : Infinity,
  };
}

async function fetchListPage(baseUrl, search, page) {
  if (search.sorting === "random") {
    return await fetchWebListPage(baseUrl, search, page);
  }
  const params = new URLSearchParams({ ...search, page: String(page) });
  const data = await apiGet(`${baseUrl}/api/v1/search?${params}`);
  return {
    items: Array.isArray(data?.data) ? data.data : [],
    total: data?.meta?.total ?? 0,
    lastPage: data?.meta?.last_page ?? Infinity,
  };
}

async function downloadOne(baseUrl, item) {
  let detail = null;
  try {
    detail = (await apiGet(`${baseUrl}/api/v1/w/${item.id}`))?.data || null;
  } catch (e) {
    warn(
      `[wallhaven] ${item.id} 详情读取失败，仅用列表信息：${e?.message ?? e}`,
    );
  }
  // 网页列表（随机排序）只有 ID，原图地址来自详情
  const path = item.path || detail?.path;
  if (!path) {
    warn(`[wallhaven] ${item?.id} 没有原图地址，跳过`);
    return;
  }
  const opts = {
    name: displayName(item, detail),
    url: item.url || detail?.url || `${baseUrl}/w/${item.id}`,
    metadata: buildMetadata(item, detail),
  };
  const labels = labelsFromTags(detail?.tags);
  if (labels.length > 0) opts.labels = labels;
  await downloadImage(path, opts);
}

export async function crawl(common, custom) {
  const baseUrl = String(common?.base_url || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const vars = custom || {};
  const mode = vars.mode === "url" ? "url" : "search";
  let search;
  if (mode === "url") {
    try {
      search = parseSearchUrl(vars.search_url);
    } catch (e) {
      warn(`[wallhaven] ${e?.message ?? e}`);
      addProgress(100);
      return;
    }
  } else {
    search = buildSearchParams(vars);
  }
  const startPage = Math.max(1, Number(vars.start_page ?? 1) || 1);
  let endPage = Math.max(
    startPage,
    Number(vars.end_page ?? startPage) || startPage,
  );
  const pctPerPage = 100 / (endPage - startPage + 1);
  if (search.sorting === "random" && !search.seed) search.seed = randomSeed();

  const title = mode === "url" ? "搜索 URL" : "搜索条件";
  log(
    `${title} ${
      decodeURIComponent(new URLSearchParams(search).toString())
    }：第 ${startPage}~${endPage} 页`,
  );
  for (let page = startPage; page <= endPage; page += 1) {
    let result;
    try {
      result = await fetchListPage(baseUrl, search, page);
      if (page === startPage) {
        log(`共 ${result.total} 张，${result.lastPage} 页`);
        if (endPage > result.lastPage) endPage = result.lastPage;
      }
    } catch (e) {
      warn(`[wallhaven] 第 ${page} 页读取失败：${e?.message ?? e}`);
      addProgress(pctPerPage);
      continue;
    }
    if (result.items.length === 0) {
      addProgress(pctPerPage);
      break; // 越过最后一页
    }

    log(`┌ 第 ${page} 页：${result.items.length} 张`);
    const pctPerItem = pctPerPage / result.items.length;
    for (const [i, item] of result.items.entries()) {
      try {
        await downloadOne(baseUrl, item);
        log(`│ ${i + 1}/${result.items.length} ${item.id}`);
      } catch (e) {
        warn(`[wallhaven] ${item?.id} 下载失败：${e?.message ?? e}`);
      }
      addProgress(pctPerItem);
    }
    log(`└ 第 ${page} 页完成`);
  }
}

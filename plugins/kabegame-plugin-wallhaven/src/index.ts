// wallhaven V8 爬虫：搜索条件 / 搜索 URL 两种模式。
//
// 站点的 /latest、/toplist 只是 /search 的预设（匿名默认 categories=110&purity=100，实测 Latest /
// Toplist 第 2 页与 API /api/v1/search 同参数的 ID 序列逐项一致）。插件既可直接配置搜索参数，也可
// 粘贴 /search URL；Latest / Toplist 作为推荐配置提供。每页 24 条，匿名访问没有 NSFW。列表条目里有原图 path、尺寸、
// 大小、配色、来源等，但没有上传者和标签，所以每张再调一次 /api/v1/w/<id> 补齐。
// API 匿名限流 45 次/分钟，所有 API 请求经 apiGet 串行节流，429 时等待后重试。

import { sleep } from "@kabegame/plugin-sdk";
import { t } from "./i18n";

const { addProgress, downloadImage, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://wallhaven.cc";
// 45 次/分钟 ≈ 1.33s 一次，留余量取 1.5s
const API_MIN_INTERVAL_MS = 1500;
const API_RETRY_WAIT_MS = 20000;
const API_MAX_RETRIES = 4;

let lastApiAt = 0;

// 站点 JSON 的最小结构：字段都可能缺失，只在确实依赖处收窄。
// 输出侧（metadata）必须保持 JSON 可序列化，所以全部用 type 而非 interface
//（interface 不满足 KabegameJsonValue 的索引签名）。
type WallhavenThumbs = {
  large?: string | null;
  original?: string | null;
  small?: string | null;
};

type WallhavenTag = {
  id?: number | null;
  name?: string | null;
  alias?: string | null;
  category_id?: number | null;
  category?: string | null;
  purity?: string | null;
};

type WallhavenUploader = {
  username?: string | null;
  group?: string | null;
  avatar?: Record<string, string> | null;
};

// 列表条目与 /api/v1/w/<id> 详情共用；详情多出 uploader / tags。
type WallhavenWallpaper = {
  id?: string | null;
  url?: string | null;
  short_url?: string | null;
  path?: string | null;
  thumbs?: WallhavenThumbs | null;
  purity?: string | null;
  category?: string | null;
  dimension_x?: number | null;
  dimension_y?: number | null;
  ratio?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  created_at?: string | null;
  colors?: string[] | null;
  views?: number | null;
  favorites?: number | null;
  source?: string | null;
  uploader?: WallhavenUploader | null;
  tags?: WallhavenTag[] | null;
};

type WallhavenSearchResponse = {
  data?: WallhavenWallpaper[] | null;
  meta?: { total?: number | null; last_page?: number | null } | null;
};

type WallhavenDetailResponse = {
  data?: WallhavenWallpaper | null;
};

type WallhavenListPage = {
  items: WallhavenWallpaper[];
  total: number;
  lastPage: number;
};

type WallhavenMetadataUploader = {
  username: string;
  group: string;
  avatar: string;
};

type WallhavenMetadataTag = {
  id?: number | null;
  name?: string | null;
  alias: string;
  category_id?: number | null;
  category: string;
  purity: string;
};

type WallhavenMetadata = {
  schema: number;
  id?: string | null;
  url: string;
  short_url: string;
  path: string;
  thumbs: WallhavenThumbs;
  purity: string;
  category: string;
  dimension_x?: number | null;
  dimension_y?: number | null;
  ratio: string;
  file_size?: number | null;
  file_type: string;
  created_at: string;
  colors: string[];
  views: number;
  favorites: number;
  source: string;
  uploader: WallhavenMetadataUploader | null;
  tags: WallhavenMetadataTag[];
};

function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// catch 里的值是 unknown；保持原来 `error?.message ?? error` 的字符串回退语义。
function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (message != null) return String(message);
  }
  return String(error);
}

async function throttledGet(url: string): Promise<Response> {
  for (let attempt = 0;; attempt += 1) {
    const wait = lastApiAt + API_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastApiAt = Date.now();
    const res = await fetch(url);
    if (res.status === 429 && attempt < API_MAX_RETRIES) {
      console.log(
        t("rateLimited", {
          seconds: API_RETRY_WAIT_MS / 1000,
          attempt: attempt + 1,
          max: API_MAX_RETRIES,
        }),
      );
      await sleep(API_RETRY_WAIT_MS);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
}

async function apiGet<T = unknown>(url: string): Promise<T> {
  const res = await throttledGet(url);
  return (await res.json()) as T;
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
const SHORT_SIDE: Record<string, number> = { "2k": 1440, "4k": 2160 };

// checkbox 值是 { variable: bool }；兼容数组（推荐配置里的写法）。
function checked(value: unknown, variables: string[]): string[] {
  if (Array.isArray(value)) return variables.filter((v) => value.includes(v));
  if (isRecord(value)) {
    return variables.filter((v) => value[v] === true);
  }
  return [];
}

function bits(selected: string[], variables: string[]): string {
  return variables.map((v) => (selected.includes(v) ? "1" : "0")).join("");
}

// 比例并集。站点在 ratios 里只要出现具体比例就整个忽略 landscape/portrait（实测
// `1x1,landscape` 只返回 1x1），所以混用时把 token 展开成表里对应的列。
function resolveRatios(orientation: string[], ratios: string[]): string[] {
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
function atLeastFor(minResolution: unknown, ratioList: string[]): string {
  const short = SHORT_SIDE[coerceStr(minResolution)];
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

function buildSearchParams(vars: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  const q = String(vars.q ?? "").trim();
  if (q) params.q = q;

  let categories = checked(vars.categories, ["general", "anime", "people"]);
  if (categories.length === 0) {
    // categories=000 时 API 返回全部分类，这里显式写出
    console.log(t("categoriesAll"));
    categories = ["general", "anime", "people"];
  }
  params.categories = bits(categories, ["general", "anime", "people"]);

  let purity = checked(vars.purity, ["sfw", "sketchy"]);
  if (purity.length === 0) {
    // purity=000 时站点网页与 API 都退回只搜 SFW（总数与 purity=100 相同），这里显式写出
    warn(t("purityFallbackSfw"));
    purity = ["sfw"];
  }
  params.purity = `${bits(purity, ["sfw", "sketchy"])}0`;

  const sorting =
    typeof vars.sorting === "string" && SORTINGS.includes(vars.sorting)
      ? vars.sorting
      : "date_added";
  params.sorting = sorting;
  if (sorting !== "random") {
    params.order = vars.order === "asc" ? "asc" : "desc";
  }
  if (sorting === "toplist") {
    params.topRange =
      typeof vars.top_range === "string" && TOP_RANGES.includes(vars.top_range)
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
function parseSearchUrl(input: unknown): Record<string, string> {
  const raw = String(input || "").trim();
  if (!raw) throw new Error(t("searchUrlRequired"));
  let url: URL;
  try {
    url = new URL(
      raw.startsWith("?") ? `${DEFAULT_BASE_URL}/search${raw}` : raw,
    );
  } catch {
    throw new Error(t("invalidUrl", { url: raw }));
  }
  if (
    !/(^|\.)wallhaven\.cc$/i.test(url.hostname) ||
    url.pathname.replace(/\/+$/, "") !== "/search"
  ) {
    throw new Error(t("searchUrlInvalid", { url: raw }));
  }
  const params = new URLSearchParams(url.search);
  params.delete("page");
  return Object.fromEntries(entriesOf(params));
}

// @kabegame/types 的 URLSearchParams 没有声明迭代器，这里显式收集成条目再交给 Object.fromEntries，
// 保持原来 `Object.fromEntries(params)` 的语义（重复键后者覆盖前者、键按 URL 顺序）。
function entriesOf(params: URLSearchParams): [string, string][] {
  const entries: [string, string][] = [];
  params.forEach((value, key) => entries.push([key, value]));
  return entries;
}

// label key 只允许 [a-zA-Z0-9_-]、英文括号与空格（不在首尾、不连续），≤ 64 字节；
// 派生为空或超长（如纯中日文标签）时退回稳定的 `tag-<id>`，原名仍作为显示名。
function labelKey(tag: WallhavenTag): string {
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
function labelsFromTags(
  tags: WallhavenTag[] | null | undefined,
): KabegameLabelInput[] {
  const labels: KabegameLabelInput[] = [];
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

function pickUploader(
  uploader: WallhavenUploader | null | undefined,
): WallhavenMetadataUploader | null {
  if (!uploader) return null;
  const avatar: Record<string, string> = uploader.avatar || {};
  return {
    username: uploader.username || "",
    group: uploader.group || "",
    avatar: avatar["128px"] || avatar["200px"] || avatar["32px"] || "",
  };
}

// metadata 存足以还原源站详情页侧栏的字段（templates/description.ejs 消费）：
// 分辨率、来源、配色、标签（含纯度与分类）、上传者与时间、分类、纯度、大小与格式、浏览、收藏、短链。
// detail 拿不到时（请求失败）退回列表条目，uploader / tags 为空。
function buildMetadata(
  item: WallhavenWallpaper,
  detail: WallhavenWallpaper | null,
): WallhavenMetadata {
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
function displayName(
  item: WallhavenWallpaper,
  detail: WallhavenWallpaper | null,
): string {
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

async function fetchWebListPage(
  baseUrl: string,
  search: Record<string, string>,
  page: number,
): Promise<WallhavenListPage> {
  const params = new URLSearchParams({ ...search, page: String(page) });
  const html = await (await throttledGet(`${baseUrl}/search?${params}`)).text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items: WallhavenWallpaper[] = [...doc.querySelectorAll("figure.thumb[data-wallpaper-id]")]
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

async function fetchListPage(
  baseUrl: string,
  search: Record<string, string>,
  page: number,
): Promise<WallhavenListPage> {
  if (search.sorting === "random") {
    return await fetchWebListPage(baseUrl, search, page);
  }
  const params = new URLSearchParams({ ...search, page: String(page) });
  const data = await apiGet<WallhavenSearchResponse>(
    `${baseUrl}/api/v1/search?${params}`,
  );
  return {
    items: Array.isArray(data?.data) ? data.data : [],
    total: data?.meta?.total ?? 0,
    lastPage: data?.meta?.last_page ?? Infinity,
  };
}

async function downloadOne(
  baseUrl: string,
  item: WallhavenWallpaper,
): Promise<void> {
  let detail: WallhavenWallpaper | null = null;
  try {
    const response = await apiGet<WallhavenDetailResponse>(
      `${baseUrl}/api/v1/w/${item.id}`,
    );
    detail = response?.data || null;
  } catch (e) {
    warn(t("detailFailed", { id: item.id, error: errorMessage(e) }));
  }
  // 网页列表（随机排序）只有 ID，原图地址来自详情
  const path = item.path || detail?.path;
  if (!path) {
    warn(t("noImagePath", { id: item?.id }));
    return;
  }
  const opts: KabegameDownloadImageOptions = {
    name: displayName(item, detail),
    url: item.url || detail?.url || `${baseUrl}/w/${item.id}`,
    metadata: buildMetadata(item, detail),
  };
  const labels = labelsFromTags(detail?.tags);
  if (labels.length > 0) opts.labels = labels;
  await downloadImage(path, opts);
}

export async function crawl(common: unknown, custom: unknown): Promise<void> {
  const cfg = isRecord(common) ? common : {};
  const baseUrl = coerceStr(cfg.baseUrl || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const vars = isRecord(custom) ? custom : {};
  const mode = vars.mode === "url" ? "url" : "search";
  let search: Record<string, string>;
  if (mode === "url") {
    try {
      search = parseSearchUrl(vars.search_url);
    } catch (e) {
      warn(`[wallhaven] ${errorMessage(e)}`);
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

  console.log(
    t(mode === "url" ? "openSearchUrl" : "openSearchParams", {
      query: decodeURIComponent(new URLSearchParams(search).toString()),
      startPage,
      endPage,
    }),
  );
  for (let page = startPage; page <= endPage; page += 1) {
    let result: WallhavenListPage;
    try {
      result = await fetchListPage(baseUrl, search, page);
      if (page === startPage) {
        console.log(t("totalSummary", { total: result.total, pages: result.lastPage }));
        if (endPage > result.lastPage) endPage = result.lastPage;
      }
    } catch (e) {
      warn(t("pageReadFailed", { page, error: errorMessage(e) }));
      addProgress(pctPerPage);
      continue;
    }
    if (result.items.length === 0) {
      addProgress(pctPerPage);
      break; // 越过最后一页
    }

    console.log(t("pageStart", { page, count: result.items.length }));
    const pctPerItem = pctPerPage / result.items.length;
    for (const [i, item] of result.items.entries()) {
      try {
        await downloadOne(baseUrl, item);
        console.log(`[wallhaven] │ ${i + 1}/${result.items.length} ${item.id}`);
      } catch (e) {
        warn(t("downloadFailed", { id: item?.id, error: errorMessage(e) }));
      }
      addProgress(pctPerItem);
    }
    console.log(t("pageDone", { page }));
  }
}

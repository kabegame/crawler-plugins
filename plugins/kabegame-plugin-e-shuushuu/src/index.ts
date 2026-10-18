// e-shuushuu V8 爬虫：主页翻页 / 排行榜（全时段、年、月、周）/ 搜索 URL 三种模式。
//
// 主页 `/?page=N` 与 JSON API `/api/v1/images?page=N` 是同一份列表（每页 20 条、最新在前），
// API 一条记录里已经带齐原图 URL、标签与出处，所以不进详情页；评论用 include_comments 随列表返回。

import { t } from "./i18n";

const { addProgress, downloadImage, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://e-shuushuu.net";

// 站点标签只有四类，映射到 `e-shuushuu/<分类>` 目录；未知类型归入 theme，保证不会多出目录。
const LABEL_CATEGORIES = new Set(["artist", "source", "character", "theme"]);

// 站点 JSON 与 metadata 都用 type 建模（不用 interface：interface 没有隐式索引签名，
// 不能直接赋给 KabegameJsonValue 作为 metadata）。
type EshuushuuTag = {
  tag_id?: number | null;
  title?: string | null;
  type_name?: string | null;
};

type EshuushuuUser = {
  user_id?: number | null;
  username?: string | null;
  avatar_url?: string | null;
  user_title?: string | null;
  groups?: string[] | null;
};

type EshuushuuComment = {
  post_id?: number | null;
  parent_comment_id?: number | null;
  deleted?: boolean | null;
  date?: string | null;
  last_updated?: string | null;
  post_text?: string | null;
  user?: EshuushuuUser | null;
};

type EshuushuuImage = {
  image_id: number;
  filename?: string | null;
  ext?: string | null;
  url?: string | null;
  large?: boolean | null;
  large_url?: string | null;
  medium?: boolean | null;
  medium_url?: string | null;
  thumbnail_url?: string | null;
  width?: number | null;
  height?: number | null;
  filesize?: number | null;
  md5_hash?: string | null;
  caption?: string | null;
  original_filename?: string | null;
  source_url?: string | null;
  date_added?: string | null;
  rating?: number | null;
  num_ratings?: number | null;
  bayesian_rating?: number | null;
  favorites?: number | null;
  user?: EshuushuuUser | null;
  tags?: EshuushuuTag[] | null;
  posts?: number | null;
  status?: number | null;
};

type EshuushuuListResponse = {
  images?: EshuushuuImage[] | null;
  comments?: Record<string, EshuushuuComment[]> | null;
  total?: number | null;
  per_page?: number | null;
};

type EshuushuuPage = {
  images: EshuushuuImage[];
  comments: Record<string, EshuushuuComment[]>;
  total: number;
  lastPage: number;
};

// metadata 侧类型（写进 downloadImage 的 metadata，description.ejs 消费）
type EshuushuuMetadataUser = {
  user_id?: number | null;
  username: string;
  avatar_url: string;
  user_title: string;
  groups: string[];
};

type EshuushuuMetadataComment = {
  post_id?: number | null;
  parent_comment_id: number | null;
  deleted: boolean;
  date: string;
  last_updated: string | null;
  post_text: string;
  user: EshuushuuMetadataUser | null;
};

type EshuushuuMetadataTag = {
  tag_id?: number | null;
  title?: string | null;
  type_name?: string | null;
};

type EshuushuuMetadata = {
  schema: number;
  image_id: number;
  page_url: string;
  filename: string;
  ext: string;
  url: string;
  large_url: string;
  medium_url: string;
  thumbnail_url: string;
  width?: number | null;
  height?: number | null;
  filesize?: number | null;
  md5: string;
  caption: string;
  original_filename: string;
  source_url: string;
  date_added: string;
  rating: number | null;
  num_ratings: number;
  bayesian_rating: number | null;
  favorites: number;
  uploader: EshuushuuMetadataUser | null;
  tags: EshuushuuMetadataTag[];
  comment_count: number;
  comments: EshuushuuMetadataComment[];
};

type EshuushuuMode = "home" | "top" | "search";

// 配置字段来自 GUI（可能有类型）或 CLI --var（一定是字符串），统一按 unknown 收窄
type EshuushuuVars = {
  mode?: unknown;
  top_period?: unknown;
  search_url?: unknown;
  start_page?: unknown;
  end_page?: unknown;
};

type EshuushuuTopPeriod = {
  minNumRatings: number;
  days: number;
};

function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

// catch 变量在 strict 下是 unknown；保持原来 `e?.message ?? e` 的字符串回退语义
function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message != null) return String(message);
  }
  return String(error);
}

function labelCategory(typeName: unknown): string {
  const value = String(typeName || "").trim().toLowerCase();
  return `e-shuushuu/${LABEL_CATEGORIES.has(value) ? value : "theme"}`;
}

// label key 只允许 [a-zA-Z0-9_-]、英文括号与空格（不在首尾、不连续），≤ 64 字节；
// 丢弃字符集之外的字符，派生为空或超长的跳过（如 `^_^`），原标题仍作为显示名。
function labelKey(title: unknown): string {
  const key = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

function labelsFromTags(tags: EshuushuuTag[] | null | undefined): KabegameLabelInput[] {
  const labels: KabegameLabelInput[] = [];
  for (const tag of tags || []) {
    const key = labelKey(tag?.title);
    if (!key) continue;
    labels.push({ key, category: labelCategory(tag.type_name), name: String(tag.title).trim() });
  }
  return labels;
}

function tagTitles(tags: EshuushuuTag[] | null | undefined, typeName: string): string[] {
  return (tags || []).filter((t) => t?.type_name === typeName).map((t) => String(t.title || "").trim()).filter(Boolean);
}

function pickUser(user: EshuushuuUser | null | undefined): EshuushuuMetadataUser | null {
  if (!user) return null;
  return {
    user_id: user.user_id,
    username: user.username || "",
    avatar_url: user.avatar_url || "",
    user_title: user.user_title || "",
    groups: Array.isArray(user.groups) ? user.groups : [],
  };
}

// 列表接口带 include_comments=true 时，评论按 image_id 分组随列表一并返回，不用逐图再请求。
function pickComments(list: EshuushuuComment[] | null | undefined): EshuushuuMetadataComment[] {
  return (Array.isArray(list) ? list : []).map((c) => ({
    post_id: c.post_id,
    parent_comment_id: c.parent_comment_id ?? null,
    deleted: !!c.deleted,
    date: c.date || "",
    last_updated: c.last_updated || null,
    post_text: c.post_text || "",
    user: pickUser(c.user),
  }));
}

// metadata 存足以还原源站详情页的稳定字段（templates/description.ejs 消费）：
// 上传者卡片、分类标签、Image Information、评论。只与当前访客有关的字段
// （is_favorited / user_rating / has_open_report 等）不存。
function buildMetadata(
  image: EshuushuuImage,
  pageUrl: string,
  comments: EshuushuuMetadataComment[],
): EshuushuuMetadata {
  return {
    schema: 1,
    image_id: image.image_id,
    page_url: pageUrl,
    filename: image.filename || "",
    ext: image.ext || "",
    url: image.url || "",
    large_url: image.large ? image.large_url || "" : "",
    medium_url: image.medium ? image.medium_url || "" : "",
    thumbnail_url: image.thumbnail_url || "",
    width: image.width,
    height: image.height,
    filesize: image.filesize,
    md5: image.md5_hash || "",
    caption: image.caption || "",
    original_filename: image.original_filename || "",
    source_url: image.source_url || "",
    date_added: image.date_added || "",
    rating: image.rating ?? null,
    num_ratings: image.num_ratings ?? 0,
    bayesian_rating: image.bayesian_rating ?? null,
    favorites: image.favorites ?? 0,
    uploader: pickUser(image.user),
    tags: (image.tags || []).map((t) => ({ tag_id: t.tag_id, title: t.title, type_name: t.type_name })),
    comment_count: image.posts ?? comments.length,
    comments,
  };
}

// 元数据搜索片段覆盖 description.ejs 面板里的文字：上传者名与头衔、日期（年 / 月 / 日三词）、标签、
// ID、Favorites、Source、评论作者与正文；不含标签分类标题、冒号和 "No comments yet." 这类占位文案。
// 每张图只写一个 `e-shuushuu`；每个有值的字段只写一个裸字段名标记词，值本身不带前缀
// （逐值加前缀会让含 "e-shuushuu" 的词条膨胀到几十万行映射，搜索变慢）。
// metadata_migrations/migrate.js 的 provideSearchTextList 有一份同规则副本，改这里要同步改那里。
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function searchTextsFromMetadata(meta: EshuushuuMetadata): string[] {
  const out: string[] = ["e-shuushuu"];
  const field = (key: string, values: unknown[]) => {
    const list = values.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (list.length) out.push(key, ...list);
  };
  const up = meta.uploader;
  field("uploader", [up?.username, up?.user_title]);
  // 日期拆成年、月（英文全名）、日三个词，与详情页显示的 "September 17, 2026" 对应；取 date_added 的 UTC 日期串
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(meta.date_added || ""));
  if (ymd) field("date", [ymd[1], MONTHS[Number(ymd[2]) - 1], String(Number(ymd[3]))]);
  field("tags", (meta.tags || []).map((tag) => tag?.title));
  field("id", [meta.image_id]);
  field("favorites", [meta.favorites ?? 0]);
  field("source", [meta.source_url]);
  const comments = (meta.comments || []).filter((c) => c && !c.deleted);
  field("comments", comments.flatMap((c) => [c.user?.username, c.post_text]));
  return [...new Set(out)];
}

// 展示名：角色优先，其次作品；都没有就退回图片编号。
function displayName(image: EshuushuuImage): string {
  const tags = image.tags || [];
  const head = tagTitles(tags, "Character").slice(0, 3).join(", ") || tagTitles(tags, "Source")[0] || "e-shuushuu";
  return `${head} #${image.image_id}`;
}

// 排行榜四个范围与源站 /images/top?period=… 逐项一致（实测四个范围前两页顺序完全相同）：
// 按 bayesian_rating 降序，最少评分人数随范围放宽，非全时段用 date_from 截取最近 N 天。
// 源站排行榜最多 20 页。
const TOP_PERIODS: Record<string, EshuushuuTopPeriod> = {
  all: { minNumRatings: 5, days: 0 },
  year: { minNumRatings: 3, days: 365 },
  month: { minNumRatings: 2, days: 30 },
  week: { minNumRatings: 1, days: 7 },
};
const TOP_MAX_PAGES = 20;

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

// 搜索页 /search?… 的查询参数与 /api/v1/images 同名，页面把它们原样转给接口（实测结果逐项一致），
// 所以直接搬过来，只去掉 page（由起止页控制）。接受完整 URL，也接受只粘贴了 `?tags=…` 的查询串。
function parseSearchUrl(input: unknown): URLSearchParams {
  const raw = String(input || "").trim();
  if (!raw) throw new Error(t("searchUrlRequired"));
  let url: URL;
  try {
    url = new URL(raw.startsWith("?") ? `${DEFAULT_BASE_URL}/search${raw}` : raw);
  } catch {
    throw new Error(t("invalidUrl", { url: raw }));
  }
  if (!/(^|\.)e-shuushuu\.net$/i.test(url.hostname) || url.pathname.replace(/\/+$/, "") !== "/search") {
    throw new Error(t("searchUrlInvalid", { url: raw }));
  }
  const params = new URLSearchParams(url.search);
  params.delete("page");
  return params;
}

// 源站只展示 status 1（2 是重复图，-1 已删除），但过滤的位置因列表而异：
// - 主页与搜索页先按未过滤的列表分页、再隐藏非 1 的条目（某页可能只显示 17 张），
//   所以这两种模式不额外传 status、在本地过滤，页码才与源站对齐；
//   搜索 URL 自带 status 参数时照样转给接口，但网页仍只显示 status 1（实测 status=2 时页面一张不显示），
//   本地同样只留 1；
// - 排行榜在服务端过滤，传 status=1 后四个范围与源站逐项一致。
function buildListQuery(
  mode: EshuushuuMode,
  period: string,
  searchParams: URLSearchParams | undefined,
): URLSearchParams {
  const params = new URLSearchParams(mode === "search" ? searchParams : undefined);
  params.set("include_comments", "true");
  if (mode === "top") {
    params.set("status", "1");
    const cfg = TOP_PERIODS[period] || TOP_PERIODS.all;
    params.set("sort_by", "bayesian_rating");
    params.set("sort_order", "DESC");
    params.set("min_num_ratings", String(cfg.minNumRatings));
    if (cfg.days > 0) params.set("date_from", isoDateDaysAgo(cfg.days));
  }
  return params;
}

async function fetchPage(baseUrl: string, query: URLSearchParams, page: number): Promise<EshuushuuPage> {
  const params = new URLSearchParams(query);
  params.set("page", String(page));
  const res = await fetch(`${baseUrl}/api/v1/images?${params}`);
  if (!res.ok) throw new Error(t("listHttpError", { status: res.status }));
  // 外部 JSON 边界：只在这里断言响应形状，后续字段都按类型读取
  const data = (await res.json()) as EshuushuuListResponse;
  return {
    images: Array.isArray(data?.images) ? data.images : [],
    comments: data?.comments && typeof data.comments === "object" ? data.comments : {},
    total: data?.total ?? 0,
    lastPage: data?.total && data?.per_page ? Math.ceil(data.total / data.per_page) : Infinity,
  };
}

async function downloadOne(
  baseUrl: string,
  image: EshuushuuImage,
  rawComments: EshuushuuComment[] | null | undefined,
): Promise<void> {
  if (!image?.url) {
    warn(t("noImageUrl", { id: image?.image_id }));
    return;
  }
  const pageUrl = `${baseUrl}/images/${image.image_id}`;
  const metadata = buildMetadata(image, pageUrl, pickComments(rawComments));
  const opts: KabegameDownloadImageOptions = { name: displayName(image), url: pageUrl, metadata };
  opts.searchTexts = searchTextsFromMetadata(metadata);
  const labels = labelsFromTags(image.tags);
  if (labels.length > 0) opts.labels = labels;
  await downloadImage(image.url, opts);
}

export async function crawl(common: unknown, custom: unknown): Promise<void> {
  const cfg = (common || {}) as { baseUrl?: unknown };
  const baseUrl = String(cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const vars = (custom || {}) as EshuushuuVars;
  const requestedMode = coerceStr(vars.mode);
  const mode: EshuushuuMode = requestedMode === "top" || requestedMode === "search" ? requestedMode : "home";
  let searchParams: URLSearchParams | undefined;
  if (mode === "search") {
    try {
      searchParams = parseSearchUrl(vars.search_url);
    } catch (e) {
      warn(`[e-shuushuu] ${errorMessage(e)}`);
      addProgress(100);
      return;
    }
  }
  // 本地只留 status 1，与源站列表显示一致；排行榜已在服务端过滤
  const filterVisible = mode !== "top";
  const requestedPeriod = coerceStr(vars.top_period);
  const period = TOP_PERIODS[requestedPeriod] ? requestedPeriod : "all";
  const startPage = Math.max(1, Number(vars.start_page ?? 1) || 1);
  let endPage = Math.max(startPage, Number(vars.end_page ?? startPage) || startPage);
  if (mode === "top" && endPage > TOP_MAX_PAGES) {
    console.log(t("topPageCapped", { max: TOP_MAX_PAGES, endPage }));
    endPage = TOP_MAX_PAGES;
  }
  if (startPage > endPage) {
    warn(t("startPageOutOfRange", { startPage }));
    addProgress(100);
    return;
  }
  const query = buildListQuery(mode, period, searchParams);
  const pctPerPage = 100 / (endPage - startPage + 1);

  const titleKey = mode === "top" ? "openTop" : mode === "search" ? "openSearch" : "openHome";
  console.log(
    t(titleKey, {
      period,
      query: searchParams?.toString() || t("all"),
      startPage,
      endPage,
    }),
  );
  for (let page = startPage; page <= endPage; page += 1) {
    let result: EshuushuuPage;
    try {
      result = await fetchPage(baseUrl, query, page);
      if (page === startPage) {
        console.log(t("totalSummary", { total: result.total, pages: result.lastPage }));
        if (endPage > result.lastPage) endPage = result.lastPage;
      }
    } catch (e) {
      warn(t("pageReadFailed", { page, error: errorMessage(e) }));
      addProgress(pctPerPage);
      continue;
    }

    const { comments } = result;
    if (result.images.length === 0) {
      addProgress(pctPerPage);
      break; // 越过最后一页
    }
    const images = filterVisible ? result.images.filter((image) => image?.status === 1) : result.images;
    console.log(t("pageStart", { page, total: result.images.length, visible: images.length }));
    if (images.length === 0) {
      addProgress(pctPerPage);
      continue;
    }

    const pctPerImage = pctPerPage / images.length;
    for (const image of images) {
      try {
        await downloadOne(baseUrl, image, comments[String(image.image_id)]);
      } catch (e) {
        warn(t("downloadFailed", { id: image.image_id, error: errorMessage(e) }));
      }
      addProgress(pctPerImage);
    }
    console.log(t("pageDone", { page }));
  }
}

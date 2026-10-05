// @ts-nocheck
// e-shuushuu V8 爬虫：主页翻页 / 排行榜（全时段、年、月、周）/ 搜索 URL 三种模式。
//
// 主页 `/?page=N` 与 JSON API `/api/v1/images?page=N` 是同一份列表（每页 20 条、最新在前），
// API 一条记录里已经带齐原图 URL、标签与出处，所以不进详情页；评论用 include_comments 随列表返回。

const { addProgress, downloadImage, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://e-shuushuu.net";

// 站点标签只有四类，映射到 `e-shuushuu/<分类>` 目录；未知类型归入 theme，保证不会多出目录。
const LABEL_CATEGORIES = new Set(["artist", "source", "character", "theme"]);

function log(message) {
  console.log(`[e-shuushuu] ${message}`);
}

function labelCategory(typeName) {
  const value = String(typeName || "").trim().toLowerCase();
  return `e-shuushuu/${LABEL_CATEGORIES.has(value) ? value : "theme"}`;
}

// label key 只允许 [a-zA-Z0-9_-]、英文括号与空格（不在首尾、不连续），≤ 64 字节；
// 丢弃字符集之外的字符，派生为空或超长的跳过（如 `^_^`），原标题仍作为显示名。
function labelKey(title) {
  const key = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

function labelsFromTags(tags) {
  const labels = [];
  for (const tag of tags || []) {
    const key = labelKey(tag?.title);
    if (!key) continue;
    labels.push({ key, category: labelCategory(tag.type_name), name: String(tag.title).trim() });
  }
  return labels;
}

function tagTitles(tags, typeName) {
  return (tags || []).filter((t) => t?.type_name === typeName).map((t) => String(t.title || "").trim()).filter(Boolean);
}

function pickUser(user) {
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
function pickComments(list) {
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
function buildMetadata(image, pageUrl, comments) {
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

// 展示名：角色优先，其次作品；都没有就退回图片编号。
function displayName(image) {
  const tags = image.tags || [];
  const head = tagTitles(tags, "Character").slice(0, 3).join(", ") || tagTitles(tags, "Source")[0] || "e-shuushuu";
  return `${head} #${image.image_id}`;
}

// 排行榜四个范围与源站 /images/top?period=… 逐项一致（实测四个范围前两页顺序完全相同）：
// 按 bayesian_rating 降序，最少评分人数随范围放宽，非全时段用 date_from 截取最近 N 天。
// 源站排行榜最多 20 页。
const TOP_PERIODS = {
  all: { minNumRatings: 5, days: 0 },
  year: { minNumRatings: 3, days: 365 },
  month: { minNumRatings: 2, days: 30 },
  week: { minNumRatings: 1, days: 7 },
};
const TOP_MAX_PAGES = 20;

function isoDateDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

// 搜索页 /search?… 的查询参数与 /api/v1/images 同名，页面把它们原样转给接口（实测结果逐项一致），
// 所以直接搬过来，只去掉 page（由起止页控制）。接受完整 URL，也接受只粘贴了 `?tags=…` 的查询串。
function parseSearchUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("请填写搜索 URL");
  let url;
  try {
    url = new URL(raw.startsWith("?") ? `${DEFAULT_BASE_URL}/search${raw}` : raw);
  } catch {
    throw new Error(`不是合法的 URL：${raw}`);
  }
  if (!/(^|\.)e-shuushuu\.net$/i.test(url.hostname) || url.pathname.replace(/\/+$/, "") !== "/search") {
    throw new Error(`请填写 e-shuushuu 搜索页地址（https://e-shuushuu.net/search?…），收到：${raw}`);
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
function buildListQuery(mode, period, searchParams) {
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

async function fetchPage(baseUrl, query, page) {
  const params = new URLSearchParams(query);
  params.set("page", String(page));
  const res = await fetch(`${baseUrl}/api/v1/images?${params}`);
  if (!res.ok) throw new Error(`列表接口 HTTP ${res.status}`);
  const data = await res.json();
  return {
    images: Array.isArray(data?.images) ? data.images : [],
    comments: data?.comments && typeof data.comments === "object" ? data.comments : {},
    total: data?.total ?? 0,
    lastPage: data?.total && data?.per_page ? Math.ceil(data.total / data.per_page) : Infinity,
  };
}

async function downloadOne(baseUrl, image, rawComments) {
  if (!image?.url) {
    warn(`[e-shuushuu] 图片 #${image?.image_id} 没有原图地址，跳过`);
    return;
  }
  const pageUrl = `${baseUrl}/images/${image.image_id}`;
  const opts = { name: displayName(image), url: pageUrl, metadata: buildMetadata(image, pageUrl, pickComments(rawComments)) };
  const labels = labelsFromTags(image.tags);
  if (labels.length > 0) opts.labels = labels;
  await downloadImage(image.url, opts);
}

export async function crawl(common, custom) {
  const baseUrl = String(common?.base_url || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const vars = custom || {};
  const mode = ["top", "search"].includes(vars.mode) ? vars.mode : "home";
  let searchParams = null;
  if (mode === "search") {
    try {
      searchParams = parseSearchUrl(vars.search_url);
    } catch (e) {
      warn(`[e-shuushuu] ${e?.message ?? e}`);
      addProgress(100);
      return;
    }
  }
  // 本地只留 status 1，与源站列表显示一致；排行榜已在服务端过滤
  const filterVisible = mode !== "top";
  const period = TOP_PERIODS[vars.top_period] ? vars.top_period : "all";
  const startPage = Math.max(1, Number(vars.start_page ?? 1) || 1);
  let endPage = Math.max(startPage, Number(vars.end_page ?? startPage) || startPage);
  if (mode === "top" && endPage > TOP_MAX_PAGES) {
    log(`排行榜最多 ${TOP_MAX_PAGES} 页，结束页 ${endPage} 按 ${TOP_MAX_PAGES} 处理`);
    endPage = TOP_MAX_PAGES;
  }
  if (startPage > endPage) {
    warn(`[e-shuushuu] 起始页 ${startPage} 超出范围，任务结束`);
    addProgress(100);
    return;
  }
  const query = buildListQuery(mode, period, searchParams);
  const pctPerPage = 100 / (endPage - startPage + 1);

  const title = mode === "top" ? `排行榜（${period}）` : mode === "search" ? `搜索（${searchParams.toString() || "全部"}）` : "主页翻页";
  log(`${title}：第 ${startPage}~${endPage} 页`);
  for (let page = startPage; page <= endPage; page += 1) {
    let result;
    try {
      result = await fetchPage(baseUrl, query, page);
      if (page === startPage) {
        log(`共 ${result.total} 张，${result.lastPage} 页`);
        if (endPage > result.lastPage) endPage = result.lastPage;
      }
    } catch (e) {
      warn(`[e-shuushuu] 第 ${page} 页读取失败：${e?.message ?? e}`);
      addProgress(pctPerPage);
      continue;
    }

    const { comments } = result;
    if (result.images.length === 0) {
      addProgress(pctPerPage);
      break; // 越过最后一页
    }
    const images = filterVisible ? result.images.filter((image) => image?.status === 1) : result.images;
    log(`┌ 第 ${page} 页：${result.images.length} 条，源站可见 ${images.length} 条`);
    if (images.length === 0) {
      addProgress(pctPerPage);
      continue;
    }

    const pctPerImage = pctPerPage / images.length;
    for (const image of images) {
      try {
        await downloadOne(baseUrl, image, comments[String(image.image_id)]);
      } catch (e) {
        warn(`[e-shuushuu] 图片 #${image.image_id} 下载失败：${e?.message ?? e}`);
      }
      addProgress(pctPerImage);
    }
    log(`└ 第 ${page} 页完成`);
  }
}

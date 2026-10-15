// @ts-nocheck
// AIBooru（aibooru.online）是 Danbooru 的分支，专收 AI 生成图。和 danbooru 插件解析 HTML 不同，
// 这里全程走站点的 JSON API：列表接口用 only= 把上传者、AI 生成参数、作者评论、评论一次带回来，
// 每页一个请求就拿齐详情页上的全部信息，不再逐帖打开详情页。（2026-10 实测）

const { addProgress, downloadImage, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://aibooru.online";

// 列表接口 only= 字段：详情页侧栏 + Information + Commentary / AI Metadata 页签 + Comments 所需的全部字段
const POST_FIELDS = [
  "id",
  "created_at",
  "score",
  "up_score",
  "down_score",
  "fav_count",
  "rating",
  "source",
  "md5",
  "file_ext",
  "file_size",
  "image_width",
  "image_height",
  "tag_string_artist",
  "tag_string_model",
  "tag_string_copyright",
  "tag_string_character",
  "tag_string_general",
  "tag_string_meta",
  "file_url",
  "large_file_url",
  "is_pending",
  "is_flagged",
  "is_deleted",
  "is_banned",
  "parent_id",
  "has_children",
  "pixiv_id",
  "views",
  "media_asset[duration]",
  "uploader[id,name,level_string]",
  "approver[id,name,level_string]",
  "ai_metadata[prompt,negative_prompt,sampler,seed,steps,cfg_scale,model_hash,parameters]",
  "artist_commentary[original_title,original_description,translated_title,translated_description]",
  "comments[id,body,score,created_at,is_deleted,is_sticky,creator[id,name,level_string]]",
].join(",");

// 侧栏分组顺序与站点一致；model（分类号 6）是 AIBooru 相对 Danbooru 新增的分类，记录生成用的模型
const TAG_CATEGORY_ORDER = ["artist", "model", "copyright", "character", "general", "meta"];

const RATING_NAMES = { g: "General", s: "Sensitive", q: "Questionable", e: "Explicit" };

function coerceStr(value) {
  return value == null ? "" : String(value);
}

function trimText(value) {
  return coerceStr(value).replace(/\s+/g, " ").trim();
}

function splitTags(value) {
  return coerceStr(value).split(/\s+/).filter(Boolean);
}

// ---- 请求 ----

// 偶发会拿到空响应（实测过一次），JSON 请求统一重试两次
async function fetchJson(url, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${response.status}，返回的不是 JSON：${text.slice(0, 120)}`);
      }
      // 站点错误统一是 { success: false, error, message }，如 TagLimitError，不重试
      if (data && !Array.isArray(data) && data.success === false) {
        throw Object.assign(new Error(`${data.error}: ${data.message}`), { fatal: true });
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return data;
    } catch (error) {
      if (error?.fatal) throw new Error(`[aibooru] ${label} 失败：${error.message}`);
      lastError = error;
      console.warn(`[aibooru] ${label} 第 ${attempt} 次请求失败：${error?.message ?? error}`);
    }
  }
  throw new Error(`[aibooru] ${label} 失败：${lastError?.message ?? lastError}`);
}

// ---- 标签帖数 ----
// 列表接口不带标签帖数，侧栏的 "1girl 162k" 要另查 /tags.json。name_array 按 URL 长度切块
// （实测 ~9.8KB 返回 414，这里控制在 6KB 内），整个任务共用缓存，重复的标签只查一次。
// 帖数只用于模板展示，查不到就留空，不影响下载。
const tagCountCache = new Map();
const MAX_TAG_QUERY_LENGTH = 6000;

async function fetchTagCounts(baseUrl, names) {
  const pending = [...new Set(names)].filter((name) => !tagCountCache.has(name));
  if (pending.length === 0) return;
  const chunks = [];
  let current = [];
  let length = 0;
  for (const name of pending) {
    const part = `search[name_array][]=${encodeURIComponent(name)}&`;
    if (current.length && length + part.length > MAX_TAG_QUERY_LENGTH) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(part);
    length += part.length;
  }
  if (current.length) chunks.push(current);
  for (const chunk of chunks) {
    const url = `${baseUrl}/tags.json?${chunk.join("")}only=name,post_count&limit=1000`;
    try {
      const rows = await fetchJson(url, "查询标签帖数");
      for (const row of rows || []) tagCountCache.set(row.name, Number(row.post_count) || 0);
    } catch (error) {
      warn(`${error?.message ?? error}，本批 ${chunk.length} 个标签不显示帖数`);
    }
  }
  // 查过但站点没返回的（极少见）也记下，免得每页重查
  for (const name of pending) if (!tagCountCache.has(name)) tagCountCache.set(name, null);
}

// ---- metadata ----

function userOf(user) {
  if (!user || !user.name) return null;
  return { id: user.id ?? null, name: coerceStr(user.name), level: coerceStr(user.level_string) };
}

function postStatus(post) {
  if (post.is_banned) return "Banned";
  if (post.is_deleted) return "Deleted";
  if (post.is_flagged) return "Flagged";
  if (post.is_pending) return "Pending";
  return "Active";
}

function buildTags(post) {
  const tags = [];
  for (const type of TAG_CATEGORY_ORDER) {
    for (const name of splitTags(post[`tag_string_${type}`])) {
      tags.push({
        name,
        display: name.replace(/_/g, " "),
        type,
        count: tagCountCache.get(name) ?? null,
      });
    }
  }
  return tags;
}

function buildAiMetadata(ai) {
  if (!ai) return null;
  const parameters = ai.parameters && typeof ai.parameters === "object" ? ai.parameters : {};
  const out = {
    prompt: coerceStr(ai.prompt),
    negative_prompt: coerceStr(ai.negative_prompt),
    sampler: coerceStr(ai.sampler),
    seed: ai.seed ?? null,
    steps: ai.steps ?? null,
    cfg_scale: ai.cfg_scale ?? null,
    model_hash: coerceStr(ai.model_hash),
    parameters,
  };
  const hasValue = out.prompt || out.negative_prompt || out.sampler || out.seed != null ||
    out.steps != null || out.cfg_scale != null || out.model_hash || Object.keys(parameters).length;
  return hasValue ? out : null;
}

function buildCommentary(commentary) {
  if (!commentary) return null;
  const out = {
    original_title: coerceStr(commentary.original_title),
    original_description: coerceStr(commentary.original_description),
    translated_title: coerceStr(commentary.translated_title),
    translated_description: coerceStr(commentary.translated_description),
  };
  return Object.values(out).some(Boolean) ? out : null;
}

// 评论按时间正序（与详情页一致）；已删除的评论站点不返回正文，保留占位以还原 "[deleted]" 行
function buildComments(comments) {
  return (Array.isArray(comments) ? comments : [])
    .map((comment) => ({
      id: comment.id,
      body: comment.is_deleted ? "" : coerceStr(comment.body),
      score: comment.score ?? null,
      created_at: coerceStr(comment.created_at),
      is_deleted: !!comment.is_deleted,
      is_sticky: !!comment.is_sticky,
      creator: comment.is_deleted ? null : userOf(comment.creator),
    }))
    .sort((a, b) => coerceStr(a.created_at).localeCompare(coerceStr(b.created_at)));
}

function buildMetadata(post, baseUrl) {
  const tags = buildTags(post);
  const letter = coerceStr(post.rating);
  return {
    schema: 1,
    site: baseUrl,
    post_id: post.id,
    post_url: `${baseUrl}/posts/${post.id}`,
    tags,
    // 按侧栏分组顺序拼的完整 tag 串，二次检索 / 生图可直接用
    tags_string: tags.map((tag) => tag.name).join(" "),
    rating: RATING_NAMES[letter] || letter,
    rating_code: letter,
    score: post.score ?? null,
    up_score: post.up_score ?? null,
    down_score: post.down_score ?? null,
    fav_count: post.fav_count ?? null,
    views: post.views ?? null,
    status: postStatus(post),
    md5: coerceStr(post.md5),
    file_ext: coerceStr(post.file_ext),
    file_size: post.file_size ?? null,
    width: post.image_width ?? null,
    height: post.image_height ?? null,
    duration: post.media_asset?.duration ?? null,
    created_at: coerceStr(post.created_at),
    source: coerceStr(post.source),
    pixiv_id: post.pixiv_id ?? null,
    parent_id: post.parent_id ?? null,
    has_children: !!post.has_children,
    uploader: userOf(post.uploader),
    approver: userOf(post.approver),
    original_url: coerceStr(post.file_url),
    sample_url: coerceStr(post.large_file_url),
    commentary: buildCommentary(post.artist_commentary),
    ai_metadata: buildAiMetadata(post.ai_metadata),
    comments: buildComments(post.comments),
  };
}

// ---- labels / searchTexts ----
// 标签画册：站点六类标签各自映射到 `aibooru/<分类>`；未知分类按 general 处理。
// key 用站点 tag 名（小写、丢掉 key 字符集之外的字符），派生后为空或超长的跳过。
const LABEL_CATEGORIES = new Set(TAG_CATEGORY_ORDER);

function tagLabelKey(name) {
  const key = coerceStr(name)
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

function labelsFromTags(tags) {
  const labels = [];
  for (const tag of tags) {
    const key = tagLabelKey(tag.name);
    if (!key) continue;
    labels.push({
      key,
      category: `aibooru/${LABEL_CATEGORIES.has(tag.type) ? tag.type : "general"}`,
      name: tag.display || key,
    });
  }
  return labels;
}

// 元数据搜索片段：覆盖模板里的标签、Information、Commentary 与 AI Metadata 文字；
// 每个有值的字段只写一个裸字段名标记词，值本身不带前缀（同 danbooru，避免映射膨胀）。
// 评论正文不收录：量大且多为寒暄，会让元数据搜索命中大量无关图片。
// 宿主拒收超过 1024 字符的条目：prompt / 负面词按逗号、换行拆成短语（也正是用户会搜的粒度），
// 其余长文本按 1000 字符切段。
const SEARCH_TEXT_MAX = 1000;

function chunkText(text) {
  const value = trimText(text);
  const chunks = [];
  for (let i = 0; i < value.length; i += SEARCH_TEXT_MAX) chunks.push(value.slice(i, i + SEARCH_TEXT_MAX));
  return chunks;
}

function promptPhrases(prompt) {
  return coerceStr(prompt)
    .split(/[,\n]|\bBREAK\b/)
    .flatMap((phrase) => chunkText(phrase));
}

function searchTextsFromMetadata(meta) {
  const out = ["aibooru"];
  const field = (key, values) => {
    const list = values.flatMap((value) => chunkText(value));
    if (list.length) out.push(key, ...list);
  };
  field("tags", meta.tags.flatMap((tag) => [tag.name, tag.display]));
  field("id", [meta.post_id]);
  field("uploader", [meta.uploader?.name]);
  field("approver", [meta.approver?.name]);
  field("source", [meta.source]);
  field("rating", [meta.rating]);
  field("status", [meta.status]);
  const commentary = meta.commentary || {};
  field("commentary", [
    commentary.original_title,
    commentary.original_description,
    commentary.translated_title,
    commentary.translated_description,
  ]);
  const ai = meta.ai_metadata;
  if (ai) {
    field("prompt", promptPhrases(ai.prompt));
    field("negative_prompt", promptPhrases(ai.negative_prompt));
    field("sampler", [ai.sampler]);
    field("seed", [ai.seed]);
    field("model", [ai.parameters?.Model, ai.model_hash]);
  }
  return [...new Set(out)];
}

// ---- 下载 ----

// 质量分流：high = 原图；medium = 站点的 sample（large_file_url，没有 sample 时它就是原图）。
// ugoira 的原文件是 zip，large_file_url 才是可播放的 webm，无论质量都取后者。
function pickMediaUrl(post, quality) {
  if (coerceStr(post.file_ext) === "zip") return coerceStr(post.large_file_url);
  if (quality === "medium") return coerceStr(post.large_file_url) || coerceStr(post.file_url);
  return coerceStr(post.file_url) || coerceStr(post.large_file_url);
}

async function downloadPost(post, baseUrl, quality) {
  const mediaUrl = pickMediaUrl(post, quality);
  if (!mediaUrl) {
    // 被 ban 的作品（和极少数受限作品）接口不给文件地址
    console.warn(`[aibooru] #${post.id} 没有可下载的文件地址（${postStatus(post)}），跳过`);
    return;
  }
  const metadata = buildMetadata(post, baseUrl);
  const opts = {
    url: metadata.post_url,
    metadata,
    searchTexts: searchTextsFromMetadata(metadata),
  };
  const labels = labelsFromTags(metadata.tags);
  if (labels.length > 0) opts.labels = labels;
  await downloadImage(mediaUrl, opts);
}

// 网页列表先分页、再隐藏已删除的作品（2026-10 实测，JSON 照常返回它们），
// 这里同样在分页之后过滤，保证抓到的就是网页上那一页看到的作品。
function visiblePosts(posts, ratingLetter = "") {
  return (Array.isArray(posts) ? posts : [])
    .filter((post) => post && !post.is_deleted)
    .filter((post) => !ratingLetter || coerceStr(post.rating) === ratingLetter);
}

async function downloadPage(posts, baseUrl, quality, pageProgress, label) {
  await fetchTagCounts(baseUrl, posts.flatMap((post) => TAG_CATEGORY_ORDER.flatMap((type) => splitTags(post[`tag_string_${type}`]))));
  for (const [index, post] of posts.entries()) {
    try {
      await downloadPost(post, baseUrl, quality);
    } catch (error) {
      warn(`[aibooru][${label}] #${post.id} 处理失败：${error?.message ?? error}`);
    }
    if ((index + 1) % 20 === 0) console.log(`[aibooru][${label}]   已入队 ${index + 1}/${posts.length}`);
    addProgress(pageProgress / posts.length);
  }
}

// ---- 配置解析 ----

function normalizeTagToken(text) {
  return trimText(text).replace(/\s+/g, "_");
}

// list 类型经 GUI 传进来是数组，kabegame-cli 的 --var 只能给字符串：按逗号/空白/加号切开
function parseTagList(tagList) {
  const items = Array.isArray(tagList) ? tagList : coerceStr(tagList).split(/[,+\s]+/);
  return items.map((tag) => normalizeTagToken(tag)).filter(Boolean);
}

const RATING_LETTERS = new Set(["g", "s", "q", "e"]);

function ratingLetterOf(vars) {
  const letter = trimText(vars.rating).toLowerCase();
  return RATING_LETTERS.has(letter) ? letter : "";
}

function withRatingToken(tags, vars) {
  const letter = ratingLetterOf(vars);
  return letter ? [...tags, `rating:${letter}`] : tags;
}

function normalizePerPage(value) {
  const parsed = Number(value ?? 100);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(200, Math.floor(parsed));
}

function parsePageRange(vars) {
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  if (!Number.isSafeInteger(startPage) || startPage < 1) throw new Error("起始页面需要是正整数");
  if (!Number.isSafeInteger(endPage) || endPage < startPage) throw new Error("结束页面需要不小于起始页面");
  if (endPage >= startPage + 100) throw new Error("在一次之内不允许爬取超过100页，咱二次元人要保持文明礼仪");
  return { startPage, endPage };
}

function postsUrl(baseUrl, tags, perPage, page) {
  const params = [];
  if (tags.length) params.push(`tags=${encodeURIComponent(tags.join(" "))}`);
  params.push(`limit=${perPage}`, `page=${page}`, `only=${POST_FIELDS}`);
  return `${baseUrl}/posts.json?${params.join("&")}`;
}

// ---- 各模式 ----

async function crawlSearch(baseUrl, quality, vars, tags, label) {
  const { startPage, endPage } = parsePageRange(vars);
  const perPage = normalizePerPage(vars.per_page);
  const pageProgress = 95 / (endPage - startPage + 1);
  for (let page = startPage; page <= endPage; page += 1) {
    const url = postsUrl(baseUrl, tags, perPage, page);
    console.log(`[aibooru][${label}] 第 ${page}/${endPage} 页：tags=「${tags.join(" ")}」`);
    const raw = await fetchJson(url, `第 ${page} 页列表`);
    if (!Array.isArray(raw) || raw.length === 0) {
      console.log(`[aibooru][${label}] 第 ${page} 页没有作品，结束`);
      addProgress(pageProgress);
      break;
    }
    const posts = visiblePosts(raw);
    console.log(`[aibooru][${label}] 第 ${page} 页 ${raw.length} 个作品，可见 ${posts.length} 个`);
    if (posts.length === 0) {
      addProgress(pageProgress);
      continue;
    }
    await downloadPage(posts, baseUrl, quality, pageProgress, label);
  }
}

const MAX_SEARCH_TAGS = 4;

async function crawlByTags(baseUrl, quality, vars) {
  const tags = parseTagList(vars.mode_tag_value);
  if (tags.length === 0) throw new Error("标签模式需要至少填写一个标签");
  // 站点对未登录访问限制每次最多 4 个标签（rating:/status:/id: 不占名额，order: 占），超了直接返回 TagLimitError
  const counted = tags.filter((tag) => !/^-?(rating|status|id):/i.test(tag));
  if (counted.length > MAX_SEARCH_TAGS) {
    throw new Error(`一次最多检索 ${MAX_SEARCH_TAGS} 个标签（rating:、status:、id: 不计入），当前 ${counted.length} 个：${counted.join(" ")}`);
  }
  await crawlSearch(baseUrl, quality, vars, withRatingToken(tags, vars), "tags");
}

async function crawlAll(baseUrl, quality, vars) {
  await crawlSearch(baseUrl, quality, vars, withRatingToken([], vars), "all");
}

// 人气榜：接口不接受 tags，分级只能按每张图的 rating 在插件里筛。
// 站点按 America/New_York 计「今天」，刚过午夜时日榜为空（网页同样是空的）；
// 这时自动改看前一天，避免定时任务在零点附近白跑。
// 兜底只在零点刚过时触发，夏令时差的一小时恰好落在这个窗口里，所以不能写死偏移：
// 从站点最新作品的 created_at（形如 2026-10-15T00:43:12.000-04:00）取当前 UTC 偏移，再算前一天。
async function previousSiteDate(baseUrl) {
  let offsetMinutes = -4 * 60;
  try {
    const latest = await fetchJson(`${baseUrl}/posts.json?limit=1&only=created_at`, "读取站点时区");
    const matched = /([+-])(\d{2}):(\d{2})$/.exec(coerceStr(latest?.[0]?.created_at));
    if (matched) offsetMinutes = (matched[1] === "-" ? -1 : 1) * (Number(matched[2]) * 60 + Number(matched[3]));
  } catch (error) {
    console.warn(`${error?.message ?? error}，按 UTC-4 计算站点日期`);
  }
  return new Date(Date.now() + offsetMinutes * 60e3 - 86400e3).toISOString().slice(0, 10);
}

async function crawlPopular(baseUrl, quality, vars) {
  const scale = ["day", "week", "month"].includes(coerceStr(vars.popular_scale)) ? coerceStr(vars.popular_scale) : "day";
  const { startPage, endPage } = parsePageRange(vars);
  const perPage = normalizePerPage(vars.per_page);
  const ratingLetter = ratingLetterOf(vars);
  const pageProgress = 95 / (endPage - startPage + 1);
  let date = "";
  for (let page = startPage; page <= endPage; page += 1) {
    const makeUrl = () =>
      `${baseUrl}/explore/posts/popular.json?scale=${scale}${date ? `&date=${date}` : ""}&limit=${perPage}&page=${page}&only=${POST_FIELDS}`;
    console.log(`[aibooru][popular-${scale}] 第 ${page}/${endPage} 页${date ? `（${date}）` : ""}`);
    let raw = await fetchJson(makeUrl(), `人气榜第 ${page} 页`);
    if ((!Array.isArray(raw) || raw.length === 0) && scale === "day" && page === startPage && !date) {
      date = await previousSiteDate(baseUrl);
      console.log(`[aibooru][popular-day] 今天的日榜还没有作品，改抓 ${date} 的日榜`);
      raw = await fetchJson(makeUrl(), `人气榜第 ${page} 页（${date}）`);
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      console.log(`[aibooru][popular-${scale}] 第 ${page} 页没有作品，结束`);
      addProgress(pageProgress);
      break;
    }
    const posts = visiblePosts(raw, ratingLetter);
    console.log(`[aibooru][popular-${scale}] 第 ${page} 页 ${raw.length} 个作品，符合条件 ${posts.length} 个`);
    if (posts.length === 0) {
      // 这一页都被分级筛掉了，后面的页仍可能有符合的
      addProgress(pageProgress);
      continue;
    }
    await downloadPage(posts, baseUrl, quality, pageProgress, `popular-${scale}`);
  }
}

// id 范围：id:A..B 闭区间 + order:id 升序。搜索串里加 -status:deleted，让计数与实际可见的作品一致。
const MAX_ID_SPAN = 5000;

function parsePostId(value, label) {
  const text = trimText(value);
  const id = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${label}需要是正整数，当前为「${text}」`);
  return id;
}

async function countPosts(baseUrl, tags) {
  try {
    const data = await fetchJson(`${baseUrl}/counts/posts.json?tags=${encodeURIComponent(tags.join(" "))}`, "统计作品数");
    const count = data?.counts?.posts;
    return Number.isSafeInteger(count) ? count : null;
  } catch {
    return null;
  }
}

async function crawlByIdRange(baseUrl, quality, vars) {
  const startId = parsePostId(vars.id_start, "起始 id");
  const endId = parsePostId(vars.id_end, "结束 id");
  if (endId < startId) throw new Error(`结束 id（${endId}）需要不小于起始 id（${startId}）`);
  if (endId - startId > MAX_ID_SPAN) {
    throw new Error(`id 范围最多相差 ${MAX_ID_SPAN}，当前 ${startId}..${endId} 相差 ${endId - startId}`);
  }
  const tags = withRatingToken([`id:${startId}..${endId}`, "order:id", "-status:deleted"], vars);
  const perPage = normalizePerPage(vars.per_page);
  const total = await countPosts(baseUrl, tags);
  console.log(`[aibooru][id] id ${startId}..${endId}，共 ${total ?? "未知"} 个作品`);
  if (total === 0) return;
  const estimatedPages = Math.max(1, Math.ceil((total ?? endId - startId + 1) / perPage));
  const pageProgress = 95 / estimatedPages;
  // 每页至少推进一个 id，页数不会超过区间宽度；这只是防止站点忽略 page 参数时死循环
  const maxPages = endId - startId + 1;
  let previousFirst = null;
  let seen = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    console.log(`[aibooru][id] 第 ${page}/${total == null ? "?" : estimatedPages} 页`);
    const raw = await fetchJson(postsUrl(baseUrl, tags, perPage, page), `id 范围第 ${page} 页`);
    if (!Array.isArray(raw) || raw.length === 0 || raw[0].id === previousFirst) break;
    previousFirst = raw[0].id;
    await downloadPage(visiblePosts(raw), baseUrl, quality, pageProgress, "id");
    seen += raw.length;
    if (total != null && seen >= total) break;
  }
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = coerceStr(common?.baseUrl || common?.base_url || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const quality = coerceStr(vars.quality || "high");
  const mode = coerceStr(vars.crawl_mode || "tags");
  console.log(`[aibooru] 模式 ${mode}，分级 ${ratingLetterOf(vars) || "不限"}，质量 ${quality}`);

  if (mode === "all") await crawlAll(baseUrl, quality, vars);
  else if (mode === "tags") await crawlByTags(baseUrl, quality, vars);
  else if (mode === "popular") await crawlPopular(baseUrl, quality, vars);
  else if (mode === "id_range") await crawlByIdRange(baseUrl, quality, vars);
  else throw new Error(`未知的爬取模式: ${mode}`);
}

// @ts-nocheck
import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";
import { t } from "./i18n";

const { addProgress, downloadImage, warn } = Kabegame;

const BASE_URL = "https://safebooru.org";

// 每页 42 条与网页列表一致：dapi 的 pid 是页号（不是偏移量），limit=42 + pid=页号-1
// 与 index.php?page=post&s=list 的同页逐条相同（实测 全部 / 标签 / sort: 元标签 均一致）。
const POSTS_PER_PAGE = 42;
// 翻页深度硬上限：起始偏移（limit × pid）≤ 200000 才能取，超过就返回 "API limited due to abuse."
// （实测 limit=1&pid=200000 可以、200001 不行；网页列表同一位置截断，换 HTML 没用）。
// 42 张一页时最多直接翻到第 4762 页，再往后只有按 id 倒序的默认排序能靠 id:< 游标继续。
const MAX_API_OFFSET = 200000;

// 分类名与详情页侧栏 li.tag-type-* 一致。tag_info 里的通用标签叫 "tag"，
// 另有少数标签 type 为 null，页面上都按 general 渲染。
const TAG_CATEGORIES = ["copyright", "character", "artist", "general", "metadata"];

function coerceStr(value) {
  return value == null ? "" : String(value);
}

function trimText(value) {
  return coerceStr(value).replace(/\s+/g, " ").trim();
}

function textOf(el) {
  return trimText(el?.textContent || "");
}

function parseHtml(html) {
  return new DOMParser().parseFromString(coerceStr(html), "text/html");
}

function resolveUrl(url, base) {
  const raw = coerceStr(url).trim();
  return raw ? resolveSdkUrl(raw, base) : "";
}

function normalizeTagToken(text) {
  return trimText(text).replace(/\s+/g, "_");
}

// list 类型经 GUI 传进来是数组，kabegame-cli 的 --var 只能给字符串：按逗号/空白/加号切开
function tagListOf(tagList) {
  const items = Array.isArray(tagList) ? tagList : coerceStr(tagList).split(/[,+\s]+/);
  return items.map((tag) => normalizeTagToken(tag)).filter(Boolean);
}

function categoryOfType(type) {
  const value = coerceStr(type).trim().toLowerCase();
  if (!value || value === "tag") return "general";
  return TAG_CATEGORIES.includes(value) ? value : "general";
}

// XML 属性值和 API 里的标签名（adam&#039;s_apple、&gt;_&lt;）都是 HTML 转义过的
function decodeXmlEntities(text) {
  return coerceStr(text)
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

function xmlAttrs(tagText) {
  const attrs = {};
  for (const m of coerceStr(tagText).matchAll(/([a-z_]+)="([^"]*)"/gi)) {
    attrs[m[1]] = decodeXmlEntities(m[2]);
  }
  return attrs;
}

// ---------------------------------------------------------------------------
// dapi 请求
// ---------------------------------------------------------------------------

// 一次列表请求：tokens 是完整搜索串（可能已带 id:< 游标），pid 是按 limit 计的页号。
// 空标签不传 tags 参数：dapi 里 tags=all 会被当成真实标签 all，结果为空。
// format：json 带 tag_info（列表页用），bare 只要 id（游标跳转用），xml 取发布时间。
function buildApiUrl(baseUrl, query, format) {
  const params = ["page=dapi", "s=post", "q=index", `limit=${query.limit ?? POSTS_PER_PAGE}`, `pid=${query.pid}`];
  if (format === "json") params.push("json=1", "fields=tag_info");
  if (format === "bare") params.push("json=1");
  if (query.tokens.length > 0) params.push(`tags=${query.tokens.map((t) => encodeURIComponent(t)).join("+")}`);
  return `${baseUrl}/index.php?${params.join("&")}`;
}

async function fetchText(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return await resp.text();
}

class ApiOffsetLimitError extends Error {}

// 出错时 JSON 接口也回一段 XML：<response success="false" reason="…"/>
function throwIfApiError(body) {
  const m = /<response\b[^>]*success="false"[^>]*>/i.exec(body);
  if (!m) return;
  const reason = xmlAttrs(m[0]).reason || t("unknownReason");
  if (/limited/i.test(reason)) throw new ApiOffsetLimitError(reason);
  throw new Error(t("apiRejected", { reason }));
}

// 没有结果时 body 是空串，不是 []
async function fetchPostsJson(baseUrl, query, format = "json") {
  const body = (await fetchText(buildApiUrl(baseUrl, query, format))).trim();
  if (!body) return [];
  throwIfApiError(body);
  const data = JSON.parse(body);
  return Array.isArray(data) ? data : [];
}

// "Thu Sep 20 23:30:03 +0200 2018" → "2018-09-20T23:30:03+02:00"
const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
function parseCreatedAt(text) {
  const m = /^\w{3} (\w{3}) (\d{1,2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2}) (\d{4})$/.exec(trimText(text));
  if (!m || !MONTHS[m[1]]) return "";
  return `${m[6]}-${MONTHS[m[1]]}-${m[2].padStart(2, "0")}T${m[3]}${m[4]}:${m[5]}`;
}

// JSON 没有发布时间和上传者 id，只有 XML 有（XML 的 rating 全是旧单字母，不可信，不取）。
// 同参数再取一次 XML，按 id 合并；失败只影响这两个字段。
async function fetchPostsXmlExtras(baseUrl, query, page) {
  const extras = new Map();
  try {
    const body = await fetchText(buildApiUrl(baseUrl, query, "xml"));
    throwIfApiError(body);
    for (const m of body.matchAll(/<post\b[^>]*>/g)) {
      const attrs = xmlAttrs(m[0]);
      if (!attrs.id) continue;
      extras.set(String(attrs.id), {
        created_at: parseCreatedAt(attrs.created_at),
        creator_id: attrs.creator_id || "",
      });
    }
  } catch (e) {
    warn(t("xmlExtrasFailed", { page, error: e?.message ?? e }));
  }
  return extras;
}

// ---------------------------------------------------------------------------
// 评论：dapi 的 s=comment 返回的 created_at 全是当前时间（服务端 bug），
// 所以从详情页 #comment-list 解析，那里有真实发布时间和评论分数。
// ---------------------------------------------------------------------------

function postPageUrl(baseUrl, id) {
  return `${baseUrl}/index.php?page=post&s=view&id=${id}`;
}

function parseComments(document, pageUrl) {
  return Array.from(document.querySelectorAll('#comment-list > div[id^="c"]'))
    .map((div) => {
      const userAnchor = div.querySelector(".col1 > a");
      const info = textOf(div.querySelector(".col1 b"));
      const body = div.querySelector(".col2");
      // <br> 换行保留下来，模板用 pre-wrap 显示
      const bodyText = coerceStr(body?.innerHTML || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "");
      return {
        id: div.getAttribute("id").replace(/^c/, ""),
        user: textOf(userAnchor),
        user_href: resolveUrl(userAnchor?.getAttribute("href"), pageUrl),
        posted_at: /Posted on\s+([\d-]+\s+[\d:]+)/.exec(info)?.[1] || "",
        score: Number(/Score:\s*(-?\d+)/.exec(info)?.[1] ?? 0),
        body: decodeXmlEntities(bodyText).split("\n").map((line) => line.trim()).join("\n").trim(),
      };
    })
    .filter((c) => c.id && (c.user || c.body));
}

// 详情页每页 10 条评论，&pid=<偏移> 翻页；热门帖可能上百条，最多取 10 页
const COMMENTS_PER_PAGE = 10;
const MAX_COMMENT_PAGES = 10;

async function fetchComments(baseUrl, id, expected) {
  const comments = [];
  const seen = new Set();
  try {
    for (let page = 0; page < MAX_COMMENT_PAGES && comments.length < expected; page += 1) {
      const offset = page * COMMENTS_PER_PAGE;
      const pageUrl = postPageUrl(baseUrl, id) + (offset > 0 ? `&pid=${offset}` : "");
      const batch = parseComments(parseHtml(await fetchText(pageUrl)), pageUrl).filter((c) => !seen.has(c.id));
      if (batch.length === 0) break;
      for (const c of batch) {
        seen.add(c.id);
        comments.push(c);
      }
    }
  } catch (e) {
    warn(t("commentsFetchFailed", { id, count: comments.length, error: e?.message ?? e }));
  }
  return comments;
}

// ---------------------------------------------------------------------------
// metadata / labels / searchTexts
// ---------------------------------------------------------------------------

function tagsOf(post) {
  // tag_info 顺序是字母序，与 tags 串一致；缺失时退回 tags 串（分类一律 general）
  const info = Array.isArray(post.tag_info) ? post.tag_info : [];
  if (info.length > 0) {
    return info
      .filter((t) => t && t.tag)
      .map((t) => ({
        name: decodeXmlEntities(t.tag),
        type: categoryOfType(t.type),
        count: Number(t.count) || 0,
      }));
  }
  return coerceStr(post.tags)
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => ({ name: decodeXmlEntities(name), type: "general", count: 0 }));
}

// AI 生图直接可用的完整 tag 串：按侧栏分类顺序拼，组内保持原序
function buildTagsString(tags) {
  const ordered = [];
  for (const category of TAG_CATEGORIES) {
    for (const tag of tags) if (tag.type === category) ordered.push(tag.name);
  }
  return ordered.join(" ");
}

function groupTagsByType(tags) {
  const grouped = {};
  for (const tag of tags) (grouped[tag.type] || (grouped[tag.type] = [])).push(tag.name);
  return grouped;
}

function fileExtOf(name) {
  return /\.([a-z0-9]+)$/i.exec(coerceStr(name))?.[1]?.toLowerCase() || "";
}

function buildMetadata(post, extra, comments, baseUrl) {
  const tags = tagsOf(post);
  return {
    schema: 1,
    post_id: Number(post.id),
    post_url: postPageUrl(baseUrl, post.id),
    tags_string: buildTagsString(tags),
    tags,
    tags_by_type: groupTagsByType(tags),
    rating: coerceStr(post.rating),
    // 0 分时 API 给 null，详情页显示 0
    score: Number(post.score) || 0,
    width: Number(post.width) || 0,
    height: Number(post.height) || 0,
    file_ext: fileExtOf(post.image),
    md5: coerceStr(post.hash),
    owner: coerceStr(post.owner),
    creator_id: extra?.creator_id || "",
    created_at: extra?.created_at || "",
    updated_at: Number(post.change) || 0,
    source: coerceStr(post.source).trim(),
    parent_id: Number(post.parent_id) || 0,
    status: coerceStr(post.status),
    has_notes: !!post.has_notes,
    comment_count: Number(post.comment_count) || 0,
    file_url: coerceStr(post.file_url),
    sample_url: post.sample ? coerceStr(post.sample_url) : "",
    sample_width: post.sample ? Number(post.sample_width) || 0 : 0,
    sample_height: post.sample ? Number(post.sample_height) || 0 : 0,
    preview_url: coerceStr(post.preview_url),
    comments,
  };
}

// 标签画册：`safebooru/<分类>`，key 用站点规范标签名，显示名把下划线换成空格（与侧栏一致）。
// 宿主只接受 [a-z0-9_-()空格]。字符集外的字符不能直接删：:p 与 ;p、^_^ 与 =_= 会撞成同一个 key，
// 把不同标签并进一个画册。所以逐字符编码成 (u<十六进制码点>)，保证一一对应（:p → (u3a)p）。
// 结果全是 ASCII，length 即字节数；超过 64 字节就跳过。
function tagLabelKey(name) {
  let key = "";
  for (const ch of coerceStr(name).toLowerCase()) {
    key += /[a-z0-9_\-() ]/.test(ch) ? ch : `(u${ch.codePointAt(0).toString(16)})`;
  }
  key = key.replace(/\s+/g, " ").trim();
  return key && key.length <= 64 ? key : "";
}

function displayOf(name) {
  return coerceStr(name).replace(/_/g, " ");
}

function labelsFromTags(tags) {
  const labels = [];
  for (const tag of tags) {
    const key = tagLabelKey(tag.name);
    if (!key) continue;
    labels.push({ key, category: `safebooru/${tag.type}`, name: displayOf(tag.name) });
  }
  return labels;
}

// 覆盖详情模板里展示给用户的原文：标签（显示名）、上传者、来源、id、评论
function searchTextsFromMetadata(meta) {
  const out = ["safebooru"];
  const field = (key, values) => {
    const list = values.map((value) => trimText(value)).filter(Boolean);
    if (list.length) out.push(key, ...list);
  };
  field("tags", meta.tags.map((tag) => displayOf(tag.name)));
  field("id", [meta.post_id]);
  field("uploader", [meta.owner]);
  field("source", [meta.source]);
  field("comments", (meta.comments || []).flatMap((c) => [c.user, c.body]));
  return [...new Set(out)];
}

// 展示名：角色优先，其次作品，都没有退回帖子编号
function displayName(meta) {
  const names = (type) => (meta.tags_by_type[type] || []).map(displayOf);
  const head = names("character").slice(0, 3).join(", ") || names("copyright")[0] || "safebooru";
  return `${head} #${meta.post_id}`;
}

// ---------------------------------------------------------------------------
// 列表爬取
// ---------------------------------------------------------------------------

// 质量分流：medium 只有站点生成过 sample（sample=true）才不同于原图
function pickMediaUrl(post, quality) {
  if (quality === "medium" && post.sample && post.sample_url) return coerceStr(post.sample_url);
  return coerceStr(post.file_url);
}

async function processPost(post, extra, ctx) {
  const mediaUrl = pickMediaUrl(post, ctx.quality);
  if (!mediaUrl) {
    warn(t("noMediaUrl", { id: post.id }));
    return;
  }
  const comments = ctx.fetchComments && Number(post.comment_count) > 0
    ? await fetchComments(ctx.baseUrl, post.id, Number(post.comment_count))
    : [];
  const meta = buildMetadata(post, extra, comments, ctx.baseUrl);
  const opts = {
    name: displayName(meta),
    url: meta.post_url,
    metadata: meta,
    searchTexts: searchTextsFromMetadata(meta),
  };
  const labels = labelsFromTags(meta.tags);
  if (labels.length > 0) opts.labels = labels;
  await downloadImage(mediaUrl, opts);
}

// 默认排序就是按 id 倒序，id:< 游标与它完全等价；带任何 sort: 元标签都不是
function isIdOrder(tokens) {
  return !tokens.some((t) => /^sort:/i.test(t));
}

function withCursor(tokens, cursorId) {
  return cursorId == null ? tokens : tokens.concat(`id:<${cursorId}`);
}

// 翻页器：把页号翻译成一次列表请求 { tokens, pid }。
// 起始偏移在上限内时直接按 pid 翻，与网页列表逐页一致；默认排序超过上限时改用 id 游标：
// 先用 limit=1 每跳 200001 条定位到目标页前一条的 id，再取 id:<该 id 的第一页；
// 进入游标模式后，下一页直接接在上一页最后一条之后（id:<末条 id），不再跳转。
// 实测第 4763 页与第 4762 页末条首尾相接，第 20000 页约 6 个请求定位。
function createPager(baseUrl, tokens) {
  const idOrder = isIdOrder(tokens);
  let cursorId = null;
  // 上一次取到的页及其末条 id：从上限内连续翻过来时，越界的那一页直接接在它后面，不用跳转
  let lastPage = 0;
  let lastId = null;

  async function jumpByHops(page) {
    let remaining = (page - 1) * POSTS_PER_PAGE;
    let cur = null;
    let hops = 0;
    const hop = async (pid) => {
      hops += 1;
      const [post] = await fetchPostsJson(baseUrl, { tokens: withCursor(tokens, cur), limit: 1, pid }, "bare");
      return post ? Number(post.id) : null;
    };
    while (remaining > MAX_API_OFFSET) {
      cur = await hop(MAX_API_OFFSET);
      if (cur == null) return null;
      remaining -= MAX_API_OFFSET + 1;
    }
    if (remaining > 0) {
      cur = await hop(remaining - 1);
      if (cur == null) return null;
    }
    console.log(t("pagerLocatedByHops", { page, hops, id: cur }));
    cursorId = cur;
    return { tokens: withCursor(tokens, cur), pid: 0 };
  }

  return {
    idOrder,
    // null 表示目标页已经超出结果总数
    async locate(page) {
      if (cursorId != null) return { tokens: withCursor(tokens, cursorId), pid: 0 };
      if (idOrder && (page - 1) * POSTS_PER_PAGE > MAX_API_OFFSET) return await this.jump(page);
      return { tokens, pid: page - 1 };
    },
    async jump(page) {
      if (idOrder && lastPage === page - 1 && lastId != null) {
        console.log(t("pagerContinueFromLast", { page, id: lastId }));
        cursorId = lastId;
        return { tokens: withCursor(tokens, cursorId), pid: 0 };
      }
      return await jumpByHops(page);
    },
    // 记住本页末条；游标模式下它就是下一页的游标
    advance(page, posts) {
      if (posts.length === 0) return;
      lastPage = page;
      lastId = Number(posts[posts.length - 1].id);
      if (cursorId != null) cursorId = lastId;
    },
  };
}

// 与 kbConfig 的 sort_order 选项名一致；显示名走 i18n，用户自己在标签里写的 sort: 元标签原样显示
const SORT_NAMES = { "sort:score:desc": "sortScoreDesc", "sort:updated:desc": "sortUpdatedDesc", "sort:random": "sortRandom" };

function offsetLimitError(page, tokens) {
  const sort = tokens.find((token) => /^sort:/i.test(token));
  const sortName = sort ? (SORT_NAMES[sort.toLowerCase()] ? t(SORT_NAMES[sort.toLowerCase()]) : sort) : "";
  const lastPage = Math.floor(MAX_API_OFFSET / POSTS_PER_PAGE) + 1;
  return new Error(
    t("offsetLimit", {
      page,
      maxOffset: MAX_API_OFFSET,
      perPage: POSTS_PER_PAGE,
      lastPage,
      sort: sortName,
    }),
  );
}

async function fetchListPage(pager, page, ctx) {
  let query = await pager.locate(page);
  if (!query) return { query: null, posts: [] };
  try {
    return { query, posts: await fetchPostsJson(ctx.baseUrl, query) };
  } catch (e) {
    if (!(e instanceof ApiOffsetLimitError)) throw e;
    // 站点上限若比 MAX_API_OFFSET 收紧，默认排序照样能改走游标
    if (!pager.idOrder) throw offsetLimitError(page, query.tokens);
    query = await pager.jump(page);
    if (!query) return { query: null, posts: [] };
    return { query, posts: await fetchPostsJson(ctx.baseUrl, query) };
  }
}

// 返回本页帖子数；0 表示到底了
async function crawlApiPage(pager, page, ctx, pageProgress, label) {
  const { query, posts } = await fetchListPage(pager, page, ctx);
  if (posts.length === 0) {
    addProgress(pageProgress);
    return 0;
  }
  pager.advance(page, posts);
  const extras = await fetchPostsXmlExtras(ctx.baseUrl, query, page);
  console.log(t("pagePosts", { label, page, count: posts.length }));
  for (const post of posts) {
    try {
      await processPost(post, extras.get(String(post.id)), ctx);
    } catch (e) {
      warn(t("postFailed", { id: post?.id, error: e?.message ?? e }));
    }
    addProgress(pageProgress / posts.length);
  }
  return posts.length;
}

// totalProgress：这段页范围占整个任务的进度份额
async function crawlPages(tokens, ctx, startPage, endPage, label, totalProgress = 99.0) {
  const pageProgress = totalProgress / (endPage - startPage + 1);
  console.log(t("searchRange", { label, tags: tokens.join(" ") || t("allTags"), startPage, endPage }));
  const pager = createPager(ctx.baseUrl, tokens);
  for (let page = startPage; page <= endPage; page += 1) {
    const count = await crawlApiPage(pager, page, ctx, pageProgress, label);
    if (count === 0) {
      console.log(t("emptyPageStop", { label, page }));
      addProgress(pageProgress * (endPage - page));
      break;
    }
  }
}

function validatePageRange(startPage, endPage) {
  if (endPage < startPage) throw new Error(t("endPageBeforeStart"));
  if (endPage >= startPage + 100) throw new Error(t("pageRangeTooLarge"));
}

function sortTokenOf(vars) {
  const sort = trimText(vars.sort_order);
  return sort ? [sort] : [];
}

// ---------------------------------------------------------------------------
// id 范围模式：id:>=A id:<=B 闭区间 + sort:id:asc 升序（站点不认 id:A..B 写法，会当成普通标签）。
// 已删除帖子本来就不在 dapi 结果里，翻页与网页列表逐条一致（2026-10 实测 1..5000 共 4543 张）。
// 区间最多 5001 条，起始偏移远在 200000 上限以内，直接按 pid 翻页即可。
// ---------------------------------------------------------------------------

const MAX_ID_SPAN = 5000;
// 区间模式不对应网页页码，一页取 100 条省请求（dapi 单页上限 1000）
const ID_RANGE_PER_PAGE = 100;

function parsePostId(value, label) {
  const text = trimText(value);
  const id = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(t("positiveIntegerRequired", { label, value: text }));
  return id;
}

function parseIdRange(vars) {
  const startId = parsePostId(vars.id_start, t("startIdLabel"));
  const endId = parsePostId(vars.id_end, t("endIdLabel"));
  if (endId < startId) throw new Error(t("endIdBeforeStart", { endId, startId }));
  if (endId - startId > MAX_ID_SPAN) {
    throw new Error(t("idRangeTooLarge", { max: MAX_ID_SPAN, startId, endId, span: endId - startId }));
  }
  return { startId, endId };
}

// XML 的 <posts count="N"> 是总数，limit=0 只取这一项；只用来摊进度，取不到就按区间宽度估
async function countPosts(baseUrl, tokens) {
  try {
    const body = await fetchText(buildApiUrl(baseUrl, { tokens, limit: 0, pid: 0 }, "xml"));
    const count = Number(xmlAttrs(/<posts\b[^>]*>/.exec(body)?.[0]).count);
    return Number.isSafeInteger(count) ? count : null;
  } catch {
    return null;
  }
}

async function crawlByIdRange(ctx, vars) {
  const { startId, endId } = parseIdRange(vars);
  const tokens = [`id:>=${startId}`, `id:<=${endId}`, "sort:id:asc"];
  const total = await countPosts(ctx.baseUrl, tokens);
  console.log(t("idRangeSummary", { startId, endId, total: total ?? t("unknownCount") }));
  if (total === 0) return;
  // 区间宽度不小于帖子数，总数未知时按它估的页数也够翻完，翻到空页即停
  const pages = Math.max(1, Math.ceil((total ?? endId - startId + 1) / ID_RANGE_PER_PAGE));
  const pageProgress = 99.0 / pages;
  const pager = {
    idOrder: false,
    locate: async (page) => ({ tokens, pid: page - 1, limit: ID_RANGE_PER_PAGE }),
    advance() {},
  };
  for (let page = 1; page <= pages; page += 1) {
    const count = await crawlApiPage(pager, page, ctx, pageProgress, "id");
    if (count === 0) {
      addProgress(pageProgress * (pages - page));
      break;
    }
  }
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = coerceStr(common?.base_url).replace(/\/+$/, "") || BASE_URL;
  const mode = coerceStr(vars.crawl_mode || "tags");
  const ctx = {
    baseUrl,
    quality: coerceStr(vars.quality || "high"),
    fetchComments: vars.fetch_comments !== false,
  };
  const startPage = Math.max(1, Number(vars.start_page ?? 1) || 1);
  const endPage = Math.max(1, Number(vars.end_page ?? startPage) || startPage);

  if (mode === "all") {
    validatePageRange(startPage, endPage);
    await crawlPages(sortTokenOf(vars), ctx, startPage, endPage, "all");
  } else if (mode === "tags") {
    validatePageRange(startPage, endPage);
    const tags = tagListOf(vars.mode_tag_value);
    if (tags.length === 0) throw new Error(t("tagsRequired"));
    await crawlPages(tags.concat(sortTokenOf(vars)), ctx, startPage, endPage, "tags");
  } else if (mode === "id_range") {
    await crawlByIdRange(ctx, vars);
  } else {
    throw new Error(t("unknownMode", { mode }));
  }
}

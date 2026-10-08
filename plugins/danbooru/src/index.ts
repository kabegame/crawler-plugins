// @ts-nocheck
import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";

const { addProgress, currentHtml, delHeader, downloadImage, requireCookie, setHeader, to, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://donmai.moe";

// 站点在 li/tr 上只给数字分类（tag-type-N / data-category）；这里翻成可读名，
// 元数据、provider 分组和 description.ejs 三处都按这套名字对齐。
const TAG_CATEGORY_NAMES = {
  "0": "general",
  "1": "artist",
  "3": "copyright",
  "4": "character",
  "5": "meta",
};

// 侧栏标签展示顺序（站点自身的 h3 分组顺序），全量 tag 串按这个顺序拼
const TAG_CATEGORY_ORDER = ["artist", "copyright", "character", "general", "meta"];

// 根据源站选项解析基础 URL：moe = 只含 general 分级的安全站，danbooru = 全站。
// safebooru 是 1.0.0 的旧选项值，已保存的运行配置仍会带着它，一并指向安全站。
function resolveBaseUrl(source, fallback) {
  const site = coerceStr(source).trim().toLowerCase();
  if (site === "moe" || site === "safebooru") return "https://donmai.moe";
  if (site === "danbooru") return "https://danbooru.donmai.us";
  return coerceStr(fallback) || DEFAULT_BASE_URL;
}

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

// donmai 各域名的 Cloudflare 规则不一样（2026-09 实测，均未带 cf_clearance）：
// - danbooru.donmai.us、cdn.donmai.us：非浏览器 UA 直接放行，浏览器 UA 反而 403；
// - donmai.moe：任何 UA 都 403，必须带畅游里通过验证拿到的 cf_clearance，且它绑定签发时的 UA，
//   所以要同时换成畅游的 CEF UA。
// 因此只有 donmai.moe 需要「浏览器身份」。它的原图同样在 cdn.donmai.us，而 downloadImage 在调用
// 那一刻快照任务请求头，所以下载前临时撤掉这两个头，下载后再恢复。
const BROWSER_IDENTITY_HOSTS = new Set(["donmai.moe"]);

let site = null; // { baseUrl, host, ua, browserIdentity }

function applySiteHeaders() {
  if (!site.browserIdentity) return true;
  if (site.ua) setHeader("User-Agent", site.ua);
  return requireCookie(site.host);
}

function clearSiteHeaders() {
  if (!site.browserIdentity) return;
  delHeader("User-Agent");
  delHeader("Cookie");
}

function prepareSite(baseUrl) {
  const host = new URL(baseUrl).host;
  // 旧版应用没有 cefUserAgent 接口，此时不覆盖 UA
  site = {
    baseUrl,
    host,
    ua: Kabegame.cefUserAgent?.() || "",
    browserIdentity: BROWSER_IDENTITY_HOSTS.has(host),
  };
  if (!applySiteHeaders()) {
    warn(`[danbooru] 未从畅游取到 ${host} 的 Cookie；若请求被 403 拦截，请先在畅游中打开 ${baseUrl} 通过验证`);
  }
}

function siteBlockedError(reason) {
  const hint = site.browserIdentity
    ? `请先在畅游中打开 ${site.baseUrl} 通过验证，再重新运行任务`
    : "请检查代理网络或稍后重试";
  return new Error(`[danbooru] ${site.host} ${reason}，被 Cloudflare 拦截：${hint}`);
}

function isChallengePage(document) {
  const title = trimText(document.title);
  return /just a moment|attention required|checking your browser/i.test(title);
}

async function openDocument(url) {
  let finalUrl;
  try {
    finalUrl = await to(url);
  } catch (error) {
    // 宿主把非 2xx 统一抛成 "HTTP error: <status>"，没有结构化的 status 字段
    if (/HTTP error: 403\b/.test(coerceStr(error?.message ?? error))) throw siteBlockedError("返回 403");
    throw error;
  }
  const document = parseHtml(await currentHtml());
  if (isChallengePage(document)) throw siteBlockedError("返回了验证页");
  return { finalUrl, document };
}

function resolveUrl(url, base) {
  const raw = coerceStr(url).trim();
  return raw ? resolveSdkUrl(raw, base) : "";
}

function normalizeTagToken(text) {
  return trimText(text).replace(/\s+/g, "_");
}

// 标签组合按站点搜索语法用空格分隔（URL 里编码成 +）。
// list 类型经 GUI 传进来是数组，但 kabegame-cli 的 --var 只能给字符串，
// 所以字符串形态也要接：按逗号/空白/加号切开。
function buildTagsValueFromList(tagList) {
  const items = Array.isArray(tagList)
    ? tagList
    : coerceStr(tagList).split(/[,+\s]+/);
  return items
    .map((tag) => normalizeTagToken(tag))
    .filter(Boolean)
    .join(" ");
}

const TAG_TYPE_CLASS_RE = /(?:^|\s)tag-type-(\d+)(?:\s|$)/;

function categoryNameOf(id) {
  return TAG_CATEGORY_NAMES[coerceStr(id).trim()] || "general";
}

// 详情页侧栏 #tag-list：每个 li 带 data-tag-name（规范名，已含下划线），
// class 上的 tag-type-N 是分类，a.search-tag 是站内检索链接，a.wiki-link 是 wiki/artist 页。
function parseSidebarTags(document, pageUrl) {
  return Array.from(document.querySelectorAll("#tag-list li[data-tag-name]"))
    .map((li) => {
      const searchAnchor = li.querySelector("a.search-tag");
      const wikiAnchor = li.querySelector("a.wiki-link");
      const countEl = li.querySelector("span.post-count");
      const classType = TAG_TYPE_CLASS_RE.exec(coerceStr(li.getAttribute("class")));
      const name = normalizeTagToken(li.getAttribute("data-tag-name")) ||
        normalizeTagToken(textOf(searchAnchor));
      return {
        name,
        // 展示名带空格（站点自己就是这么渲染的），全量 tag 串仍用 name
        display: textOf(searchAnchor) || name.replace(/_/g, " "),
        type: categoryNameOf(classType ? classType[1] : ""),
        // post-count 的 title 是精确值，正文是 1.1M 这类缩写
        count: trimText(countEl?.getAttribute("title")) || textOf(countEl),
        post_href: resolveUrl(searchAnchor?.getAttribute("href"), pageUrl),
        wiki_href: resolveUrl(wikiAnchor?.getAttribute("href"), pageUrl),
        deprecated: trimText(li.getAttribute("data-is-deprecated")) === "true",
      };
    })
    .filter((tag) => tag.name);
}

// AI 生图直接可用的完整 tag 串：按站点分组顺序拼，组内保持页面原序
// 标签画册：站点只有五类标签——作家 artist / 角色 character / 版权 copyright / 元信息 meta / 通用 general，
// 各自映射到 `danbooru/<分类>` 目录下；分类缺失或不在这五类里时按 general 处理，保证不会多出第六个目录。
// 两个源站共用同一套标签词表，所以都挂在 danbooru 下。
// key 用站点自己的 tag 标识（小写、丢弃 key 字符集之外的字符），如 `hakurei_reimu`；派生后为空或超长的跳过。
// metadata_migrations/migrate.js 的 provideLabels 有一份同规则的副本（迁移运行在无 import 的裸 V8 里），
// 改这里要同步改那里。
const LABEL_CATEGORIES = new Set(["artist", "character", "copyright", "meta", "general"]);

function tagLabelType(type) {
  const value = String(type || "").trim().toLowerCase();
  return LABEL_CATEGORIES.has(value) ? value : "general";
}

function tagLabelKey(name) {
  const key = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

function labelsFromTags(tags) {
  const labels = [];
  for (const tag of tags || []) {
    const key = tagLabelKey(tag && tag.name);
    if (!key) continue;
    labels.push({
      key,
      category: `danbooru/${tagLabelType(tag.type)}`,
      name: trimText(tag.display) || key.replace(/_/g, " "),
    });
  }
  return labels;
}

function buildTagsString(tags) {
  const ordered = [];
  for (const category of TAG_CATEGORY_ORDER) {
    for (const tag of tags) {
      if (tag.type === category) ordered.push(tag.name);
    }
  }
  for (const tag of tags) {
    if (!TAG_CATEGORY_ORDER.includes(tag.type)) ordered.push(tag.name);
  }
  return ordered.join(" ");
}

function groupTagsByType(tags) {
  const grouped = {};
  for (const tag of tags) {
    (grouped[tag.type] || (grouped[tag.type] = [])).push(tag.name);
  }
  return grouped;
}

// #post-info-* 每行形如 "Size: 585 KB .jpg (707x942) »"，统一剥掉前缀标签
function infoText(document, key) {
  const el = document.querySelector(`#post-info-${key}`);
  if (!el) return "";
  return trimText(textOf(el).replace(new RegExp(`^${key}\\s*:\\s*`, "i"), "").replace(/\s*»\s*$/, ""));
}

function parseSizeLine(line) {
  // "585 KB .jpg (707x942)"
  const matched = /^(.*?)\s*(\.[a-z0-9]+)?\s*\((\d+)x(\d+)\)\s*$/i.exec(coerceStr(line));
  if (!matched) return { file_size: trimText(line), file_ext: "", width: 0, height: 0 };
  return {
    file_size: trimText(matched[1]),
    file_ext: trimText(matched[2]).replace(/^\./, ""),
    width: Number(matched[3]) || 0,
    height: Number(matched[4]) || 0,
  };
}

function parseCommentary(document) {
  const section = document.querySelector("#original-artist-commentary");
  if (!section) return null;
  const title = textOf(section.querySelector("h3"));
  const body = textOf(section.querySelector("div.prose"));
  if (!title && !body) return null;
  return { title, body };
}

function buildDanbooruMetadata(document, pageUrl) {
  const tags = parseSidebarTags(document, pageUrl);
  const uploaderAnchor = document.querySelector("#post-info-uploader a.user");
  const sourceAnchor = document.querySelector("#post-info-source a[href]");
  const dateAnchor = document.querySelector("#post-info-date a[href]");
  const timeEl = document.querySelector("#post-info-date time");
  const sizeAnchor = document.querySelector("#post-info-size a[href^='http']");
  const originalAnchor = document.querySelector(".image-view-original-link");
  const imageEl = document.querySelector("img#image");

  const size = parseSizeLine(infoText(document, "size"));
  const commentary = parseCommentary(document);

  return {
    post_id: infoText(document, "id"),
    // 全量 tag：AI 生图 / 二次检索直接吃这个串
    tags_string: buildTagsString(tags),
    tags,
    tags_by_type: groupTagsByType(tags),
    rating: infoText(document, "rating"),
    score: infoText(document, "score"),
    fav_count: infoText(document, "favorites"),
    status: infoText(document, "status"),
    file_size: size.file_size,
    file_ext: size.file_ext,
    width: size.width,
    height: size.height,
    uploader_name: textOf(uploaderAnchor),
    uploader_href: resolveUrl(uploaderAnchor?.getAttribute("href"), pageUrl),
    posted_date_text: textOf(timeEl),
    posted_date_iso: trimText(timeEl?.getAttribute("datetime")),
    posted_date_title: trimText(timeEl?.getAttribute("title")),
    posted_date_href: resolveUrl(dateAnchor?.getAttribute("href"), pageUrl),
    source_text: textOf(sourceAnchor),
    source_href: trimText(sourceAnchor?.getAttribute("href")),
    original_href: trimText(sizeAnchor?.getAttribute("href")) ||
      trimText(originalAnchor?.getAttribute("href")),
    sample_href: trimText(imageEl?.getAttribute("src")),
    commentary,
  };
}

function metadataNonEmpty(meta) {
  return !!(
    meta.post_id ||
    meta.tags.length ||
    meta.rating ||
    meta.score ||
    meta.uploader_name ||
    meta.source_href ||
    meta.original_href
  );
}

// 质量分流：high = #post-info-size 上的原图直链（图片/视频通用），
// medium = #image 的 sample；缺 sample（视频帖 #image 是 div）时回落原图。
function pickImageUrl(meta, quality) {
  if (quality === "high") return meta.original_href || meta.sample_href;
  return meta.sample_href || meta.original_href;
}

async function processDetailPage(href, baseUrl, quality) {
  const fullUrl = resolveUrl(href, baseUrl);
  const { document, finalUrl } = await openDocument(fullUrl);
  const meta = buildDanbooruMetadata(document, finalUrl);
  const imageUrl = pickImageUrl(meta, quality);
  if (!imageUrl) {
    console.warn(`[danbooru] 详情页没解析出图片地址，跳过：${finalUrl}`);
    return;
  }
  const opts = { url: finalUrl };
  if (metadataNonEmpty(meta)) opts.metadata = meta;
  const labels = labelsFromTags(meta.tags);
  if (labels.length > 0) opts.labels = labels;
  clearSiteHeaders();
  try {
    await downloadImage(imageUrl, opts);
  } finally {
    applySiteHeaders();
  }
}

// ratingLetter 非空时只留 data-rating 相同的作品（人气榜页不接受 tags 参数，分级只能在这里筛）
function collectPostHrefs(document, pageUrl, ratingLetter = "") {
  const articles = Array.from(document.querySelectorAll("article.post-preview"));
  const hrefs = articles
    .filter((article) => !ratingLetter || coerceStr(article.getAttribute("data-rating")) === ratingLetter)
    .map((article) => resolveUrl(article.querySelector("a.post-preview-link")?.getAttribute("href"), pageUrl))
    .filter(Boolean);
  // 空结果页仍然带 .posts-container（里面写着 No posts found）；连容器都没有说明拿到的
  // 根本不是列表页——多半是 Cloudflare 挑战页或错误页。两者在解析上都是「0 个作品」，
  // 不区分的话风控会伪装成「这个标签没图」静默跑完。
  if (articles.length === 0 && !document.querySelector(".posts-container, #posts")) {
    console.warn(`[danbooru] 页面里没有作品列表容器，可能被站点拦截或返回了错误页：${pageUrl}`);
  }
  return hrefs;
}

function validatePageRange(startPage, endPage) {
  if (endPage >= startPage + 100) {
    throw new Error("在一次之内不允许爬取超过100页，咱二次元人要保持文明礼仪");
  }
  if (endPage < startPage) throw new Error("结束页面需要比开始页面大");
}

function normalizePerPage(value) {
  const parsed = Number(value ?? 20);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(200, Math.floor(parsed));
}

// 列表页统一入口：给 URL 生成器，按页取详情页并均摊进度
async function crawlListPages(makePageUrl, quality, startPage, endPage, label, ratingLetter = "") {
  const totalPages = endPage - startPage + 1;
  const pageProgress = 90.0 / totalPages;
  for (let page = startPage; page <= endPage; page += 1) {
    const pageUrl = makePageUrl(page);
    console.log(`[danbooru][${label}] 打开页面 ${page}/${endPage}: ${pageUrl}`);
    const { document, finalUrl } = await openDocument(pageUrl);
    const hrefs = collectPostHrefs(document, finalUrl, ratingLetter);
    if (hrefs.length === 0 && ratingLetter && document.querySelector("article.post-preview")) {
      // 这一页有作品、只是都被分级筛掉了，后面的页仍可能有符合的
      console.log(`[danbooru][${label}] 第 ${page} 页没有分级为 ${ratingLetter} 的作品，继续下一页`);
      addProgress(pageProgress);
      continue;
    }
    if (hrefs.length === 0) {
      console.log(`[danbooru][${label}] 第 ${page} 页没有作品，结束`);
      addProgress(pageProgress);
      break;
    }
    for (const href of hrefs) {
      await processDetailPage(href, finalUrl, quality);
      addProgress(pageProgress / hrefs.length);
    }
  }
}

// 分级过滤：g(General) / s(Sensitive) / q(Questionable) / e(Explicit)，配置值直接是站点的单字母。
// 2026-10 实测 rating: 元标签不占普通账号「每次最多 2 个标签」的名额（2 个标签 + rating:g 正常返回，
// 3 个普通标签返回 422）。donmai.moe 只有 General，所以 kbConfig 里只在全站时显示这一项。
const RATING_LETTERS = new Set(["g", "s", "q", "e"]);

function ratingLetterOf(vars) {
  const letter = trimText(vars.rating).toLowerCase();
  return RATING_LETTERS.has(letter) ? letter : "";
}

function withRatingToken(tagsValue, vars) {
  const letter = ratingLetterOf(vars);
  return [tagsValue, letter ? `rating:${letter}` : ""].filter(Boolean).join(" ");
}

function buildPostsUrl(baseUrl, tagsValue, perPage, page) {
  const params = [];
  if (tagsValue) params.push(`tags=${encodeURIComponent(tagsValue)}`);
  if (perPage !== 20) params.push(`limit=${perPage}`);
  params.push(`page=${page}`);
  return `${baseUrl}/posts?${params.join("&")}`;
}

async function crawlAll(baseUrl, quality, vars) {
  const perPage = normalizePerPage(vars.per_page);
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  await crawlListPages(
    (page) => buildPostsUrl(baseUrl, withRatingToken("", vars), perPage, page),
    quality,
    startPage,
    endPage,
    "all",
  );
}

async function crawlByTags(baseUrl, quality, vars) {
  const tagsValue = buildTagsValueFromList(vars.mode_tag_value);
  if (!tagsValue) throw new Error("标签模式需要至少填写一个标签");
  // 站点对匿名/普通账号限制每次检索最多 2 个标签，超了它会直接报错页
  if (tagsValue.split(" ").length > 2) {
    console.warn(`[danbooru][tags] 一次检索了 ${tagsValue.split(" ").length} 个标签，站点对普通账号限制 2 个，可能返回空结果`);
  }
  const perPage = normalizePerPage(vars.per_page);
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  await crawlListPages(
    (page) => buildPostsUrl(baseUrl, withRatingToken(tagsValue, vars), perPage, page),
    quality,
    startPage,
    endPage,
    "tags",
  );
}

async function crawlPopular(baseUrl, quality, vars) {
  const scale = coerceStr(vars.popular_scale || "day");
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  await crawlListPages(
    (page) => `${baseUrl}/explore/posts/popular?scale=${encodeURIComponent(scale)}&page=${page}`,
    quality,
    startPage,
    endPage,
    `popular-${scale}`,
    ratingLetterOf(vars),
  );
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = resolveBaseUrl(vars.source_site, common?.baseUrl);
  prepareSite(baseUrl);
  const quality = coerceStr(vars.quality || "high");
  const mode = coerceStr(vars.crawl_mode);

  if (mode === "all") {
    validatePageRange(Number(vars.start_page ?? 1), Number(vars.end_page ?? 1));
    await crawlAll(baseUrl, quality, vars);
  } else if (mode === "tags") {
    validatePageRange(Number(vars.start_page ?? 1), Number(vars.end_page ?? 1));
    await crawlByTags(baseUrl, quality, vars);
  } else if (mode === "popular") {
    validatePageRange(Number(vars.start_page ?? 1), Number(vars.end_page ?? 1));
    await crawlPopular(baseUrl, quality, vars);
  } else {
    throw new Error(`未知的爬取模式: ${mode}`);
  }
}

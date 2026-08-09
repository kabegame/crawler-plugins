// @ts-nocheck
import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";

const { addProgress, currentHtml, downloadImage, setHeader, to } = Kabegame;

const BASE_URL = "https://gelbooru.com";

// 站点两处列表的每页条数都是写死的（匿名访问下 URL 的 limit 参数无效，
// 那是账号设置项），翻页靠 pid 偏移量而不是页号，所以这两个常数是硬契约。
const POSTS_PER_PAGE = 42;
const TAGS_PER_PAGE = 50;
// 标签列表模式最多翻多少页标签表（凑不够目标标签数时的兜底上限）
const MAX_TAG_LIST_PAGES = 50;

// 侧栏 li 与标签表 span 上的 tag-type-* class 就是分类，站点直接给可读名。
// 元数据、provider 分组和 description.ejs 三处都按这套名字对齐。
const TAG_CATEGORIES = ["artist", "copyright", "character", "general", "metadata"];

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

async function openDocument(url) {
  const finalUrl = await to(url);
  return { finalUrl, document: parseHtml(await currentHtml()) };
}

function resolveUrl(url, base) {
  const raw = coerceStr(url).trim();
  return raw ? resolveSdkUrl(raw, base) : "";
}

// 站点模板拼 img#image 的 src 时多带一个斜杠（img4.gelbooru.com//samples/…），
// CDN 照样返回图片，但同一个文件会因为路径不同产生两个 URL 去重键，这里抹平。
function normalizeMediaUrl(url) {
  return coerceStr(url).replace(/([^:])\/{2,}/g, "$1/");
}

function parseIntOrZero(text) {
  const token = trimText(text).replace(/,/g, "");
  return /^\d+$/.test(token) ? Number(token) : 0;
}

function normalizeTagToken(text) {
  return trimText(text).replace(/\s+/g, "_");
}

// 标签组合按站点搜索语法用 + 分隔。list 类型经 GUI 传进来是数组，
// 但 kabegame-cli 的 --var 只能给字符串，所以字符串形态也要接：按逗号/空白/加号切开。
function tagListOf(tagList) {
  const items = Array.isArray(tagList) ? tagList : coerceStr(tagList).split(/[,+\s]+/);
  return items.map((tag) => normalizeTagToken(tag)).filter(Boolean);
}

const TAG_TYPE_CLASS_RE = /(?:^|\s)tag-type-([a-z0-9_-]+)(?:\s|$)/i;

function categoryOf(el) {
  const matched = TAG_TYPE_CLASS_RE.exec(coerceStr(el?.getAttribute("class")));
  return matched ? matched[1].toLowerCase() : "general";
}

// 站内链接 index.php?page=post&s=list&tags=xxx 里的 tags 参数就是标签规范名（已含下划线）
function tagNameFromHref(href) {
  const matched = /[?&](?:tags|search|tag)=([^&#]+)/.exec(coerceStr(href));
  if (!matched) return "";
  let raw = matched[1].replace(/\+/g, " ");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // 非法转义序列时保留原串
  }
  return normalizeTagToken(raw);
}

// 详情页侧栏 ul#tag-list：标签 li 带 tag-type-* class，统计信息 li 不带，靠这个区分。
// 每个标签 li 形如：<span class="sm-hidden"><a wiki>?</a></span><a post>display</a><span>count</span>
function parseSidebarTags(document, pageUrl) {
  return Array.from(document.querySelectorAll("#tag-list li[class*='tag-type-']"))
    .map((li) => {
      const postAnchor = li.querySelector("a[href*='page=post']");
      const wikiAnchor = li.querySelector("a[href*='page=wiki']");
      // 计数是最后那个裸 span（纯数字），wiki 的 "?" 包在 span.sm-hidden 里，按内容筛掉
      const countEl = Array.from(li.querySelectorAll("span"))
        .filter((span) => /^[\d,]+$/.test(textOf(span)))
        .pop();
      const display = textOf(postAnchor);
      return {
        name: tagNameFromHref(postAnchor?.getAttribute("href")) || normalizeTagToken(display),
        // 展示名带空格（站点自己就是这么渲染的），全量 tag 串仍用 name
        display,
        type: categoryOf(li),
        count: textOf(countEl),
        post_href: resolveUrl(postAnchor?.getAttribute("href"), pageUrl),
        wiki_href: resolveUrl(wikiAnchor?.getAttribute("href"), pageUrl),
      };
    })
    .filter((tag) => tag.name);
}

// AI 生图直接可用的完整 tag 串：按分类顺序拼，组内保持页面原序
function buildTagsString(tags) {
  const ordered = [];
  for (const category of TAG_CATEGORIES) {
    for (const tag of tags) {
      if (tag.type === category) ordered.push(tag.name);
    }
  }
  for (const tag of tags) {
    if (!TAG_CATEGORIES.includes(tag.type)) ordered.push(tag.name);
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

// 侧栏 Statistics 区：每条统计各占一个不带 tag-type-* class 的 li，
// 文案形如 "Id: 14662187" / "Posted: 2026-08-09 03:30:26 Uploader: danbooru" / "Size: 707x942"
function parseStats(document, pageUrl) {
  const stats = {
    post_id: "",
    posted_date_text: "",
    uploader_name: "",
    uploader_href: "",
    width: 0,
    height: 0,
    source_text: "",
    source_href: "",
    rating: "",
    score: "",
  };

  for (const li of Array.from(document.querySelectorAll("#tag-list li"))) {
    if (TAG_TYPE_CLASS_RE.test(coerceStr(li.getAttribute("class")))) continue;
    const line = textOf(li);

    const idMatch = /^Id:\s*(\d+)/.exec(line);
    if (idMatch) stats.post_id = idMatch[1];

    const postedMatch = /^Posted:\s*([\d-]+\s+[\d:]+)/.exec(line);
    if (postedMatch) {
      stats.posted_date_text = postedMatch[1];
      const uploaderAnchor = li.querySelector("a[href*='page=account']");
      stats.uploader_name = textOf(uploaderAnchor);
      stats.uploader_href = resolveUrl(uploaderAnchor?.getAttribute("href"), pageUrl);
    }

    const sizeMatch = /^Size:\s*(\d+)x(\d+)/i.exec(line);
    if (sizeMatch) {
      stats.width = Number(sizeMatch[1]) || 0;
      stats.height = Number(sizeMatch[2]) || 0;
    }

    if (/^Source:/i.test(line)) {
      // 来源可能是链接，也可能只是 "pixiv id 123" 这类纯文本
      const sourceAnchor = li.querySelector("a[href]");
      stats.source_href = trimText(sourceAnchor?.getAttribute("href"));
      stats.source_text = textOf(sourceAnchor) || trimText(line.replace(/^Source:\s*/i, ""));
    }

    const ratingMatch = /^Rating:\s*(\S+)/i.exec(line);
    if (ratingMatch) stats.rating = ratingMatch[1];

    const scoreMatch = /^Score:\s*(-?\d+)/i.exec(line);
    if (scoreMatch) stats.score = scoreMatch[1];
  }

  return stats;
}

// Options 区的 "Original image" 就是原文件直链；文案变了就退回站内 /images/ 直链，
// 但要避开 SauceNao / IQDB 那种把缩略图当查询参数带上的外链。
function findOriginalHref(document) {
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const labeled = anchors.find((a) => /^Original(\s+image)?$/i.test(textOf(a)));
  if (labeled) return trimText(labeled.getAttribute("href"));
  const direct = anchors.find((a) => {
    const href = trimText(a.getAttribute("href"));
    return /\/images\//.test(href) && !/[?&]url=/.test(href);
  });
  return direct ? trimText(direct.getAttribute("href")) : "";
}

// 视频帖没有 section.image-container，正文直接是 <video id="gelcomVideoPlayer">，
// 里面 mp4 / webm 两个 source。优先 mp4：桌面端兼容副本本来就是 H.264 MP4。
function findVideoHref(document, pageUrl) {
  const player = document.querySelector("video#gelcomVideoPlayer");
  if (!player) return "";
  const sources = Array.from(player.querySelectorAll("source[src]"));
  const mp4 = sources.find((s) => /mp4/i.test(coerceStr(s.getAttribute("type"))) ||
    /\.mp4(?:\?|$)/i.test(coerceStr(s.getAttribute("src"))));
  const picked = mp4 || sources[0];
  return resolveUrl(picked?.getAttribute("src"), pageUrl);
}

function buildGelbooruMetadata(document, pageUrl) {
  const container = document.querySelector("section.image-container");
  const imageEl = document.querySelector("img#image");
  const tags = parseSidebarTags(document, pageUrl);
  const stats = parseStats(document, pageUrl);

  // 图片帖的 section.image-container 上挂着一整套 data-*，比正文文案更规范；
  // 视频帖没有这个容器，全部字段回落到 Statistics 区解析出来的值。
  const dataAttr = (key) => trimText(container?.getAttribute(key));
  const dataNum = (key) => Number(dataAttr(key)) || 0;

  const videoHref = findVideoHref(document, pageUrl);
  const fileExt = dataAttr("data-file-ext").replace(/^\./, "");
  const originalHref = findOriginalHref(document);

  return {
    post_id: dataAttr("data-id") || stats.post_id,
    // 全量 tag：AI 生图 / 二次检索直接吃这个串；侧栏解析失败时退回容器上的 data-tags
    tags_string: buildTagsString(tags) || dataAttr("data-tags"),
    tags,
    tags_by_type: groupTagsByType(tags),
    rating: dataAttr("data-rating") || stats.rating,
    score: dataAttr("data-score") || stats.score,
    width: dataNum("data-width") || stats.width,
    height: dataNum("data-height") || stats.height,
    file_ext: fileExt || (/\.([a-z0-9]+)(?:\?|$)/i.exec(originalHref || videoHref)?.[1] || ""),
    md5: dataAttr("data-md5"),
    has_sound: dataAttr("data-has-sound") === "true",
    has_children: dataAttr("data-has-children") === "true",
    uploader_name: stats.uploader_name,
    uploader_href: stats.uploader_href,
    posted_date_text: stats.posted_date_text,
    source_text: stats.source_text,
    source_href: dataAttr("data-normalized-source") || dataAttr("data-source") || stats.source_href,
    original_href: normalizeMediaUrl(resolveUrl(originalHref, pageUrl)),
    sample_href: normalizeMediaUrl(resolveUrl(imageEl?.getAttribute("src"), pageUrl)),
    video_href: normalizeMediaUrl(videoHref),
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

// 质量分流：high = Options 区的原文件直链，medium = #image 的 sample。
// 视频帖没有 sample，两档都走 <video> 的 mp4 source。
function pickMediaUrl(meta, quality) {
  if (meta.video_href) return meta.video_href;
  if (quality === "high") return meta.original_href || meta.sample_href;
  return meta.sample_href || meta.original_href;
}

async function processDetailPage(href, baseUrl, quality) {
  const fullUrl = resolveUrl(href, baseUrl);
  const { document, finalUrl } = await openDocument(fullUrl);
  const meta = buildGelbooruMetadata(document, finalUrl);
  const mediaUrl = pickMediaUrl(meta, quality);
  if (!mediaUrl) {
    console.warn(`[gelbooru] 详情页没解析出媒体地址，跳过：${finalUrl}`);
    return;
  }
  const opts = { url: finalUrl };
  if (metadataNonEmpty(meta)) opts.metadata = meta;
  await downloadImage(mediaUrl, opts);
}

function collectPostHrefs(document, pageUrl) {
  return Array.from(document.querySelectorAll("article.thumbnail-preview a[href]"))
    .map((a) => resolveUrl(a.getAttribute("href"), pageUrl))
    .filter(Boolean);
}

function validatePageRange(startPage, endPage) {
  if (endPage >= startPage + 100) {
    throw new Error("在一次之内不允许爬取超过100页，咱二次元人要保持文明礼仪");
  }
  if (endPage < startPage) throw new Error("结束页面需要比开始页面大");
}

// 站点搜索串：标签之间用 +，每个 token 单独编码（sort:score:desc 里的冒号要转义）
function encodeTagsQuery(tokens) {
  return tokens.map((token) => encodeURIComponent(token)).join("+");
}

// 空标签在这个站点写作 tags=all；分页是 pid 偏移量，不是页号
function buildPostListUrl(baseUrl, tokens, page) {
  const query = encodeTagsQuery(tokens.length > 0 ? tokens : ["all"]);
  const pid = (page - 1) * POSTS_PER_PAGE;
  return `${baseUrl}/index.php?page=post&s=list&tags=${query}${pid > 0 ? `&pid=${pid}` : ""}`;
}

// 列表页统一入口：给 URL 生成器，按页取详情页并均摊进度
async function crawlListPages(makePageUrl, quality, startPage, endPage, label) {
  const totalPages = endPage - startPage + 1;
  const pageProgress = 90.0 / totalPages;
  for (let page = startPage; page <= endPage; page += 1) {
    const pageUrl = makePageUrl(page);
    console.log(`[gelbooru][${label}] 打开页面 ${page}/${endPage}: ${pageUrl}`);
    const { document, finalUrl } = await openDocument(pageUrl);
    const hrefs = collectPostHrefs(document, finalUrl);
    if (hrefs.length === 0) {
      console.log(`[gelbooru][${label}] 第 ${page} 页没有作品，结束`);
      addProgress(pageProgress);
      break;
    }
    for (const href of hrefs) {
      await processDetailPage(href, finalUrl, quality);
      addProgress(pageProgress / hrefs.length);
    }
  }
}

// 排序是站点的 sort: 元标签，跟普通标签一样拼进搜索串
function sortTokenOf(vars) {
  const sort = trimText(vars.sort_order);
  return sort ? [sort] : [];
}

async function crawlAll(baseUrl, quality, vars) {
  const tokens = ["all"].concat(sortTokenOf(vars));
  await crawlListPages(
    (page) => buildPostListUrl(baseUrl, tokens, page),
    quality,
    Number(vars.start_page ?? 1),
    Number(vars.end_page ?? 1),
    "all",
  );
}

async function crawlByTags(baseUrl, quality, vars) {
  const tags = tagListOf(vars.mode_tag_value);
  if (tags.length === 0) throw new Error("标签模式需要至少填写一个标签");
  const tokens = tags.concat(sortTokenOf(vars));
  await crawlListPages(
    (page) => buildPostListUrl(baseUrl, tokens, page),
    quality,
    Number(vars.start_page ?? 1),
    Number(vars.end_page ?? 1),
    "tags",
  );
}

// 标签表的排序被站点拆成 order_by + sort 两个参数，这里按一个可读选项映射过去
const TAG_ORDER_PARAMS = {
  count: { order_by: "index_count", sort: "desc" },
  name: { order_by: "tag", sort: "asc" },
  date: { order_by: "updated", sort: "desc" },
};

function buildTagListUrl(baseUrl, pattern, order, page) {
  const params = TAG_ORDER_PARAMS[order] || TAG_ORDER_PARAMS.count;
  const pid = (page - 1) * TAGS_PER_PAGE;
  return `${baseUrl}/index.php?page=tags&s=list&tags=${encodeURIComponent(pattern)}` +
    `&sort=${params.sort}&order_by=${params.order_by}${pid > 0 ? `&pid=${pid}` : ""}`;
}

// 标签表每行：<td><span class="tag-type-X"><a href="…tags=name">display</a></span>
// <span class="tag-count">N</span></td><td>类型（含 edit 链接）</td>
function parseTagRows(document) {
  return Array.from(document.querySelectorAll("table.highlightable tr"))
    .map((row) => {
      const holder = row.querySelector("span[class*='tag-type-']");
      const anchor = holder?.querySelector("a[href*='page=post']");
      if (!anchor) return null;
      return {
        name: tagNameFromHref(anchor.getAttribute("href")) || normalizeTagToken(textOf(anchor)),
        display: textOf(anchor),
        category: categoryOf(holder),
        count: parseIntOrZero(textOf(row.querySelector("span.tag-count"))),
      };
    })
    .filter((tag) => tag && tag.name);
}

// 单个标签：按页取它的作品，最多 maxPages 页
async function crawlTagPosts(baseUrl, quality, tag, maxPages, perTagProgress) {
  const perPageProgress = perTagProgress / maxPages;
  let downloaded = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const pageUrl = buildPostListUrl(baseUrl, [tag.name], page);
    const { document, finalUrl } = await openDocument(pageUrl);
    const hrefs = collectPostHrefs(document, finalUrl);
    if (hrefs.length === 0) {
      addProgress(perPageProgress * (maxPages - page + 1));
      break;
    }
    for (const href of hrefs) {
      await processDetailPage(href, finalUrl, quality);
      downloaded += 1;
    }
    addProgress(perPageProgress);
  }
  console.log(
    `[gelbooru][tag-list] 标签完成: ${tag.name}（${tag.category}），实际下载 ${downloaded} / 站内共 ${tag.count}`,
  );
}

async function crawlByTagList(baseUrl, quality, vars) {
  const pattern = trimText(vars.tag) || "*";
  // 站点的标签表没有分类筛选参数，只能取回来再按 tag-type-* 过滤
  const category = trimText(vars.mode_tag_type).toLowerCase();
  const order = coerceStr(vars.mode_tag_order || "count");
  const skipCount = Math.max(0, Number(vars.mode_tag_skip ?? 0));
  const tagCount = Math.max(1, Number(vars.mode_tag_count ?? 3));
  const maxPages = Math.max(1, Number(vars.mode_tag_pages ?? 1));

  console.log(
    `[gelbooru][tag-list] 开始标签列表模式：匹配 ${pattern}${category ? `（仅 ${category}）` : ""}，` +
      `跳过 ${skipCount} 个，取 ${tagCount} 个`,
  );
  const perTagProgress = 99.0 / tagCount;

  // 按分类过滤后每页剩几行不定，所以用流水计数跳过，而不是按页大小取模。
  // 分类选窄时可能一整页都被滤掉，加个翻页上限，避免把整张标签表走完。
  let seen = 0;
  let picked = 0;
  for (let page = 1; picked < tagCount && page <= MAX_TAG_LIST_PAGES; page += 1) {
    const pageUrl = buildTagListUrl(baseUrl, pattern, order, page);
    const { document } = await openDocument(pageUrl);
    const rows = parseTagRows(document);
    if (rows.length === 0) {
      console.log(`[gelbooru][tag-list] 第 ${page} 页没有标签，结束`);
      break;
    }
    for (const tag of rows) {
      if (category && tag.category !== category) continue;
      if (seen++ < skipCount) continue;
      if (picked >= tagCount) break;
      picked += 1;
      if (tag.count <= 0) {
        addProgress(perTagProgress);
        continue;
      }
      await crawlTagPosts(baseUrl, quality, tag, maxPages, perTagProgress);
    }
  }
  if (picked === 0) console.warn("[gelbooru][tag-list] 没有匹配到任何标签，检查匹配式、分类与跳过数量");
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = coerceStr(common?.baseUrl) || BASE_URL;
  const quality = coerceStr(vars.quality || "high");
  const mode = coerceStr(vars.crawl_mode);

  // 图片 CDN（img*.gelbooru.com）有防盗链：不带站内 Referer 的请求会被 302 到
  // hotlink.php，最终拿回一段 HTML，下载器只会报「文件格式不受支持（infer）」。
  // 任务级请求头对 to() 和下载队列都生效，所以在这里设一次就够。
  setHeader("Referer", `${baseUrl}/`);

  if (mode === "all") {
    validatePageRange(Number(vars.start_page ?? 1), Number(vars.end_page ?? 1));
    await crawlAll(baseUrl, quality, vars);
  } else if (mode === "tags") {
    validatePageRange(Number(vars.start_page ?? 1), Number(vars.end_page ?? 1));
    await crawlByTags(baseUrl, quality, vars);
  } else if (mode === "tag_list") {
    await crawlByTagList(baseUrl, quality, vars);
  } else {
    throw new Error(`未知的爬取模式: ${mode}`);
  }
}

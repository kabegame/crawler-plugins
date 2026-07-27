// @ts-nocheck
import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";

const { addProgress, currentHtml, downloadImage, to } = Kabegame;

const DEFAULT_BASE_URL = "https://konachan.net";

// 根据源站选项解析基础 URL：net = konachan.net，com = konachan.com
function resolveBaseUrl(source, fallback) {
  const site = coerceStr(source).trim().toLowerCase();
  if (site === "com") return "https://konachan.com";
  if (site === "net") return "https://konachan.net";
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

async function openDocument(url) {
  const finalUrl = await to(url);
  return { finalUrl, document: parseHtml(await currentHtml()) };
}

function resolveUrl(url, base) {
  const raw = coerceStr(url).trim();
  return raw ? resolveSdkUrl(raw, base) : "";
}

function parseIntOrZero(text) {
  const token = trimText(text);
  return /^\d+$/.test(token) ? Number(token) : 0;
}

function normalizeTagToken(text) {
  return trimText(text).replace(/\s+/g, "_");
}

function buildTagsValueFromList(tagList) {
  return (Array.isArray(tagList) ? tagList : [])
    .map((tag) => normalizeTagToken(tag))
    .filter(Boolean)
    .join("+");
}

// 站点新结构中标签类型只体现在 li 的 tag-type-* class 上
const TAG_TYPE_CLASS_RE = /(?:^|\s)tag-type-([\w-]+)(?:\s|$)/;

// 从 /post?tags=xxx、/wiki/show?title=xxx、/artist/show?name=xxx 中取出标签标识
function tagNameFromHref(href) {
  const matched = /[?&](?:tags|title|name)=([^&#]+)/.exec(coerceStr(href));
  if (!matched) return "";
  let raw = matched[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // 非法转义序列时保留原串
  }
  return normalizeTagToken(raw);
}

function parseSidebarTags(document, pageUrl) {
  return Array.from(document.querySelectorAll("#tag-sidebar li"))
    .map((li) => {
      const anchors = Array.from(li.querySelectorAll("a[href]"));
      // 两个链接靠 href 区分：带 tags= 的是列表链接，另一个是 wiki / artist 链接
      const postAnchor =
        anchors.find((a) => /[?&]tags=/.test(coerceStr(a.getAttribute("href")))) ||
        anchors[anchors.length - 1] ||
        null;
      const wikiAnchor = anchors.find((a) => a !== postAnchor) || null;
      const classType = TAG_TYPE_CLASS_RE.exec(coerceStr(li.getAttribute("class")));
      const display = textOf(postAnchor);
      return {
        // data-* 是旧结构，保留读取以兼容仍输出该属性的镜像站
        name:
          trimText(li.getAttribute("data-name")) ||
          tagNameFromHref(postAnchor?.getAttribute("href")) ||
          tagNameFromHref(wikiAnchor?.getAttribute("href")) ||
          normalizeTagToken(display),
        type: trimText(li.getAttribute("data-type")) || (classType ? classType[1] : ""),
        wiki_href: resolveUrl(wikiAnchor?.getAttribute("href"), pageUrl),
        post_href: resolveUrl(postAnchor?.getAttribute("href"), pageUrl),
        display,
        count: textOf(li.querySelector("span.post-count")),
      };
    })
    .filter((tag) => tag.name || tag.display);
}

function parseRelatedPosts(document, pageUrl) {
  const heading = Array.from(document.querySelectorAll("h5")).find((el) =>
    /Related Posts/i.test(textOf(el)),
  );
  const ul = heading?.nextElementSibling?.tagName === "UL" ? heading.nextElementSibling : null;
  if (!ul) return [];
  return Array.from(ul.querySelectorAll("a[href]")).map((a) => ({
    href: resolveUrl(a.getAttribute("href"), pageUrl),
    label: textOf(a),
  })).filter((item) => item.href);
}

function buildKonachanMetadata(document, pageUrl) {
  const postedBy = document.querySelector("#stats ul li:nth-of-type(2) a[href*='/user/show/']");
  const source = document.querySelector("#stats ul li a[href^='http']");
  const score = textOf(document.querySelector("[id^='post-score-']"));
  let postId = "";
  let size = "";
  let rating = "";

  for (const li of Array.from(document.querySelectorAll("#stats ul > li"))) {
    const line = textOf(li);
    if (/^Id:\s*\d+/.test(line)) postId = line.replace(/^Id:\s*(\d+).*$/, "$1").trim();
    if (/^Size:/i.test(line)) size = line.replace(/^Size:\s*/i, "").trim();
    if (/^Rating:/i.test(line)) rating = line.replace(/^Rating:\s*/i, "").split(/\s+/)[0] || "";
  }

  const dateAnchor = document.querySelector("#stats ul > li:nth-of-type(2) a[href*='/post?tags=date']");
  const avatarLink = document.querySelector("#stats .comment-avatar-container a");
  const avatarImg = document.querySelector("#stats .comment-avatar-container img");

  const favorited = Array.from(document.querySelectorAll("#favorited-by a[href]")).map((a) => ({
    href: resolveUrl(a.getAttribute("href"), pageUrl),
    name: textOf(a),
  })).filter((item) => item.name);

  const tags = parseSidebarTags(document, pageUrl);

  return {
    posted_by_name: textOf(postedBy),
    posted_by_href: resolveUrl(postedBy?.getAttribute("href"), pageUrl),
    source_href: trimText(source?.getAttribute("href")),
    score,
    sidebar_tags: tags,
    stats: {
      post_id: postId,
      size,
      rating,
      posted_date_href: resolveUrl(dateAnchor?.getAttribute("href"), pageUrl),
      posted_date_text: textOf(dateAnchor),
      posted_date_title: trimText(dateAnchor?.getAttribute("title")),
      avatar_href: resolveUrl(avatarLink?.getAttribute("href"), pageUrl),
      avatar_src: resolveUrl(avatarImg?.getAttribute("src"), pageUrl),
      favorited,
    },
    related: parseRelatedPosts(document, pageUrl),
  };
}

function metadataNonEmpty(meta) {
  return !!(
    meta.posted_by_name ||
    meta.posted_by_href ||
    meta.source_href ||
    meta.score ||
    meta.sidebar_tags.length ||
    meta.related.length ||
    meta.stats.post_id ||
    meta.stats.size ||
    meta.stats.rating ||
    meta.stats.posted_date_href ||
    meta.stats.avatar_src ||
    meta.stats.favorited.length
  );
}

async function processDetailPage(href, baseUrl, quality) {
  const fullUrl = resolveUrl(href, baseUrl);
  const { document, finalUrl } = await openDocument(fullUrl);
  const meta = buildKonachanMetadata(document, finalUrl);
  let imageUrl = "";
  if (quality === "high") {
    imageUrl = resolveUrl(document.querySelector(".highres-show")?.getAttribute("href"), finalUrl);
  }
  if (!imageUrl) {
    imageUrl = resolveUrl(document.querySelector("#image")?.getAttribute("src"), finalUrl);
  }
  if (!imageUrl) return;
  const opts = { url: finalUrl };
  if (metadataNonEmpty(meta)) opts.metadata = meta;
  await downloadImage(imageUrl, opts);
}

function validatePageRange(startPage, endPage) {
  if (endPage >= startPage + 100) {
    throw new Error("在一次之内不允许爬取超过100页，咱二次元人要保持文明礼仪");
  }
  if (endPage < startPage) throw new Error("结束页面需要比开始页面大");
}

async function crawlQualityAll(baseUrl, quality, startPage, endPage) {
  const totalPages = endPage - startPage + 1;
  const pageProgress = 90.0 / totalPages;
  for (let page = startPage; page <= endPage; page += 1) {
    const pageUrl = `${baseUrl}/post/?page=${page}`;
    console.log(`[konachan][all] 打开页面 ${page}/${endPage}: ${pageUrl}`);
    const { document, finalUrl } = await openDocument(pageUrl);
    const hrefs = Array.from(document.querySelectorAll("#post-list-posts > li > div > a"))
      .map((a) => resolveUrl(a.getAttribute("href"), finalUrl))
      .filter(Boolean);
    for (const href of hrefs) {
      await processDetailPage(href, finalUrl, quality);
      if (hrefs.length > 0) addProgress(pageProgress / hrefs.length);
    }
  }
}

function buildTagSearchUrl(baseUrl, name, tagType, tagOrder, page) {
  return `${baseUrl}/tag?name=${encodeURIComponent(name)}&type=${encodeURIComponent(tagType)}&order=${encodeURIComponent(tagOrder)}&page=${page}`;
}

function parseTagTotalPages(document) {
  if (!document.querySelector("#paginator a.next_page")) return 1;
  const links = Array.from(document.querySelectorAll("#paginator > div > a")).map(textOf);
  const pageToken = links.length >= 2 ? links[links.length - 2] : "";
  return /^\d+$/.test(pageToken) ? Number(pageToken) : 1;
}

async function crawlTagPosts(baseUrl, quality, tagName, tagHref, expectedImages, perTagProgress) {
  const tagUrl = resolveUrl(tagHref, baseUrl);
  const joiner = tagUrl.includes("?") ? "&" : "?";
  const perImageProgress = expectedImages > 0 ? perTagProgress / expectedImages : 0.0;
  let postPage = 1;
  let downloaded = 0;
  while (true) {
    const pageUrl = `${tagUrl}${joiner}page=${postPage}`;
    const { document, finalUrl } = await openDocument(pageUrl);
    const hrefs = Array.from(document.querySelectorAll("#post-list-posts > li > div > a"))
      .map((a) => resolveUrl(a.getAttribute("href"), finalUrl))
      .filter(Boolean);
    if (hrefs.length === 0) break;
    for (const href of hrefs) {
      await processDetailPage(href, finalUrl, quality);
      downloaded += 1;
      if (expectedImages > 0 && downloaded <= expectedImages) addProgress(perImageProgress);
    }
    postPage += 1;
  }
  if (expectedImages <= 0) addProgress(perTagProgress);
  else if (downloaded < expectedImages) addProgress(perImageProgress * (expectedImages - downloaded));
  console.log(`[konachan][tag-list] 标签完成: ${tagName}，实际下载 ${downloaded} / 预计 ${expectedImages}`);
}

async function crawlByTag(baseUrl, quality, vars) {
  const searchName = trimText(vars.tag);
  const tagType = coerceStr(vars.mode_tag_type);
  const tagOrder = coerceStr(vars.mode_tag_order || "name");
  const skipCount = Math.max(0, Number(vars.mode_tag_skip ?? 0));
  const firstUrl = buildTagSearchUrl(baseUrl, searchName, tagType, tagOrder, 1);
  console.log("[konachan][tag-list] 开始标签列表模式");
  let { document } = await openDocument(firstUrl);
  const totalTagPages = parseTagTotalPages(document);
  const skipInFirstPage = skipCount % 50;
  const startTagPage = Math.floor((skipCount - skipInFirstPage) / 50) + 1;
  if (startTagPage > totalTagPages) return;
  const actualPagesToCrawl = totalTagPages - startTagPage + 1;
  const perPageProgress = actualPagesToCrawl > 0 ? 99.0 / actualPagesToCrawl : 0.0;

  for (let currentPage = startTagPage; currentPage <= totalTagPages; currentPage += 1) {
    const pageUrl = buildTagSearchUrl(baseUrl, searchName, tagType, tagOrder, currentPage);
    document = (await openDocument(pageUrl)).document;
    const rows = Array.from(document.querySelectorAll(".highlightable > tbody > tr"));
    const pageSkip = currentPage === startTagPage ? skipInFirstPage : 0;
    if (rows.length === 0 || pageSkip >= rows.length) {
      addProgress(perPageProgress);
      continue;
    }
    const rowsToProcess = rows.slice(pageSkip);
    const perTagProgress = perPageProgress / rowsToProcess.length;
    for (const row of rowsToProcess) {
      const anchor = row.querySelector("a[href*='tags']");
      const tagName = textOf(anchor);
      const tagHref = anchor?.getAttribute("href") || "";
      const imageCount = parseIntOrZero(textOf(row.querySelector("td:first-of-type")));
      if (imageCount <= 0) {
        addProgress(perTagProgress);
        continue;
      }
      await crawlTagPosts(baseUrl, quality, tagName, tagHref, imageCount, perTagProgress);
    }
  }
}

async function crawlByTags(baseUrl, quality, vars) {
  const tagsValue = buildTagsValueFromList(vars.mode_tag_value);
  if (!tagsValue) throw new Error("标签模式需要至少填写一个标签");
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  const totalPages = endPage - startPage + 1;
  const pageProgress = 90.0 / totalPages;
  for (let page = startPage; page <= endPage; page += 1) {
    const pageUrl = `${baseUrl}/post?tags=${tagsValue}&page=${page}`;
    const { document, finalUrl } = await openDocument(pageUrl);
    const hrefs = Array.from(document.querySelectorAll("#post-list-posts > li > div > a"))
      .map((a) => resolveUrl(a.getAttribute("href"), finalUrl))
      .filter(Boolean);
    for (const href of hrefs) {
      await processDetailPage(href, finalUrl, quality);
      if (hrefs.length > 0) addProgress(pageProgress / hrefs.length);
    }
  }
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = resolveBaseUrl(vars.source_site, common?.baseUrl);
  const quality = coerceStr(vars.quality || "high");
  if (vars.crawl_mode === "all") {
    validatePageRange(Number(vars.start_page ?? 1), Number(vars.end_page ?? 1));
    await crawlQualityAll(baseUrl, quality, Number(vars.start_page ?? 1), Number(vars.end_page ?? 1));
  } else if (vars.crawl_mode === "tag_list") {
    await crawlByTag(baseUrl, quality, vars);
  } else if (vars.crawl_mode === "tags") {
    validatePageRange(Number(vars.start_page ?? 1), Number(vars.end_page ?? 1));
    await crawlByTags(baseUrl, quality, vars);
  } else {
    throw new Error(`未知的爬取模式: ${vars.crawl_mode}`);
  }
}

// @ts-nocheck
import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";

const { addProgress, currentHtml, downloadImage, to } = Kabegame;

const BASE_URL = "https://yande.re";

// 站点是 Moebooru，和 konachan 同一套模板：作品列表每页 40 条、标签表每页 50 行，
// 未登录时 URL 上没有可用的每页条数参数，所以这两个数是站点写死的硬契约。
// 标签列表模式最多翻多少页标签表（凑不够目标标签数时的兜底上限）
const MAX_TAG_LIST_PAGES = 50;
// 单帖的收藏者可以有几百上千人，评论也可能很长。元数据会整条进库并参与画册列表查询，
// 放任不管会把 metadata 撑爆（参见 cocs/crawler/PIXIV_METADATA.md 的教训），这里截断。
const MAX_FAVORITED = 24;
const MAX_COMMENTS = 30;

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
  const token = trimText(text).replace(/,/g, "");
  return /^\d+$/.test(token) ? Number(token) : 0;
}

function normalizeTagToken(text) {
  return trimText(text).replace(/\s+/g, "_");
}

// 标签组合经 GUI 传进来是数组，但 kabegame-cli 的 --var 只能给字符串，
// 所以字符串形态也要接：按逗号/空白/加号切开。
function tagListOf(tagList) {
  const items = Array.isArray(tagList) ? tagList : coerceStr(tagList).split(/[,+\s]+/);
  return items.map((tag) => normalizeTagToken(tag)).filter(Boolean);
}

// 站点搜索串：token 之间用 +，每个 token 单独编码（rating:safe 里的冒号要转义）
function encodeTagsQuery(tokens) {
  return tokens.map((token) => encodeURIComponent(token)).join("+");
}

// rating / order 都是站点的元标签，跟普通标签一样拼进搜索串
function metaTokensOf(vars) {
  const tokens = [];
  const rating = trimText(vars.rating);
  if (rating) tokens.push(`rating:${rating}`);
  const sort = trimText(vars.sort_order);
  if (sort) tokens.push(sort);
  return tokens;
}

function buildPostListUrl(baseUrl, tokens, page) {
  const query = encodeTagsQuery(tokens);
  return query
    ? `${baseUrl}/post?tags=${query}&page=${page}`
    : `${baseUrl}/post?page=${page}`;
}

// 站点新结构中标签类型只体现在 li 的 tag-type-* class 上
const TAG_TYPE_CLASS_RE = /(?:^|\s)tag-type-([\w-]+)(?:\s|$)/;

// 从 /post?tags=xxx、/wiki/show?title=xxx、/artist/show?name=xxx 中取出标签标识
function tagNameFromHref(href) {
  const matched = /[?&](?:tags|title|name)=([^&#]+)/.exec(coerceStr(href));
  if (!matched) return "";
  let raw = matched[1].replace(/\+/g, " ");
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

// 评论区：#comments > .response-list > .comment（导航栏上也有个 li.comment，
// 必须走 .response-list 限定，否则会把菜单项当成一条评论）。
// 每条形如：.author > h6 > a（作者）+ span.date[title] > a（时间）
//          + .comment-avatar-container img.avatar（头像）；正文在 .content > .body。
function parseComments(document, pageUrl) {
  const rows = Array.from(document.querySelectorAll("#comments .response-list > .comment"));
  const comments = rows.slice(0, MAX_COMMENTS).map((row) => {
    const authorAnchor = row.querySelector(".author h6 a[href]");
    const dateEl = row.querySelector(".author .date");
    const dateAnchor = dateEl?.querySelector("a[href]") || null;
    const avatarImg = row.querySelector(".comment-avatar-container img");
    const avatarLink = row.querySelector(".comment-avatar-container a[href]");
    return {
      id: trimText(row.getAttribute("id")),
      author_name: textOf(authorAnchor),
      author_href: resolveUrl(authorAnchor?.getAttribute("href"), pageUrl),
      // 站点渲染的是相对时间（"over 8 years ago"），绝对时刻只在 title 上
      date_text: textOf(dateAnchor) || textOf(dateEl),
      date_href: resolveUrl(dateAnchor?.getAttribute("href"), pageUrl),
      date_title: trimText(dateEl?.getAttribute("title")),
      avatar_src: resolveUrl(avatarImg?.getAttribute("src"), pageUrl),
      avatar_href: resolveUrl(avatarLink?.getAttribute("href"), pageUrl),
      body: textOf(row.querySelector(".content .body")),
    };
  }).filter((c) => c.body || c.author_name);
  return { comments, total: rows.length };
}

function buildYandereMetadata(document, pageUrl) {
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
  // 站点当前模板不在 Statistics 区放上传者头像（头像只出现在评论里），
  // 保留读取是为了兼容仍渲染它的镜像站。
  const avatarLink = document.querySelector("#stats .comment-avatar-container a");
  const avatarImg = document.querySelector("#stats .comment-avatar-container img");

  const favoritedAll = Array.from(document.querySelectorAll("#favorited-by a[href]"));
  const favorited = favoritedAll.slice(0, MAX_FAVORITED).map((a) => ({
    href: resolveUrl(a.getAttribute("href"), pageUrl),
    name: textOf(a),
  })).filter((item) => item.name);

  const tags = parseSidebarTags(document, pageUrl);
  const { comments, total: commentTotal } = parseComments(document, pageUrl);

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
      favorited_total: favoritedAll.length,
    },
    related: parseRelatedPosts(document, pageUrl),
    comments,
    comment_total: commentTotal,
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
    meta.comments.length ||
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
  const meta = buildYandereMetadata(document, finalUrl);
  let imageUrl = "";
  // high = Options 区的 "View larger version"（.highres-show）原文件直链，
  // medium = #image 的 sample。没有原文件的帖子（本身就不大）自动降级。
  if (quality === "high") {
    imageUrl = resolveUrl(document.querySelector(".highres-show")?.getAttribute("href"), finalUrl);
  }
  if (!imageUrl) {
    imageUrl = resolveUrl(document.querySelector("#image")?.getAttribute("src"), finalUrl);
  }
  if (!imageUrl) {
    console.warn(`[yandere] 详情页没解析出图片地址，跳过：${finalUrl}`);
    return;
  }
  const opts = { url: finalUrl };
  if (metadataNonEmpty(meta)) opts.metadata = meta;
  await downloadImage(imageUrl, opts);
}

function collectPostHrefs(document, pageUrl) {
  return Array.from(document.querySelectorAll("#post-list-posts > li > div > a"))
    .map((a) => resolveUrl(a.getAttribute("href"), pageUrl))
    .filter(Boolean);
}

function validatePageRange(startPage, endPage) {
  if (endPage >= startPage + 100) {
    throw new Error("在一次之内不允许爬取超过100页，咱二次元人要保持文明礼仪");
  }
  if (endPage < startPage) throw new Error("结束页面需要比开始页面大");
}

// 列表页统一入口：给 URL 生成器，按页取详情页并均摊进度
async function crawlListPages(makePageUrl, quality, startPage, endPage, label) {
  const totalPages = endPage - startPage + 1;
  const pageProgress = 90.0 / totalPages;
  for (let page = startPage; page <= endPage; page += 1) {
    const pageUrl = makePageUrl(page);
    console.log(`[yandere][${label}] 打开页面 ${page}/${endPage}: ${pageUrl}`);
    const { document, finalUrl } = await openDocument(pageUrl);
    const hrefs = collectPostHrefs(document, finalUrl);
    if (hrefs.length === 0) {
      console.log(`[yandere][${label}] 第 ${page} 页没有作品，结束`);
      addProgress(pageProgress);
      break;
    }
    for (const href of hrefs) {
      await processDetailPage(href, finalUrl, quality);
      addProgress(pageProgress / hrefs.length);
    }
  }
}

async function crawlAll(baseUrl, quality, vars) {
  await crawlListPages(
    (page) => buildPostListUrl(baseUrl, metaTokensOf(vars), page),
    quality,
    Number(vars.start_page ?? 1),
    Number(vars.end_page ?? 1),
    "all",
  );
}

async function crawlByTags(baseUrl, quality, vars) {
  const tags = tagListOf(vars.mode_tag_value);
  if (tags.length === 0) throw new Error("标签模式需要至少填写一个标签");
  const tokens = tags.concat(metaTokensOf(vars));
  await crawlListPages(
    (page) => buildPostListUrl(baseUrl, tokens, page),
    quality,
    Number(vars.start_page ?? 1),
    Number(vars.end_page ?? 1),
    "tags",
  );
}

function buildTagSearchUrl(baseUrl, name, tagType, tagOrder, page) {
  return `${baseUrl}/tag?name=${encodeURIComponent(name)}&type=${encodeURIComponent(tagType)}` +
    `&order=${encodeURIComponent(tagOrder)}&page=${page}`;
}

// 标签表每行：<td>作品数</td><td>? <a href="/post?tags=name">display</a></td><td>类型</td><td>操作</td>
function parseTagRows(document) {
  return Array.from(document.querySelectorAll(".highlightable > tbody > tr"))
    .map((row) => {
      const anchor = row.querySelector("a[href*='tags']");
      if (!anchor) return null;
      const cells = Array.from(row.querySelectorAll("td"));
      return {
        name: tagNameFromHref(anchor.getAttribute("href")) || normalizeTagToken(textOf(anchor)),
        display: textOf(anchor),
        category: textOf(cells[2]),
        count: parseIntOrZero(textOf(cells[0])),
      };
    })
    .filter((tag) => tag && tag.name);
}

// 单个标签：按页取它的作品，最多 maxPages 页
async function crawlTagPosts(baseUrl, quality, tag, tokens, maxPages, perTagProgress) {
  const perPageProgress = perTagProgress / maxPages;
  let downloaded = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const pageUrl = buildPostListUrl(baseUrl, [tag.name].concat(tokens), page);
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
    `[yandere][tag-list] 标签完成: ${tag.name}（${tag.category || "?"}），实际下载 ${downloaded} / 站内共 ${tag.count}`,
  );
}

async function crawlByTagList(baseUrl, quality, vars) {
  const searchName = trimText(vars.tag);
  // 站点的标签类型参数只认数字（0 general / 1 artist / 3 copyright / 4 character /
  // 5 circle / 6 faults）。传英文名不会报错，会被当成 0 静默降级成「通用」，
  // 所以 kbConfig 里的 variable 必须是这些数字。
  const tagType = coerceStr(vars.mode_tag_type);
  const tagOrder = coerceStr(vars.mode_tag_order || "count");
  const skipCount = Math.max(0, Number(vars.mode_tag_skip ?? 0));
  const tagCount = Math.max(1, Number(vars.mode_tag_count ?? 3));
  const maxPages = Math.max(1, Number(vars.mode_tag_pages ?? 1));
  const tokens = metaTokensOf(vars);

  console.log(
    `[yandere][tag-list] 开始标签列表模式：匹配 ${searchName || "*"}` +
      `${tagType ? `（类型 ${tagType}）` : ""}，跳过 ${skipCount} 个，取 ${tagCount} 个，每个 ${maxPages} 页`,
  );
  const perTagProgress = 99.0 / tagCount;

  // 类型筛选由站点做，但空计数标签会被跳过，页内剩几个可用不定，
  // 所以用流水计数跳过而不是按页大小取模。
  let seen = 0;
  let picked = 0;
  for (let page = 1; picked < tagCount && page <= MAX_TAG_LIST_PAGES; page += 1) {
    const pageUrl = buildTagSearchUrl(baseUrl, searchName, tagType, tagOrder, page);
    const { document } = await openDocument(pageUrl);
    const rows = parseTagRows(document);
    if (rows.length === 0) {
      console.log(`[yandere][tag-list] 第 ${page} 页没有标签，结束`);
      break;
    }
    for (const tag of rows) {
      if (seen++ < skipCount) continue;
      if (picked >= tagCount) break;
      picked += 1;
      if (tag.count <= 0) {
        console.log(`[yandere][tag-list] 标签 ${tag.name} 没有作品，跳过`);
        addProgress(perTagProgress);
        continue;
      }
      await crawlTagPosts(baseUrl, quality, tag, tokens, maxPages, perTagProgress);
    }
  }
  if (picked === 0) console.warn("[yandere][tag-list] 没有匹配到任何标签，检查匹配式、类型与跳过数量");
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = coerceStr(common?.baseUrl) || BASE_URL;
  const quality = coerceStr(vars.quality || "high");
  const mode = coerceStr(vars.crawl_mode);

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

// @ts-nocheck
import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";

const { addProgress, currentHtml, downloadImage, to, warn } = Kabegame;

const BASE_URL = "https://yande.re";

// 站点是 Moebooru，和 konachan 同一套模板：作品列表每页 40 条，
// 未登录时 URL 上没有可用的每页条数参数，所以这是站点写死的硬契约。
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
  const html = await currentHtml();
  return { finalUrl, document: parseHtml(html), html };
}

function resolveUrl(url, base) {
  const raw = coerceStr(url).trim();
  return raw ? resolveSdkUrl(raw, base) : "";
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

// 标签画册：侧栏每种颜色是一种 tag 类型（yande.re 有 artist / copyright / character / circle / faults / general），
// 各自映射到 `yandere/<类型>` 目录下；类型缺失或不合规时按 general 处理（与 description.ejs 一致）。
// key 用站点自己的 tag 标识（小写、丢弃 key 字符集之外的字符），如 `hatsune_miku`；
// 派生后为空或超长的直接跳过。metadata_migrations/migrate.js 的 provideLabels 有一份同规则的副本
// （迁移运行在无 import 的裸 V8 里），改这里要同步改那里。
function tagLabelType(type) {
  const value = String(type || "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(value) ? value : "general";
}

function tagLabelKey(name) {
  const key = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

function labelsFromSidebarTags(tags) {
  const labels = [];
  for (const tag of tags || []) {
    const key = tagLabelKey(tag && tag.name);
    if (!key) continue;
    labels.push({
      key,
      category: `yandere/${tagLabelType(tag.type)}`,
      name: trimText(tag.display) || key.replace(/_/g, " "),
    });
  }
  return labels;
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
  const labels = labelsFromSidebarTags(meta.sidebar_tags);
  if (labels.length > 0) opts.labels = labels;
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

// ---- id 范围 ----
// 站点的 id:A..B 元标签按作品 id 闭区间过滤（2026-10 实测），配 order:id 升序翻页，每页 40 张。
// 区间内的空号是已删除的作品，所以实际张数通常少于区间宽度。排序固定为 id，不拼 sort_order。
const MAX_ID_SPAN = 5000;

function parsePostId(value, label) {
  const text = trimText(value);
  const id = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${label}需要是正整数，当前为「${text}」`);
  return id;
}

function parseIdRange(vars) {
  const startId = parsePostId(vars.id_start, "起始 id");
  const endId = parsePostId(vars.id_end, "结束 id");
  if (endId < startId) throw new Error(`结束 id（${endId}）需要不小于起始 id（${startId}）`);
  if (endId - startId > MAX_ID_SPAN) {
    throw new Error(`id 范围最多相差 ${MAX_ID_SPAN}，当前 ${startId}..${endId} 相差 ${endId - startId}`);
  }
  return { startId, endId };
}

// post.xml 的根节点带结果总数，只用来摊进度和判断抓满；取不到就翻到空页为止
async function countPosts(baseUrl, tokens) {
  try {
    const response = await fetch(`${baseUrl}/post.xml?tags=${encodeTagsQuery(tokens)}&limit=1`);
    if (!response.ok) return null;
    const matched = /<posts\b[^>]*\bcount="(\d+)"/.exec(await response.text());
    return matched ? Number(matched[1]) : null;
  } catch {
    return null;
  }
}

async function crawlByIdRange(baseUrl, quality, vars) {
  const { startId, endId } = parseIdRange(vars);
  const rating = trimText(vars.rating);
  const tokens = [`id:${startId}..${endId}`, "order:id"].concat(rating ? [`rating:${rating}`] : []);
  const total = await countPosts(baseUrl, tokens);
  console.log(`[yandere][id] id ${startId}..${endId}，共 ${total ?? "未知"} 张`);
  if (total === 0) return;
  // 总数未知时按区间宽度估页数，进度可能提前到顶，不影响抓取
  const estimatedPages = Math.max(1, Math.ceil((total ?? endId - startId + 1) / 40));
  const pageProgress = 90.0 / estimatedPages;
  // 每页至少有一个区间内的新 id，所以页数不可能超过区间宽度；这只是防止站点忽略 page 参数时死循环
  const maxPages = endId - startId + 1;
  let previousFirst = "";
  let seen = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const pageUrl = buildPostListUrl(baseUrl, tokens, page);
    console.log(`[yandere][id] 打开页面 ${page}/${total == null ? "?" : estimatedPages}: ${pageUrl}`);
    const { document, finalUrl } = await openDocument(pageUrl);
    const hrefs = collectPostHrefs(document, finalUrl);
    if (hrefs.length === 0 || hrefs[0] === previousFirst) break;
    previousFirst = hrefs[0];
    for (const href of hrefs) {
      await processDetailPage(href, finalUrl, quality);
      addProgress(pageProgress / hrefs.length);
    }
    seen += hrefs.length;
    // 总数已知时抓满即停，省掉最后一次空页请求
    if (total != null && seen >= total) break;
  }
}

// ---- 排行榜 ----
// Moebooru 的人气榜有两类地址（2026-10 实测 yande.re / konachan.net / konachan.com 一致）：
// - 滚动窗口：/post/popular_recent?period=1d|1w|1m|1y，只有当期；
// - 自然周期：/post/popular_by_day|week?day=&month=&year=、/post/popular_by_month?month=&year=，
//   改日期即可看往期（周榜按日期所在的那一周）。
// 每期只有一页、最多 40 张，page 参数无效，所以要多抓只能往前回溯期数。
const POPULAR_RECENT_PERIODS = new Set(["1d", "1w", "1m", "1y"]);
const POPULAR_CALENDAR_SCALES = new Set(["day", "week", "month"]);
const MAX_POPULAR_PERIODS = 100;
// 分级过滤的配置值 → Post.register 里的单字母 rating
const RATING_LETTERS = { safe: "s", questionable: "q", explicit: "e" };

// 留空取本地今天。站点按自己的时区切日，跨日前后几小时「今天」的榜可能还是空的。
function parsePopularDate(text) {
  const matched = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimText(text));
  const base = matched
    ? new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
    : new Date();
  return new Date(base.getFullYear(), base.getMonth(), base.getDate());
}

// 往前第 k 期（0 = 指定日期所在的那一期）
function shiftPopularDate(date, scale, k) {
  if (scale === "day") return new Date(date.getFullYear(), date.getMonth(), date.getDate() - k);
  if (scale === "week") return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7 * k);
  return new Date(date.getFullYear(), date.getMonth() - k, 1);
}

function buildPopularUrl(baseUrl, scale, date) {
  if (POPULAR_RECENT_PERIODS.has(scale)) return `${baseUrl}/post/popular_recent?period=${scale}`;
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (scale === "month") return `${baseUrl}/post/popular_by_month?month=${month}&year=${year}`;
  return `${baseUrl}/post/popular_by_${scale}?day=${date.getDate()}&month=${month}&year=${year}`;
}

// 榜单页不接受 tags 参数，分级只能在插件里筛。页面脚本里每张图独占一行
// Post.register({...})，带单字母 rating（s / q / e）。
function postRatingsOf(html) {
  const ratings = new Map();
  for (const matched of coerceStr(html).matchAll(/Post\.register\((\{.*\})\)/g)) {
    try {
      const post = JSON.parse(matched[1]);
      if (post && post.id != null) ratings.set(String(post.id), coerceStr(post.rating));
    } catch {
      // 单行解析失败不影响其他行
    }
  }
  return ratings;
}

function postIdOfHref(href) {
  const matched = /\/post\/show\/(\d+)/.exec(coerceStr(href));
  return matched ? matched[1] : "";
}

async function crawlPopular(baseUrl, quality, vars) {
  const scale = coerceStr(vars.popular_scale || "day");
  const recent = POPULAR_RECENT_PERIODS.has(scale);
  if (!recent && !POPULAR_CALENDAR_SCALES.has(scale)) throw new Error(`未知的排行榜类型: ${scale}`);
  // 滚动窗口只有当期，回溯期数对它没有意义
  const periods = recent
    ? 1
    : Math.min(MAX_POPULAR_PERIODS, Math.max(1, Math.floor(Number(vars.popular_periods ?? 1)) || 1));
  const startDate = parsePopularDate(vars.popular_date);
  const ratingName = trimText(vars.rating);
  const ratingLetter = RATING_LETTERS[ratingName] || "";
  const periodProgress = 90.0 / periods;
  for (let k = 0; k < periods; k += 1) {
    const pageUrl = buildPopularUrl(baseUrl, scale, shiftPopularDate(startDate, scale, k));
    console.log(`[yandere][popular] 打开排行榜 ${k + 1}/${periods}: ${pageUrl}`);
    const { document, finalUrl, html } = await openDocument(pageUrl);
    let hrefs = collectPostHrefs(document, finalUrl);
    if (ratingLetter && hrefs.length > 0) {
      const ratings = postRatingsOf(html);
      if (ratings.size === 0) {
        warn(`[yandere][popular] 页面里没找到作品分级信息，本期不做分级过滤：${finalUrl}`);
      } else {
        const before = hrefs.length;
        // 取不到分级的作品保留，宁可多下也不静默漏掉
        hrefs = hrefs.filter((href) => {
          const rating = ratings.get(postIdOfHref(href));
          return !rating || rating === ratingLetter;
        });
        console.log(`[yandere][popular] 分级过滤 ${ratingName}：${before} → ${hrefs.length}`);
      }
    }
    if (hrefs.length === 0) {
      console.log(`[yandere][popular] 本期没有符合条件的作品：${finalUrl}`);
      addProgress(periodProgress);
      continue;
    }
    for (const href of hrefs) {
      await processDetailPage(href, finalUrl, quality);
      addProgress(periodProgress / hrefs.length);
    }
  }
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
  } else if (mode === "popular") {
    await crawlPopular(baseUrl, quality, vars);
  } else if (mode === "id_range") {
    await crawlByIdRange(baseUrl, quality, vars);
  } else {
    throw new Error(`未知的爬取模式: ${mode}`);
  }
}

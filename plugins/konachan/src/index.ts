// @ts-nocheck
import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";

const { addProgress, currentHtml, downloadImage, requireCookie, setHeader, to, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://konachan.net";

// 根据源站选项解析基础 URL：net = konachan.net，com = konachan.com
function resolveBaseUrl(source, fallback) {
  const site = coerceStr(source).trim().toLowerCase();
  if (site === "com") return "https://konachan.com";
  if (site === "net") return "https://konachan.net";
  return coerceStr(fallback) || DEFAULT_BASE_URL;
}

// 两个站的 Cloudflare 规则不一样（2026-10 实测，均未带 cf_clearance）：
// - konachan.net：页面和原图都直接放行；
// - konachan.com：页面、post.json、/jpeg/ 原图一律 403 质询（/sample/ 反而放行），
//   必须带畅游里通过验证拿到的 cf_clearance，且它绑定签发时的 UA，所以同时换成畅游的 CEF UA。
// 原图和页面同域，downloadImage 调用时快照任务请求头，所以浏览器身份全程保留、不必在下载前撤掉。
const BROWSER_IDENTITY_HOSTS = new Set(["konachan.com"]);

let site = null; // { baseUrl, host, browserIdentity }

function prepareSite(baseUrl) {
  const host = new URL(baseUrl).host;
  site = { baseUrl, host, browserIdentity: BROWSER_IDENTITY_HOSTS.has(host) };
  if (!site.browserIdentity) return;
  // 旧版应用没有 cefUserAgent 接口，此时不覆盖 UA
  const ua = Kabegame.cefUserAgent?.() || "";
  if (ua) setHeader("User-Agent", ua);
  if (requireCookie(host)) {
    console.log(`[konachan] 已注入畅游中 ${host} 的 Cookie${ua ? " 与 CEF UA" : ""}`);
  } else {
    warn(`[konachan] 未从畅游取到 ${host} 的 Cookie；若请求被 403 拦截，请先在畅游中打开 ${baseUrl} 通过验证`);
  }
}

function siteBlockedError(reason) {
  const hint = site.browserIdentity
    ? `请先在畅游中打开 ${site.baseUrl} 通过验证，再重新运行任务`
    : "请检查代理网络或稍后重试";
  return new Error(`[konachan] ${site.host} ${reason}，被 Cloudflare 拦截：${hint}`);
}

function isChallengePage(document) {
  return /just a moment|attention required|checking your browser/i.test(trimText(document.title));
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
  let finalUrl;
  try {
    finalUrl = await to(url);
  } catch (error) {
    // 宿主把非 2xx 统一抛成 "HTTP error: <status>"，没有结构化的 status 字段
    if (/HTTP error: 403\b/.test(coerceStr(error?.message ?? error))) throw siteBlockedError("返回 403");
    throw error;
  }
  const html = await currentHtml();
  const document = parseHtml(html);
  if (isChallengePage(document)) throw siteBlockedError("返回了验证页");
  return { finalUrl, document, html };
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

// 分级是站点的 rating: 元标签，跟普通标签一样拼进搜索串，过滤发生在服务端分页之前。
// konachan.net 只收录全年龄内容，Questionable / Explicit 在那边查出来是空的。
function metaTokensOf(vars) {
  const rating = trimText(vars.rating);
  return rating ? [`rating:${rating}`] : [];
}

// 站点搜索串：token 之间用 +，每个 token 单独编码（rating:safe 里的冒号要转义）
function buildPostListUrl(baseUrl, tokens, page) {
  const query = tokens.map((token) => encodeURIComponent(token)).join("+");
  return query ? `${baseUrl}/post?tags=${query}&page=${page}` : `${baseUrl}/post?page=${page}`;
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

// 标签画册：侧栏每种颜色是一种 tag 类型（artist / copyright / character / circle / style / general），
// 各自映射到 `konachan/<类型>` 目录下；类型缺失或不合规时按 general 处理（与 description.ejs 一致）。
// key 用站点自己的 tag 标识（小写、丢弃 key 字符集之外的字符），如 `futaba_akane_(pentagon)`；
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
      category: `konachan/${tagLabelType(tag.type)}`,
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

async function crawlQualityAll(baseUrl, quality, startPage, endPage, tokens) {
  const totalPages = endPage - startPage + 1;
  const pageProgress = 90.0 / totalPages;
  for (let page = startPage; page <= endPage; page += 1) {
    const pageUrl = buildPostListUrl(baseUrl, tokens, page);
    console.log(`[konachan][all] 打开页面 ${page}/${endPage}: ${pageUrl}`);
    const { document, finalUrl } = await openDocument(pageUrl);
    const hrefs = collectPostHrefs(document, finalUrl);
    for (const href of hrefs) {
      await processDetailPage(href, finalUrl, quality);
      if (hrefs.length > 0) addProgress(pageProgress / hrefs.length);
    }
  }
}

async function crawlByTags(baseUrl, quality, vars) {
  const tags = tagListOf(vars.mode_tag_value);
  if (tags.length === 0) throw new Error("标签模式需要至少填写一个标签");
  const tokens = tags.concat(metaTokensOf(vars));
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  const totalPages = endPage - startPage + 1;
  const pageProgress = 90.0 / totalPages;
  for (let page = startPage; page <= endPage; page += 1) {
    const pageUrl = buildPostListUrl(baseUrl, tokens, page);
    console.log(`[konachan][tags] 打开页面 ${page}/${endPage}: ${pageUrl}`);
    const { document, finalUrl } = await openDocument(pageUrl);
    const hrefs = collectPostHrefs(document, finalUrl);
    for (const href of hrefs) {
      await processDetailPage(href, finalUrl, quality);
      if (hrefs.length > 0) addProgress(pageProgress / hrefs.length);
    }
  }
}

// ---- id 范围 ----
// 站点的 id:A..B 元标签按作品 id 闭区间过滤（2026-10 实测 konachan.net），配 order:id 升序翻页，
// 每页 40 张。区间内的空号是已删除的作品，所以实际张数通常远少于区间宽度。
const MAX_ID_SPAN = 5000;

function parsePostId(value, label) {
  const text = trimText(value);
  if (!/^\d+$/.test(text)) throw new Error(`${label}需要是正整数，当前为「${text}」`);
  const id = Number(text);
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

// post.xml 的根节点带结果总数，只用来摊进度；取不到（如 konachan.com 未过验证）就按每页均摊
async function countPosts(baseUrl, tokens) {
  const query = tokens.map((token) => encodeURIComponent(token)).join("+");
  try {
    const response = await fetch(`${baseUrl}/post.xml?tags=${query}&limit=1`);
    if (!response.ok) return null;
    const matched = /<posts\b[^>]*\bcount="(\d+)"/.exec(await response.text());
    return matched ? Number(matched[1]) : null;
  } catch {
    return null;
  }
}

async function crawlByIdRange(baseUrl, quality, vars) {
  const { startId, endId } = parseIdRange(vars);
  const tokens = [`id:${startId}..${endId}`, "order:id"].concat(metaTokensOf(vars));
  const total = await countPosts(baseUrl, tokens);
  console.log(`[konachan][id] id ${startId}..${endId}，共 ${total ?? "未知"} 张`);
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
    console.log(`[konachan][id] 打开页面 ${page}/${total == null ? "?" : estimatedPages}: ${pageUrl}`);
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
    console.log(`[konachan][popular] 打开排行榜 ${k + 1}/${periods}: ${pageUrl}`);
    const { document, finalUrl, html } = await openDocument(pageUrl);
    let hrefs = collectPostHrefs(document, finalUrl);
    if (ratingLetter && hrefs.length > 0) {
      const ratings = postRatingsOf(html);
      if (ratings.size === 0) {
        warn(`[konachan][popular] 页面里没找到作品分级信息，本期不做分级过滤：${finalUrl}`);
      } else {
        const before = hrefs.length;
        // 取不到分级的作品保留，宁可多下也不静默漏掉
        hrefs = hrefs.filter((href) => {
          const rating = ratings.get(postIdOfHref(href));
          return !rating || rating === ratingLetter;
        });
        console.log(`[konachan][popular] 分级过滤 ${ratingName}：${before} → ${hrefs.length}`);
      }
    }
    if (hrefs.length === 0) {
      console.log(`[konachan][popular] 本期没有符合条件的作品：${finalUrl}`);
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
  const baseUrl = resolveBaseUrl(vars.source_site, common?.baseUrl);
  prepareSite(baseUrl);
  const quality = coerceStr(vars.quality || "high");
  if (vars.crawl_mode === "all") {
    validatePageRange(Number(vars.start_page ?? 1), Number(vars.end_page ?? 1));
    await crawlQualityAll(
      baseUrl,
      quality,
      Number(vars.start_page ?? 1),
      Number(vars.end_page ?? 1),
      metaTokensOf(vars),
    );
  } else if (vars.crawl_mode === "tags") {
    validatePageRange(Number(vars.start_page ?? 1), Number(vars.end_page ?? 1));
    await crawlByTags(baseUrl, quality, vars);
  } else if (vars.crawl_mode === "popular") {
    await crawlPopular(baseUrl, quality, vars);
  } else if (vars.crawl_mode === "id_range") {
    await crawlByIdRange(baseUrl, quality, vars);
  } else {
    throw new Error(`未知的爬取模式: ${vars.crawl_mode}`);
  }
}

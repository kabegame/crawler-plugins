// @ts-nocheck
// zerochan.net V8 crawler：站点是纯 SSR，列表/详情全在首屏 HTML 里，
// 所以整条链路是 fetch + DOMParser，不需要 WebView。
import { resolveUrl as resolveSdkUrl, sleep } from "@kabegame/plugin-sdk";

const { addProgress, downloadImage, setHeader, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://www.zerochan.net";

// 站点每页固定 48 条（匿名下无法调整，那是账号设置项）
const ITEMS_PER_PAGE = 48;

const REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  // 固定英文：站点会按 Accept-Language 本地化标签展示名和 Stats 文案，
  // 而元数据要的是规范名（data-tag 恒为英文），本地化交给 description.ejs 做。
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
};

// 站点的 xbotcheck 门：首访返回 503 + "Checking browser..."，页面里放一张
// /totally-innocent-logo-image.svg?<token>，浏览器加载它时服务端 Set-Cookie
// 发 xbotcheck，然后 onload 里 reload。这里手工走同一套。
const BOT_CHECK_RE = /\/?totally-innocent-logo-image\.svg\?[A-Za-z0-9_-]+/;

/** 任务内的 cookie jar，写回任务默认 Cookie 头后 fetch/downloadImage 都会带上 */
const cookieJar = new Map();

function coerceStr(value) {
  return value == null ? "" : String(value);
}

function trimText(value) {
  return coerceStr(value).replace(/\s+/g, " ").trim();
}

function textOf(el) {
  return trimText(el?.textContent || "");
}

function attrOf(el, name) {
  return trimText(el?.getAttribute(name) || "");
}

function resolveUrl(url, base) {
  const raw = coerceStr(url).trim();
  return raw ? resolveSdkUrl(raw, base) : "";
}

function parseHtml(html) {
  return new DOMParser().parseFromString(coerceStr(html), "text/html");
}

function parseIntOrZero(text) {
  const token = trimText(text).replace(/[,\s]/g, "");
  return /^\d+$/.test(token) ? Number(token) : 0;
}

function applyRequestHeaders() {
  for (const [key, value] of Object.entries(REQUEST_HEADERS)) setHeader(key, value);
}

function writeCookieHeader() {
  if (cookieJar.size === 0) return;
  const pairs = [];
  for (const [name, value] of cookieJar) pairs.push(`${name}=${value}`);
  setHeader("Cookie", pairs.join("; "));
}

function absorbSetCookie(response) {
  const cookies = typeof response.headers?.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  let changed = false;
  for (const line of cookies) {
    const pair = coerceStr(line).split(";")[0];
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    cookieJar.set(name, value);
    changed = true;
  }
  if (changed) writeCookieHeader();
  return changed;
}

/**
 * 走一次 xbotcheck：拉挑战页里的 svg，把 Set-Cookie 收进 jar。
 * 自己不抛错——取 cookie 这一步也可能超时，失败就交回调用方按普通网络失败重试。
 */
async function solveBotCheck(challengeHtml, pageUrl) {
  const matched = BOT_CHECK_RE.exec(coerceStr(challengeHtml));
  if (!matched) return false;
  const probeUrl = resolveUrl(matched[0], pageUrl);
  console.log(`[zerochan] 触发站点 bot 校验，取 cookie：${probeUrl}`);
  let response;
  try {
    response = await fetch(probeUrl, { headers: { Accept: "image/svg+xml,image/*,*/*;q=0.8" } });
    await response.bytes();
  } catch (error) {
    warn(`[zerochan] bot 校验请求失败：${String(error?.message || error)}`);
    return false;
  }
  const ok = absorbSetCookie(response);
  if (!ok) warn("[zerochan] bot 校验响应里没有 Set-Cookie，后续请求可能仍被拦截");
  return ok;
}

// 两套独立预算：连接层失败（代理到该站超时并不罕见）和 bot 校验各记各的，
// 免得过一次闸就把网络重试次数吃光。
const MAX_NETWORK_RETRIES = 5;
const MAX_BOT_CHECKS = 2;

/** 取一个页面的 HTML；遇 503 挑战页自动过闸后重试，连接层失败退避重试 */
async function fetchDocument(url) {
  let networkRetries = 0;
  let botChecks = 0;
  let lastError = "";

  while (true) {
    let response;
    try {
      response = await fetch(url, { headers: { Accept: REQUEST_HEADERS.Accept } });
    } catch (error) {
      lastError = String(error?.message || error);
      if (networkRetries >= MAX_NETWORK_RETRIES) break;
      networkRetries += 1;
      warn(`[zerochan] 请求失败（${lastError}），${networkRetries * 3}s 后重试：${url}`);
      await sleep(networkRetries * 3000);
      continue;
    }

    const finalUrl = response.url || url;
    const text = await response.text();
    absorbSetCookie(response);
    if (response.status === 200) return { finalUrl, document: parseHtml(text) };

    lastError = `HTTP ${response.status}`;
    // 503 + 挑战页：过闸成功就立刻重试（不记网络重试次数）。
    // 过闸失败（取 cookie 也超时 / 没发 Set-Cookie）则落到下面的退避重试，
    // 免得一次网络抖动就把 bot 校验预算白白吃掉。
    if (response.status === 503 && BOT_CHECK_RE.test(text)) {
      if (botChecks < MAX_BOT_CHECKS && (await solveBotCheck(text, finalUrl))) {
        botChecks += 1;
        await sleep(1000);
        continue;
      }
      if (botChecks >= MAX_BOT_CHECKS) lastError = "反复触发 bot 校验";
    }
    if (networkRetries >= MAX_NETWORK_RETRIES) break;
    networkRetries += 1;
    warn(`[zerochan] HTTP ${response.status}，${networkRetries * 3}s 后重试：${url}`);
    await sleep(networkRetries * 3000);
  }

  throw new Error(`[zerochan] 打开页面失败（${lastError}）：${url}`);
}

// ---------------------------------------------------------------- 列表页

// 列表条目：ul#thumbs2 > li[data-id] > div > a.thumb[href="/<id>"]。
// 缩略图版式（?m=0..4）会换成 #thumbs/#thumbs3/#thumbs4，容器 id 不同但结构一致，
// 匿名下默认 masonry(#thumbs2)，这里把几种都收进来免得换了默认就抓不到。
const THUMB_CONTAINERS = ["#thumbs", "#thumbs2", "#thumbs3", "#thumbs4"];
const THUMB_CONTAINER_SELECTOR = THUMB_CONTAINERS.join(", ");
const THUMB_LINK_SELECTOR = THUMB_CONTAINERS
  .map((id) => `${id} > li[data-id] a.thumb[href]`)
  .join(", ");

function collectPostHrefs(document, pageUrl) {
  const hrefs = Array.from(document.querySelectorAll(THUMB_LINK_SELECTOR))
    .map((a) => resolveUrl(a.getAttribute("href"), pageUrl))
    .filter(Boolean);
  // 空结果页仍然有 #thumbs2 容器；连容器都没有说明拿到的不是列表页
  // （挑战页 / 错误页 / 标签不存在），不区分的话会伪装成「这个标签没图」静默跑完。
  if (hrefs.length === 0 && !document.querySelector(THUMB_CONTAINER_SELECTOR)) {
    warn(`[zerochan] 页面里没有作品列表容器，可能被站点拦截或标签不存在：${pageUrl}`);
  }
  return hrefs;
}

/** 站内标签路径段：空格转 +，其余按 URL 编码（站点自己就是这么拼的） */
function encodeTagPath(tag) {
  return encodeURIComponent(trimText(tag)).replace(/%20/g, "+");
}

/**
 * 把爬取模式解析成「翻页基址」——一个已经带好检索条件、只差 s/p 的 URL。
 *
 * search 模式必须先真跑一次 /search：站点会 302 到最匹配的标签页并**只保留 q=**，
 * 把 s= 和 p= 都丢掉。所以不能直接给 /search 拼分页参数，否则排序失效、永远停在第 1 页。
 */
async function resolveListBase(baseUrl, mode, keyword) {
  if (mode === "tag") return `${baseUrl}/${encodeTagPath(keyword)}`;
  if (mode !== "search") return `${baseUrl}/`;

  const probeUrl = `${baseUrl}/search?q=${encodeURIComponent(keyword)}`;
  const { finalUrl } = await fetchDocument(probeUrl);
  if (/\/search\b/.test(finalUrl)) {
    warn(`[zerochan] 搜索词没能匹配到站内标签，站点仍停在 /search：${finalUrl}`);
  } else {
    console.log(`[zerochan] 搜索「${keyword}」解析到：${finalUrl}`);
  }
  return finalUrl;
}

function buildListUrl(listBase, sortOrder, page) {
  const url = new URL(listBase);
  url.searchParams.set("s", sortOrder);
  url.searchParams.set("p", String(page));
  return url.toString();
}

// ---------------------------------------------------------------- 详情页

// li 的 class 既是分类也是配色键（mangaka/game/series/character/theme/source/...），
// 其中 fav / primary / editable 是状态类，要从分类里择出去。
const TAG_STATE_CLASSES = new Set([
  "fav",
  "primary",
  "primary-tag",
  "editable",
  "haspri",
  "auto",
  "ancestor",
  "highlight",
]);

function tagTypeOf(li) {
  const classes = coerceStr(li.getAttribute("class")).split(/\s+/).filter(Boolean);
  for (const name of classes) {
    if (!TAG_STATE_CLASSES.has(name)) return name;
  }
  return "theme";
}

// 侧栏 <s class="medium X"> 是 sprite 图标名，模板按同一套名字还原图标
function tagIconOf(li) {
  const icon = li.querySelector("s");
  if (!icon) return "";
  return coerceStr(icon.getAttribute("class"))
    .split(/\s+/)
    .filter((name) => name && name !== "medium" && name !== "small" && name !== "tiny" && name !== "large")
    .join(" ");
}

// title 形如 "Added by eric_fe" 或 "(Salmonbb Poni) Added by eric_fe"
function tagAddedBy(li) {
  const title = attrOf(li, "title");
  const matched = /Added by\s+(.+)$/i.exec(title);
  return matched ? trimText(matched[1]) : "";
}

function parseSidebarTags(document, pageUrl) {
  return Array.from(document.querySelectorAll("#tags > li[data-tag]"))
    .map((li) => {
      const anchor = li.querySelector("a[href]");
      const classes = coerceStr(li.getAttribute("class")).split(/\s+/);
      return {
        // data-tag 是规范名（恒为英文），锚文本是按站点语言本地化的展示名
        tag: attrOf(li, "data-tag"),
        label: textOf(anchor) || attrOf(li, "data-tag"),
        type: tagTypeOf(li),
        icon: tagIconOf(li),
        url: resolveUrl(anchor?.getAttribute("href"), pageUrl),
        by: tagAddedBy(li),
        fav: classes.includes("fav"),
        primary: classes.includes("primary"),
      };
    })
    .filter((tag) => tag.tag);
}

function parseBreadcrumbs(document, pageUrl) {
  return Array.from(document.querySelectorAll(".breadcrumbs > span[data-tag]"))
    .map((span) => {
      const anchor = span.querySelector("a[href]");
      return {
        tag: attrOf(span, "data-tag"),
        label: textOf(anchor) || attrOf(span, "data-tag"),
        type: trimText(span.getAttribute("class")) || "theme",
        url: resolveUrl(anchor?.getAttribute("href"), pageUrl),
      };
    })
    .filter((item) => item.tag);
}

// 来源块：<p id="source-url"><s class="medium pixiv source-icon"></s>https://…</p>
function parseSource(document) {
  const el = document.querySelector("#source-url");
  if (!el) return null;
  const iconEl = el.querySelector("s");
  const icon = coerceStr(iconEl?.getAttribute("class") || "")
    .split(/\s+/)
    .filter((name) => name && name !== "medium" && name !== "source-icon")
    .join(" ");
  // 站点把 URL 直接当文本渲染（不是链接），取文本节点即可
  const text = textOf(el);
  if (!text) return null;
  return { url: text, icon };
}

function parseShare(document) {
  const form = document.querySelector("#share-form");
  if (!form) return null;
  const valueOf = (name) => attrOf(form.querySelector(`input[name='${name}']`), "value");
  const share = {
    permalink: valueOf("permalink"),
    bbcode: valueOf("bbthumb"),
    html: valueOf("htmlthumb"),
  };
  return share.permalink || share.bbcode || share.html ? share : null;
}

// Stats 三行是本地化文案（"29 favorites" / "29 收藏"），只取数字，
// 文案交给 description.ejs 按应用 locale 重新渲染。
function parseStats(document) {
  const items = Array.from(document.querySelectorAll("#image-stats > li")).map(textOf);
  const stats = { width: 0, height: 0, megapixels: "", favorites: 0, tag_count: 0 };
  for (const line of items) {
    const size = /(\d+)\s*[×x✕]\s*(\d+)/i.exec(line);
    if (size) {
      stats.width = Number(size[1]) || 0;
      stats.height = Number(size[2]) || 0;
      const mp = /\(([\d.]+)\s*MP\)/i.exec(line);
      if (mp) stats.megapixels = mp[1];
      continue;
    }
    const count = /^([\d,]+)\s+(.*)$/.exec(line);
    if (!count) continue;
    // 顺序是站点固定的：尺寸 → 收藏 → 标签数
    if (stats.favorites === 0) stats.favorites = parseIntOrZero(count[1]);
    else if (stats.tag_count === 0) stats.tag_count = parseIntOrZero(count[1]);
  }
  return stats;
}

// #image-info 两行："2399×4096" / "6,749kB jpg"
function parseImageInfo(document) {
  const items = Array.from(document.querySelectorAll("#image-info > li")).map(textOf);
  const info = { file_size: "", file_ext: "" };
  for (const line of items) {
    const matched = /^([\d,]+\s*[kKmMgG]?[bB])\s+([a-z0-9]+)$/.exec(line);
    if (matched) {
      info.file_size = trimText(matched[1]);
      info.file_ext = trimText(matched[2]).toLowerCase();
    }
  }
  return info;
}

function parseUploader(document, pageUrl) {
  const anchor = document.querySelector("#content a.user[href]");
  if (!anchor) return null;
  const avatar = anchor.querySelector("img");
  return {
    name: textOf(anchor) || attrOf(anchor, "data-user"),
    url: resolveUrl(anchor.getAttribute("href"), pageUrl),
    avatar: resolveUrl(avatar?.getAttribute("src"), pageUrl),
  };
}

// 首段形如 "Mangaka: <a>Poni Arknights</a>, Uploaded by <a>eric_fe</a> on Apr 29, 2023,"
function parseMangaka(document, pageUrl) {
  const anchor = document.querySelector("#content > p > a[href^='/']:not(.user)");
  if (!anchor) return null;
  const name = textOf(anchor);
  if (!name) return null;
  return { name, url: resolveUrl(anchor.getAttribute("href"), pageUrl) };
}

function parseUploadedAt(document) {
  const span = document.querySelector("#content a.user + span, #content a.user ~ span");
  return textOf(span).replace(/^on\s+/i, "");
}

function buildMetadata(document, pageUrl) {
  const tags = parseSidebarTags(document, pageUrl);
  const stats = parseStats(document);
  const info = parseImageInfo(document);
  const previewAnchor = document.querySelector("#large a.preview[href]");
  const previewImg = document.querySelector("#large a.preview img");
  const postId = /\/(\d+)(?:[/?#]|$)/.exec(pageUrl);

  return {
    schema: 1,
    post_id: postId ? postId[1] : "",
    title: textOf(document.querySelector("#content > h1")),
    permalink: pageUrl,
    breadcrumbs: parseBreadcrumbs(document, pageUrl),
    mangaka: parseMangaka(document, pageUrl),
    uploader: parseUploader(document, pageUrl),
    uploaded_at: parseUploadedAt(document),
    width: stats.width,
    height: stats.height,
    file_size: info.file_size,
    file_ext: info.file_ext,
    // 规范名串，直接可用于二次检索 / AI 生图 prompt
    tags_string: tags.map((tag) => tag.tag).join(", "),
    tags,
    source: parseSource(document),
    share: parseShare(document),
    stats,
    full_url: resolveUrl(previewAnchor?.getAttribute("href"), pageUrl),
    sample_url: resolveUrl(previewImg?.getAttribute("src"), pageUrl),
  };
}

/** 展示名：主标签（角色/作品）+ 画师，跟站点 h1 的构成一致 */
function pickDisplayName(metadata) {
  const primary = metadata.tags.find((tag) => tag.primary);
  const character = metadata.breadcrumbs.find((item) => item.type === "character");
  const work = metadata.breadcrumbs.find((item) => item.type !== "character");
  const subject = primary?.tag || character?.tag || work?.tag || "";
  const parts = [];
  if (work && work.tag !== subject) parts.push(`${subject} (${work.tag})`);
  else if (subject) parts.push(subject);
  if (metadata.mangaka?.name) parts.push(metadata.mangaka.name);
  return parts.join(" / ");
}

function pickImageUrl(metadata, quality) {
  if (quality === "medium") return metadata.sample_url || metadata.full_url;
  return metadata.full_url || metadata.sample_url;
}

async function processDetailPage(url, quality) {
  const { finalUrl, document } = await fetchDocument(url);
  const metadata = buildMetadata(document, finalUrl);
  const imageUrl = pickImageUrl(metadata, quality);
  if (!imageUrl) {
    warn(`[zerochan] 详情页没解析出图片地址，跳过：${finalUrl}`);
    return;
  }
  const opts = { cookie: true, url: finalUrl, metadata };
  const name = pickDisplayName(metadata);
  if (name) opts.name = name;
  await downloadImage(imageUrl, opts);
}

// ---------------------------------------------------------------- 入口

function validatePageRange(startPage, endPage) {
  if (endPage < startPage) throw new Error("结束页面需要比开始页面大");
  if (endPage >= startPage + 100) {
    throw new Error("在一次之内不允许爬取超过100页，咱二次元人要保持文明礼仪");
  }
}

function resolveKeyword(mode, vars) {
  if (mode === "tag") {
    const tag = trimText(vars.tag);
    if (!tag) throw new Error("标签模式需要填写一个站内标签，例如 Arknights");
    return tag;
  }
  if (mode === "search") {
    const query = trimText(vars.search_query);
    if (!query) throw new Error("搜索模式需要填写搜索词");
    return query;
  }
  return "";
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = (coerceStr(common?.base_url || common?.baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const mode = coerceStr(vars.crawl_mode || "all");
  const sortOrder = coerceStr(vars.sort_order || "id");
  const quality = coerceStr(vars.quality || "high");
  const startPage = Math.max(1, Number(vars.start_page ?? 1));
  const endPage = Math.max(1, Number(vars.end_page ?? startPage));

  if (mode !== "all" && mode !== "tag" && mode !== "search") {
    throw new Error(`未知的爬取模式: ${mode}`);
  }
  validatePageRange(startPage, endPage);
  const keyword = resolveKeyword(mode, vars);

  applyRequestHeaders();
  console.log(
    `[zerochan] 开始：模式=${mode}${keyword ? `(${keyword})` : ""} 排序=${sortOrder === "fav" ? "人气" : "最新"} 第 ${startPage}~${endPage} 页`,
  );

  const listBase = await resolveListBase(baseUrl, mode, keyword);
  const totalPages = endPage - startPage + 1;
  const pageProgress = 99.0 / totalPages;
  for (let page = startPage; page <= endPage; page += 1) {
    const listUrl = buildListUrl(listBase, sortOrder, page);
    console.log(`[zerochan] 打开列表页 ${page}/${endPage}: ${listUrl}`);
    const { finalUrl, document } = await fetchDocument(listUrl);
    const hrefs = collectPostHrefs(document, finalUrl);
    console.log(`[zerochan] 第 ${page} 页作品数量: ${hrefs.length}（站点每页 ${ITEMS_PER_PAGE} 条，匿名可见的会更少）`);
    if (hrefs.length === 0) {
      addProgress(pageProgress * (endPage - page + 1));
      break;
    }
    const itemProgress = pageProgress / hrefs.length;
    for (const href of hrefs) {
      await sleep(500);
      try {
        await processDetailPage(href, quality);
      } catch (error) {
        // 单张图打不开（走代理连该站超时并不罕见）不该把整个任务带走：
        // 列表页失败才是致命的，详情页记一条 WARN 跳过就行。
        warn(`[zerochan] 跳过这张：${String(error?.message || error)}`);
      }
      addProgress(itemProgress);
    }
  }

  console.log("[zerochan] 任务结束");
}

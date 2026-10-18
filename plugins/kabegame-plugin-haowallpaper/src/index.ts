// 哲风壁纸（haowallpaper.com）V8 爬虫。
//
// 站点是 Nuxt 3 SSR：列表页与详情页的标记都在首屏 HTML 里，直接解析即可，
// 不需要 WebView 模拟鼠标点击。`__NUXT_DATA__` 里的接口数据是加密串，忽略它。
//
// 下载地址统一是 /common/file/previewFileImg/<fileId>：
//   - 图片返回 WebP（约 1100px 宽），视频返回压缩后的 mp4；
//   - 无需 referer / cookie / UA，不受限制；
//   - 原图端点 downloadFile 需要登录（401），本插件不碰。

import { labelsFromMetadata } from "./labels";
import { t } from "./i18n";

const { addProgress, currentDocument, downloadImage, to, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://haowallpaper.com";

/** 站点列表的默认排序（桌面 / 手机均为 3 =「昨日热门」），与站内搜索框提交的一致。 */
const SORT_TYPE = "3";

/** metadata 结构版本，改字段时递增，供后续 migration 脚本识别。 */
const METADATA_SCHEMA = 2;

/**
 * 查询根：常规 Document，或 Nuxt 把 body 包进 <template> 后的 template.content。
 * deno_dom 的最小 DOM 类型里没有 content，运行时的 DocumentFragment 只用到查询方法。
 */
type QueryRoot = Document | Element;

/** 详情页 JSON-LD 的最小结构，只声明实际读取的字段。 */
type HaowallpaperJsonLd = {
  "@type"?: unknown;
  contentUrl?: unknown;
  caption?: unknown;
  name?: unknown;
  width?: unknown;
  height?: unknown;
  contentSize?: unknown;
  encodingFormat?: unknown;
  fileFormat?: unknown;
  duration?: unknown;
};

/** 详情卡片底部的发布者信息。 */
type HaowallpaperPublisher = {
  id: string;
  name: string;
  profile_url: string;
  avatar_url: string;
  follower_count: string;
  share_count: string;
  download_count: string;
  signature: string;
};

/**
 * metadata 必须保持 JSON 可序列化，所以用 type 而非 interface
 * （interface 不满足 KabegameJsonValue 的索引签名）。
 */
type HaowallpaperMetadata = {
  schema: number;
  title: string;
  post_id: string;
  file_id: string;
  detail_url: string;
  download_url: string;
  is_video: boolean;
  tags: string[];
  category: string;
  resolution: string;
  width: number;
  height: number;
  color: string;
  color_hex: string;
  size: string;
  format: string;
  duration: string;
  download_count: string;
  favorite_count: string;
  published_at: string;
  author: string;
  author_id: string;
  publisher: HaowallpaperPublisher;
};

function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

function textOf(el: Element | null | undefined): string {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// catch 里的值是 unknown；保持原来 `error?.message ?? error` 的字符串回退语义。
function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (message != null) return String(message);
  }
  return String(error);
}

/**
 * 站点（Nuxt SSR）把整个 body 内容包在唯一一个 <template> 里。按 HTML 规范，
 * template 的内容会被解析进独立的 DocumentFragment，不属于常规 DOM 树，因此
 * document.querySelectorAll 查不到任何卡片/信息行。deno_dom 遵循该语义，必须
 * 改用 template.content 作为查询根。（head 里的 JSON-LD 与 meta 仍在 document 上。）
 */
function contentRoot(document: Document): QueryRoot {
  const template = document.querySelector("template");
  // template.content 不在最小 DOM 类型里，按属性存在性读成 unknown 再收窄
  const frag: unknown =
    template && "content" in template ? template.content : null;
  return isQueryRoot(frag) ? frag : document;
}

function isQueryRoot(value: unknown): value is QueryRoot {
  return (
    value !== null &&
    typeof value === "object" &&
    "querySelectorAll" in value &&
    typeof value.querySelectorAll === "function"
  );
}

/**
 * 必须走宿主的 currentDocument()：deno_dom 是 wasm 实现，直接 `new DOMParser()`
 * 会跳过 initParser() 初始化，解析出空文档且不报错（所有选择器静默返回 0 条）。
 */
async function openDocument(url: string) {
  const finalUrl = await to(url);
  const document = await currentDocument();
  if (!document) throw new Error(t("pageParseFailed", { url: finalUrl }));
  return { finalUrl, document, root: contentRoot(document) };
}

function resolveUrl(url: unknown, base: string): string {
  const raw = coerceStr(url).trim();
  if (!raw) return "";
  try {
    // 站点把链接写成 /link//common/file/...（双斜杠），URL 能正常归一。
    return new URL(raw, base).href;
  } catch {
    return "";
  }
}

/**
 * 详情页的 JSON-LD。Nuxt 把它塞在 children 属性里而不是脚本正文，
 * 所以必须走 getAttribute 而非 textContent。
 */
function parseJsonLd(document: Document): HaowallpaperJsonLd | null {
  const el = document.querySelector('script[type="application/ld+json"]');
  const raw = el?.getAttribute("children") || textOf(el);
  if (!raw) return null;
  try {
    // 外部 JSON 边界：站点结构不受类型约束
    return JSON.parse(raw) as HaowallpaperJsonLd;
  } catch {
    return null;
  }
}

/** `.icon-all` 里是「分类：xxx」「大小：xxx」这类行，按标签前缀取值。 */
function parseInfoRows(root: QueryRoot): Record<string, string> {
  const rows: Record<string, string> = {};
  for (const row of Array.from(root.querySelectorAll(".icon-all .col-son-ico"))) {
    const text = textOf(row);
    const match = text.match(/^(.+?)[:：]\s*(.*)$/);
    if (!match) continue;
    rows[match[1].trim()] = match[2].trim();
  }
  return rows;
}

function parseTags(document: Document, root: QueryRoot): string[] {
  // meta keywords 在 head（template 之外）。
  const keywords = document
    .querySelector('meta[name="keywords"]')
    ?.getAttribute("content");
  if (keywords) {
    return keywords.split(",").map((t) => t.trim()).filter(Boolean);
  }
  // 兜底：相关标签区块（在 template 内）。
  return Array.from(root.querySelectorAll(".the-body-there .contentSpen a"))
    .map((a) => textOf(a))
    .filter(Boolean);
}

/** 详情卡片底部的发布者信息。只保存结构化字段，不冻结站点 HTML。 */
function parsePublisher(root: QueryRoot, pageUrl: string): HaowallpaperPublisher {
  const block = root.querySelector(".col-son-bottom");
  const profileLink = block?.querySelector('a[href*="/userProfile/"]');
  const profileUrl = resolveUrl(profileLink?.getAttribute("href"), pageUrl);
  const counts: Record<string, string> = {};
  for (const item of Array.from(block?.querySelectorAll(".col-count") || [])) {
    const label = textOf(item.querySelector("span:first-child"));
    const value = textOf(item.querySelector(".count"));
    if (label) counts[label] = value;
  }

  return {
    id: profileUrl.match(/userProfile\/(\d+)/)?.[1] || "",
    name: textOf(block?.querySelector(".user-nick-name")),
    profile_url: profileUrl,
    avatar_url: resolveUrl(block?.querySelector(".user-avatar-img")?.getAttribute("src"), pageUrl),
    follower_count: counts["粉丝"] || "",
    share_count: counts["分享"] || "",
    download_count: counts["获载"] || "",
    signature: textOf(block?.querySelector(".user-relevant-2")).replace(/^签名[:：]\s*/, ""),
  };
}

/**
 * 分页条最大的数字即总页数。页码是 `<a>`，「...」省略号是 `<div>`，
 * 两者都扫，非数字项自然被跳过。
 */
function parseTotalPages(root: QueryRoot): number {
  let maxPage = 1;
  for (const el of Array.from(root.querySelectorAll(".page-content a, .page-content div"))) {
    const num = Number(textOf(el));
    if (Number.isInteger(num) && num > maxPage) maxPage = num;
  }
  return maxPage;
}

/**
 * 列表页 → 详情页链接。
 * 桌面版是 .card 卡片里的「前往」按钮，手机版是瀑布流里的 a.cardMobile，
 * 两者标记不同，故按 href 模式兜底。
 */
function parseDetailLinks(root: QueryRoot, listUrl: string): string[] {
  const selectors = [".card .card--button a[href]", "a.cardMobile[href]", 'a[href*="ViewLook/"]'];
  for (const selector of selectors) {
    const links = Array.from(root.querySelectorAll(selector))
      .map((a) => resolveUrl(a.getAttribute("href"), listUrl))
      .filter((href) => /\/(?:home|mobile)ViewLook\/\d+/.test(href));
    const unique = Array.from(new Set(links));
    if (unique.length > 0) return unique;
  }
  return [];
}

/** checkbox 变量的单项开关：非对象或缺失字段都按「未关闭」处理。 */
function formatEnabled(formats: unknown, key: "image" | "video"): boolean {
  if (formats === null || typeof formats !== "object") return true;
  if (key === "image") return !("image" in formats) || formats.image !== false;
  return !("video" in formats) || formats.video !== false;
}

function wantsFormat(formats: unknown, isVideo: boolean): boolean {
  // checkbox 类型的变量以 { image: true, video: false } 形式传入。
  return formatEnabled(formats, isVideo ? "video" : "image");
}

/** 站点「种类」下拉的取值：1 = 静态壁纸，2 = 动态壁纸。 */
const KIND_STATIC = 1;
const KIND_DYNAMIC = 2;

/**
 * 照搬站点前端 SearchBar 的 `Ke(routerName, 种类)`，把「页面 × 种类」翻译成 wpType：
 *   1 电脑静态 / 2 手机静态 / 3,4 电脑动态 / 5,6 手机动态。
 * 不传 wpType 时站点用页面默认集合（homeView = 1,3,4,7，mobileView = 2,5,6,8），
 * 即静态 + 动态都要。页面与 wpType 必须配对：homeView 配手机种类时，
 * 详情链接指向 homeViewLook 却拿不到 JSON-LD。
 */
function wpTypeOf(routerName: unknown, kind: unknown): string | null {
  if (kind == KIND_STATIC) {
    if (routerName == "homeView") return "1";
    if (routerName == "mobileView") return "2";
  } else if (kind == KIND_DYNAMIC) {
    if (routerName == "homeView") return "3,4";
    if (routerName == "mobileView") return "5,6";
  }
  return null;
}

/** 壁纸格式 → 站点「种类」：只勾一种时定向，两种都勾则不限（null，走站点默认集合）。 */
function kindOf(formats: unknown): number | null {
  const image = wantsFormat(formats, false);
  const video = wantsFormat(formats, true);
  if (image && !video) return KIND_STATIC;
  if (video && !image) return KIND_DYNAMIC;
  return null;
}

/**
 * 列表页地址，查询参数与站内搜索栏提交的一致，例如
 * `/homeView?page=8&search=动漫、二次元&sortType=3&wpType=3,4`。
 * 标签走站点搜索：多个标签用「、」连接，站点按并集返回。
 */
function buildListUrl(
  baseUrl: string,
  wallpaperType: string,
  page: number,
  tags: string[],
  kind: number | null,
): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (tags.length > 0) params.set("search", tags.join("、"));
  params.set("sortType", SORT_TYPE);
  const wpType = wpTypeOf(wallpaperType, kind);
  if (wpType) params.set("wpType", wpType);
  // 保留 wpType 里的逗号，与站点地址（`wpType=3,4`）保持一致。
  return `${baseUrl}/${wallpaperType}?${params.toString().replace(/%2C/gi, ",")}`;
}

async function processDetailPage(detailUrl: string, formats: unknown): Promise<boolean> {
  const { document, finalUrl, root } = await openDocument(detailUrl);
  const jsonLd = parseJsonLd(document);
  if (!jsonLd) {
    warn(t("missingJsonLd", { url: finalUrl }));
    return false;
  }

  const isVideo = coerceStr(jsonLd["@type"]) === "VideoObject";
  if (!wantsFormat(formats, isVideo)) return false;

  const tags = parseTags(document, root);

  const downloadUrl = resolveUrl(jsonLd.contentUrl, finalUrl);
  if (!downloadUrl) {
    warn(t("missingContentUrl", { url: finalUrl }));
    return false;
  }

  const detailPanel =
    root.querySelector(
      ".preview-block .col-md-4.is-nt-front .col-4-son-1",
    ) || root;
  const rows = parseInfoRows(detailPanel);
  const title = coerceStr(jsonLd.caption || jsonLd.name || textOf(root.querySelector(".details-page h1")));
  const postId = finalUrl.match(/ViewLook\/(\d+)/)?.[1] || "";
  const fileId = downloadUrl.match(/previewFileImg\/(\w+)/)?.[1] || "";
  const publisher = parsePublisher(detailPanel, finalUrl);

  const metadata: HaowallpaperMetadata = {
    schema: METADATA_SCHEMA,
    title,
    post_id: postId,
    file_id: fileId,
    detail_url: finalUrl,
    download_url: downloadUrl,
    is_video: isVideo,
    tags,
    category: rows["分类"] || "",
    resolution: rows["分辨率"] || "",
    // 手机壁纸详情页没有「分辨率」行，宽高只在 JSON-LD 里。
    width: Number(jsonLd.width) || 0,
    height: Number(jsonLd.height) || 0,
    color: rows["色系"] || "",
    color_hex:
      detailPanel.querySelector(".color-bg")?.getAttribute("style")?.match(/background-color:\s*([^;]+)/)?.[1]?.trim() || "",
    size: rows["大小"] || coerceStr(jsonLd.contentSize),
    format: coerceStr(jsonLd.encodingFormat || jsonLd.fileFormat),
    duration: coerceStr(jsonLd.duration),
    download_count: rows["下载量"] || "",
    favorite_count: rows["收藏量"] || "",
    published_at: rows["发布时间"] || "",
    // 保留 schema 1 的扁平字段，兼容既有模板 / provider；完整发布者信息放在 publisher。
    author: publisher.name,
    author_id: publisher.id,
    publisher,
  };

  const opts: KabegameDownloadImageOptions = { metadata, url: finalUrl };
  if (title) opts.name = title;
  const labels = labelsFromMetadata(metadata);
  if (labels.length > 0) opts.labels = labels;
  await downloadImage(downloadUrl, opts);
  return true;
}

export async function crawl(common: unknown, custom: unknown): Promise<void> {
  const cfg = isRecord(common) ? common : {};
  const vars = isRecord(custom) ? custom : {};
  const baseUrl = coerceStr(cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const startPage = Number(vars.startPage ?? 1);
  const endPageConfig = Number(vars.endPage ?? startPage);
  const wallpaperType = coerceStr(vars.wallpaperType || "homeView").trim();
  const formats = vars.formats || {};
  // 站点用「、」分隔多个搜索词，标签自身里的「、」会被拆开，这里预先按同样规则拆分去重。
  const rawTags: unknown[] = Array.isArray(vars.tags) ? vars.tags : [];
  const searchTags = Array.from(
    new Set(
      rawTags
        .flatMap((t) => coerceStr(t).split("、"))
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  );

  if (endPageConfig < startPage) throw new Error(t("endPageBeforeStart"));
  if (endPageConfig >= startPage + 100) {
    throw new Error(t("pageRangeTooLarge"));
  }
  if (!wantsFormat(formats, false) && !wantsFormat(formats, true)) {
    throw new Error(t("formatsRequired"));
  }
  const kind = kindOf(formats);

  console.log(
    t("crawlStarted", {
      wallpaperType,
      startPage,
      endPage: endPageConfig,
      tags: searchTags.join("、"),
      wpType: wpTypeOf(wallpaperType, kind) ?? t("defaultWpType"),
    }),
  );

  // 先开起始页拿总页数（搜索时为搜索结果的总页数），据此收窄结束页。
  let { finalUrl, root } = await openDocument(buildListUrl(baseUrl, wallpaperType, startPage, searchTags, kind));
  const totalPages = parseTotalPages(root);
  const endPage = Math.min(endPageConfig, totalPages);
  if (startPage > totalPages) {
    warn(t("startPageBeyondTotal", { startPage, totalPages }));
    addProgress(100.0);
    return;
  }

  const requestedPages = endPage - startPage + 1;
  const pctPerPage = requestedPages > 0 ? 100.0 / requestedPages : 0.0;
  console.log(t("totalPages", { totalPages, startPage, endPage }));

  for (let page = startPage; page <= endPage; page += 1) {
    if (page !== startPage) {
      ({ finalUrl, root } = await openDocument(buildListUrl(baseUrl, wallpaperType, page, searchTags, kind)));
    }

    const detailLinks = parseDetailLinks(root, finalUrl);
    console.log(t("pageItems", { page, endPage, count: detailLinks.length }));
    if (detailLinks.length === 0) {
      // 诊断：区分「查询根不对」和「页面确实没有条目」。
      warn(
        t("pageEmpty", {
          page,
          anchors: root.querySelectorAll("a").length,
          cards: root.querySelectorAll(".card").length,
          mobileCards: root.querySelectorAll("a.cardMobile").length,
        }),
      );
      addProgress(pctPerPage);
      continue;
    }

    const pctPerItem = pctPerPage / detailLinks.length;
    let downloaded = 0;
    for (const detailUrl of detailLinks) {
      try {
        if (await processDetailPage(detailUrl, formats)) downloaded += 1;
      } catch (e) {
        warn(t("detailFailed", { url: detailUrl, error: errorMessage(e) }));
      }
      addProgress(pctPerItem);
    }
    console.log(t("pageDone", { page, endPage, downloaded, total: detailLinks.length }));
  }

  console.log(t("crawlFinished"));
}

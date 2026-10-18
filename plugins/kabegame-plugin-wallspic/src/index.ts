import { t } from "./i18n";

const { addProgress, currentHtml, downloadImage, to } = Kabegame;

const DEFAULT_BASE_URL = "https://wallspic.com";

// 配置字段来自 GUI（可能有类型）或 CLI --var（一定是字符串），统一按 unknown 收窄
type WallspicVars = {
  mode?: unknown;
  tag?: unknown;
  album?: unknown;
  ranking?: unknown;
  resolution_mode?: unknown;
  resolution_group?: unknown;
  res_ultra_hd?: unknown;
  res_apple?: unknown;
  res_android?: unknown;
  res_widescreen?: unknown;
  start_page?: unknown;
  end_page?: unknown;
};

function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

function trim(value: unknown): string {
  return coerceStr(value).trim();
}

function parseHtml(html: unknown): Document {
  return new DOMParser().parseFromString(coerceStr(html), "text/html");
}

async function openDocument(url: string): Promise<{ finalUrl: string; document: Document }> {
  const finalUrl = await to(url);
  return { finalUrl, document: parseHtml(await currentHtml()) };
}

function textOf(el: Element | null | undefined): string {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function getResolutionSlug(vars: WallspicVars): string {
  if (vars.resolution_mode === "all") return "";
  if (vars.resolution_mode === "for_mobile") return "for_mobile";
  if (vars.resolution_mode === "for_desktop") return "for_desktop";
  if (vars.resolution_mode === "specific") {
    if (vars.resolution_group === "ultra_hd") return coerceStr(vars.res_ultra_hd);
    if (vars.resolution_group === "apple") return coerceStr(vars.res_apple);
    if (vars.resolution_group === "android") return coerceStr(vars.res_android);
    if (vars.resolution_group === "widescreen") return coerceStr(vars.res_widescreen);
  }
  return "";
}

function getBasePath(vars: WallspicVars, baseUrl: string): string {
  if (vars.mode === "tag") {
    const tag = trim(vars.tag);
    return tag ? `${baseUrl}/tag/${encodeURIComponent(tag)}` : baseUrl;
  }
  // 画册下拉被清空（null）或模式被清空导致画册隐藏（undefined）时按「全部」处理
  const album = coerceStr(vars.album) || "all";
  return album === "all" ? `${baseUrl}/album` : `${baseUrl}/album/${album}`;
}

function buildPageUrl(vars: WallspicVars, baseUrl: string, page: number): string {
  let url = getBasePath(vars, baseUrl);
  if (vars.ranking) url += `/${vars.ranking}`;
  const resSlug = getResolutionSlug(vars);
  if (resSlug) url += `/${resSlug}`;
  return `${url}?page=${page}`;
}

function maxPageFromInlineScript(scriptText: string): number {
  if (!scriptText.includes("mainGalleryTarget")) return 0;
  const match = scriptText.match(/"pages"\s*:\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function parseMaxPage(document: Document): number {
  const amount = textOf(document.querySelector(".pagination__amount"));
  const token = amount.split(/\s+/)[1];
  if (/^\d+$/.test(token || "")) return Number(token);

  for (const script of Array.from(
    document.querySelectorAll('main.layout-dynamic > script[type="text/javascript"]:not([src])'),
  )) {
    const n = maxPageFromInlineScript(script.textContent || "");
    if (n > 0) return n;
  }
  return 1;
}

function isImageUrl(url: unknown): boolean {
  return /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(coerceStr(url));
}

function collectContentUrlsFromScripts(document: Document): string[] {
  const urls: string[] = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    const text = script.textContent || "";
    if (!text.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== "object" || !("contentUrl" in item)) continue;
        const contentUrl = coerceStr(item.contentUrl);
        if (isImageUrl(contentUrl)) urls.push(contentUrl);
      }
    } catch {
      // Ignore non-JSON script content.
    }
  }
  return urls;
}

export async function crawl(common: unknown, custom: unknown): Promise<void> {
  const config = (common || {}) as { baseUrl?: string | null };
  const vars = (custom || {}) as WallspicVars;
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  if (endPage < startPage) throw new Error(t("endPageBeforeStart"));

  console.log(t("crawlStarted"));
  const startUrl = buildPageUrl(vars, baseUrl, startPage);
  console.log(t("openStartPage", { url: startUrl }));
  let { document } = await openDocument(startUrl);

  const maxPage = parseMaxPage(document);
  const actualEndPage = Math.min(endPage, maxPage);
  if (startPage > maxPage) throw new Error(t("startPageBeyondMax", { startPage, maxPage }));
  const totalPages = actualEndPage - startPage + 1;
  console.log(t("paginationSummary", { maxPage, endPage: actualEndPage, totalPages }));

  for (let page = startPage; page <= actualEndPage; page += 1) {
    const pageUrl = buildPageUrl(vars, baseUrl, page);
    if (page > startPage) {
      console.log(t("turningPage", { page, endPage: actualEndPage, url: pageUrl }));
      document = (await openDocument(pageUrl)).document;
    } else {
      console.log(t("processStartPage", { page, endPage: actualEndPage }));
    }

    const imageUrls = collectContentUrlsFromScripts(document);
    const pageProgress = totalPages > 0 ? 100.0 / totalPages : 0.0;
    const perImageProgress = imageUrls.length > 0 ? pageProgress / imageUrls.length : pageProgress;
    console.log(t("pageImages", { page, count: imageUrls.length }));

    for (const imageUrl of imageUrls) {
      await downloadImage(imageUrl, { url: pageUrl });
      addProgress(perImageProgress);
    }
    if (imageUrls.length === 0) addProgress(pageProgress);
  }

  console.log(t("crawlFinished"));
}

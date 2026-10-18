import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";
import { t } from "./i18n";

const { addProgress, currentHtml, downloadImage, to } = Kabegame;

const DEFAULT_BASE_URL = "https://wallpaperscraft.com";

// 配置字段来自 GUI（可能有类型）或 CLI --var（一定是字符串），统一按 unknown 收窄
type WallpaperVars = {
  mode?: unknown;
  category?: unknown;
  tag?: unknown;
  orderby?: unknown;
  res_type?: unknown;
  res_mobile?: unknown;
  res_apple?: unknown;
  res_fullscreen?: unknown;
  res_widescreen?: unknown;
  start_page?: unknown;
  end_page?: unknown;
};

// 输出侧 metadata 必须保持 JSON 可序列化，所以用 type 而非 interface（interface 不满足
// KabegameJsonValue 的索引签名）。
type WallpaperMetadata = {
  site_base: string;
  detail_url: string;
  wallpaper_title: string;
  author: string;
  license: string;
  source_url: string;
  rating: string;
  votes_total: string;
  original_resolution: string;
  original_download_url: string;
  views: string;
  uploaded: string;
};

// 宿主公共配置（运行时只读到 baseUrl）
type WallpaperCommon = {
  baseUrl?: unknown;
};

function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

function textOf(el: Element | null | undefined): string {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function parseHtml(html: unknown): Document {
  return new DOMParser().parseFromString(coerceStr(html), "text/html");
}

async function openDocument(url: string): Promise<{ finalUrl: string; document: Document }> {
  const finalUrl = await to(url);
  return { finalUrl, document: parseHtml(await currentHtml()) };
}

function resolveUrl(url: unknown, base: string): string {
  const raw = coerceStr(url).trim();
  return raw ? resolveSdkUrl(raw, base) : "";
}

function getSelectedRes(vars: WallpaperVars): string {
  if (vars.res_type === "none") return "";
  if (vars.res_type === "mobile") return coerceStr(vars.res_mobile);
  if (vars.res_type === "apple") return coerceStr(vars.res_apple);
  if (vars.res_type === "fullscreen") return coerceStr(vars.res_fullscreen);
  if (vars.res_type === "widescreen") return coerceStr(vars.res_widescreen);
  return "";
}

function buildPageUrl(vars: WallpaperVars, baseUrl: string, page: number, selectedRes: string): string {
  // 下拉被清空（null）或随模式隐藏（undefined）时回落到清单默认值，避免把 null/undefined 拼进 URL
  const mode = vars.mode ?? "catalog";
  const category = coerceStr(vars.category) || "anime";
  const orderby = coerceStr(vars.orderby) || "default";
  const basePath = mode === "tag"
    ? (coerceStr(vars.tag).trim()
      ? `${baseUrl}/tag/${encodeURIComponent(coerceStr(vars.tag).trim())}`
      : `${baseUrl}/all`)
    : `${baseUrl}/catalog/${category}`;
  const sortPath = orderby === "default" ? "" : `/${orderby}`;
  const resPath = selectedRes ? `/${selectedRes}` : "";
  return `${basePath}${sortPath}${resPath}/page${page}`;
}

function getMaxPage(document: Document): number {
  const href = document.querySelector("li.pager__item:last-of-type > a")?.getAttribute("href") || "";
  const match = href.match(/(?:^|\/)page(\d+)(?:[/?#]|$)/);
  return match ? Number(match[1]) : 1;
}

function infoTextForThumb(infoTexts: string[], idx: number): string {
  const metaIndex = idx * 2;
  if (metaIndex < infoTexts.length) return infoTexts[metaIndex];
  return idx < infoTexts.length ? infoTexts[idx] : "";
}

function extractRes(infoText: unknown): string {
  return coerceStr(infoText).match(/\b\d+x\d+\b/)?.[0] || "";
}

function makeFullUrl(thumbUrl: unknown, res: string): string {
  return coerceStr(thumbUrl).replace(/_\d+x\d+/, `_${res}`);
}

function displayNameFromWallpaperTitle(titleRaw: unknown): string {
  const title = coerceStr(titleRaw).trim();
  return title.startsWith("Wallpaper ") ? title.slice(10).trim() : title;
}

function detailItemTextMap(document: Document): Record<string, string> {
  const out: Record<string, string> = {};
  const cells = Array.from(document.querySelectorAll(".wallpaper-table .wallpaper-table__cell"))
    .map(textOf);
  for (let i = 0; i + 1 < cells.length; i += 2) {
    out[cells[i]] = cells[i + 1];
  }
  return out;
}

function fetchDetailMetadata(document: Document, detailUrl: string, baseUrl: string): WallpaperMetadata {
  const title = textOf(document.querySelector(".content-main h1.gui-heading"));
  let author = "";
  let license = "";
  for (const row of Array.from(document.querySelectorAll(".author .author__row"))) {
    const text = textOf(row);
    if (text.startsWith("Author:")) author = text.slice(7).trim();
    if (text.startsWith("License:")) license = text.slice(8).trim();
  }

  const sourceHref = document.querySelector(".author__block_source a.author__link")?.getAttribute("href") || "";
  const table = detailItemTextMap(document);
  const originalDownloadHref = document.querySelector(".wallpaper-table a[href*='/download/']")?.getAttribute("href") || "";

  return {
    site_base: baseUrl,
    detail_url: detailUrl,
    wallpaper_title: title,
    author,
    license,
    source_url: resolveUrl(sourceHref, detailUrl),
    rating: textOf(document.querySelector(".wallpaper-votes__rate")),
    votes_total: textOf(document.querySelector(".JS-Vote-Total")),
    original_resolution: table["Original Resolution"] || "",
    original_download_url: resolveUrl(originalDownloadHref, detailUrl),
    views: table.Views || "",
    uploaded: table.Uploaded || "",
  };
}

async function downloadWithDetail(fullUrl: string, detailRel: string, pageUrl: string, baseUrl: string): Promise<void> {
  const detailAbs = resolveUrl(detailRel, pageUrl);
  if (!detailAbs) {
    await downloadImage(fullUrl);
    return;
  }

  const { document } = await openDocument(detailAbs);
  const metadata = fetchDetailMetadata(document, detailAbs, baseUrl);
  const name = displayNameFromWallpaperTitle(metadata.wallpaper_title);
  const opts: KabegameDownloadImageOptions = { metadata, url: detailAbs };
  if (name) opts.name = name;
  await downloadImage(fullUrl, opts);
}

export async function crawl(
  common: unknown,
  custom: Record<string, unknown> | null | undefined,
): Promise<void> {
  const vars = (custom || {}) as WallpaperVars;
  const cfg = (common || {}) as WallpaperCommon;
  const baseUrl = coerceStr(cfg.baseUrl) || DEFAULT_BASE_URL;
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  if (endPage < startPage) throw new Error(t("endPageBeforeStart"));

  const selectedRes = getSelectedRes(vars);
  console.log(t("crawlStarted"));
  const startUrl = buildPageUrl(vars, baseUrl, startPage, selectedRes);
  let { document } = await openDocument(startUrl);

  const maxPage = getMaxPage(document);
  const actualEndPage = Math.min(endPage, maxPage);
  if (startPage > maxPage) throw new Error(t("startPageBeyondMax", { startPage, maxPage }));
  const totalPages = actualEndPage - startPage + 1;

  for (let page = startPage; page <= actualEndPage; page += 1) {
    const pageUrl = buildPageUrl(vars, baseUrl, page, selectedRes);
    if (page > startPage) {
      console.log(t("turningPage", { page, endPage: actualEndPage, url: pageUrl }));
      document = (await openDocument(pageUrl)).document;
    }

    const thumbnailSrcs = Array.from(document.querySelectorAll(".wallpapers__link img"))
      .map((img) => img.getAttribute("src") || "")
      .filter(Boolean);
    const detailHrefs = Array.from(document.querySelectorAll(".wallpapers__link"))
      .map((a) => a.getAttribute("href") || "");
    const infoTexts = Array.from(document.querySelectorAll(".wallpapers__link .wallpapers__info"))
      .map(textOf);
    const pageProgress = totalPages > 0 ? 100.0 / totalPages : 0.0;
    const perImageProgress = thumbnailSrcs.length > 0 ? pageProgress / thumbnailSrcs.length : pageProgress;

    console.log(t("pageImages", { page, count: thumbnailSrcs.length }));
    for (let idx = 0; idx < thumbnailSrcs.length; idx += 1) {
      const finalRes = selectedRes || extractRes(infoTextForThumb(infoTexts, idx));
      if (finalRes) {
        const fullUrl = makeFullUrl(thumbnailSrcs[idx], finalRes);
        await downloadWithDetail(fullUrl, detailHrefs[idx] || "", pageUrl, baseUrl);
      }
      addProgress(perImageProgress);
    }
    if (thumbnailSrcs.length === 0) addProgress(pageProgress);
  }

  console.log(t("crawlFinished"));
}

// @ts-nocheck
const { addProgress, currentHtml, downloadImage, to } = Kabegame;

const DEFAULT_BASE_URL = "https://wallspic.com";

function coerceStr(value) {
  return value == null ? "" : String(value);
}

function trim(value) {
  return coerceStr(value).trim();
}

function parseHtml(html) {
  return new DOMParser().parseFromString(coerceStr(html), "text/html");
}

async function openDocument(url) {
  const finalUrl = await to(url);
  return { finalUrl, document: parseHtml(await currentHtml()) };
}

function textOf(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function getResolutionSlug(vars) {
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

function getBasePath(vars, baseUrl) {
  if (vars.mode === "tag") {
    const tag = trim(vars.tag);
    return tag ? `${baseUrl}/tag/${encodeURIComponent(tag)}` : baseUrl;
  }
  return vars.album === "all" ? `${baseUrl}/album` : `${baseUrl}/album/${vars.album}`;
}

function buildPageUrl(vars, baseUrl, page) {
  let url = getBasePath(vars, baseUrl);
  if (vars.ranking) url += `/${vars.ranking}`;
  const resSlug = getResolutionSlug(vars);
  if (resSlug) url += `/${resSlug}`;
  return `${url}?page=${page}`;
}

function maxPageFromInlineScript(scriptText) {
  if (!scriptText.includes("mainGalleryTarget")) return 0;
  const match = scriptText.match(/"pages"\s*:\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function parseMaxPage(document) {
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

function isImageUrl(url) {
  return /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(coerceStr(url));
}

function collectContentUrlsFromScripts(document) {
  const urls = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    const text = script.textContent || "";
    if (!text.trim()) continue;
    try {
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const contentUrl = coerceStr(item?.contentUrl);
        if (isImageUrl(contentUrl)) urls.push(contentUrl);
      }
    } catch {
      // Ignore non-JSON script content.
    }
  }
  return urls;
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = common?.baseUrl || DEFAULT_BASE_URL;
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  if (endPage < startPage) throw new Error("结束页数需要大于或等于起始页数");

  console.log("[wallspic] 开始爬取");
  const startUrl = buildPageUrl(vars, baseUrl, startPage);
  console.log(`打开起始页: ${startUrl}`);
  let { document } = await openDocument(startUrl);

  const maxPage = parseMaxPage(document);
  const actualEndPage = Math.min(endPage, maxPage);
  if (startPage > maxPage) throw new Error(`起始页 ${startPage} 超出网站最大页 ${maxPage}`);
  const totalPages = actualEndPage - startPage + 1;
  console.log(`站点分页上限: ${maxPage}，实际结束页: ${actualEndPage}，本任务共 ${totalPages} 页`);

  for (let page = startPage; page <= actualEndPage; page += 1) {
    const pageUrl = buildPageUrl(vars, baseUrl, page);
    if (page > startPage) {
      console.log(`翻页: ${page}/${actualEndPage} -> ${pageUrl}`);
      document = (await openDocument(pageUrl)).document;
    } else {
      console.log(`处理第 ${page}/${actualEndPage} 页（已在起始页）`);
    }

    const imageUrls = collectContentUrlsFromScripts(document);
    const pageProgress = totalPages > 0 ? 100.0 / totalPages : 0.0;
    const perImageProgress = imageUrls.length > 0 ? pageProgress / imageUrls.length : pageProgress;
    console.log(`第 ${page} 页: 解析到 ${imageUrls.length} 个图片地址，开始下载`);

    for (const imageUrl of imageUrls) {
      await downloadImage(imageUrl, { url: pageUrl });
      addProgress(perImageProgress);
    }
    if (imageUrls.length === 0) addProgress(pageProgress);
  }

  console.log("[wallspic] 爬取结束");
}

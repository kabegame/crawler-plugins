// @ts-nocheck
import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";
import { WORKS } from "./works";

const {
  addProgress,
  createImageMetadata,
  currentHtml,
  downloadImage,
  to,
} = Kabegame;

const DEFAULT_BASE_URL = "https://anihonetwallpaper.com";
const ROW_IDS = ["a", "ka", "sa", "ta", "na", "ha", "ma", "ya", "ra", "wa"];

function coerceStr(value) {
  return value == null ? "" : String(value);
}

function textOf(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
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

function isImageUrl(url) {
  return /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(coerceStr(url));
}

function sourcePostId(detailUrl) {
  const parts = coerceStr(detailUrl).split(/[?#]/, 1)[0].split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return /^\d+$/.test(last) ? last : "";
}

function tagCopy(anchor, baseUrl) {
  return {
    name: textOf(anchor),
    href: resolveUrl(anchor.getAttribute("href"), baseUrl),
  };
}

function isWorkLabel(label) {
  if (!label.includes("壁紙")) return false;
  return WORKS.some((work) => label.includes(work));
}

// 与 metadata_migrations/migrate.js 的分类规则保持一致（schema 4）：
// 作品(命中作品列表且含壁紙) → work；PC壁紙/Android/iPhone/スマホ → type；
// 高品質画像・アニメの高画質壁紙 → quality；其余含壁紙 → type；其他 → character。
function classifyTags(tags) {
  const qualityTags = [];
  const workTags = [];
  const characterTags = [];
  const typeTags = [];
  for (const tag of tags) {
    const label = coerceStr(tag.name || tag.href).trim();
    if (!label) continue;
    if (isWorkLabel(label)) workTags.push(tag);
    else if (/PC壁紙|Android|iPhone|スマホ/.test(label)) typeTags.push(tag);
    else if (label.includes("高品質画像") || label.includes("アニメの高画質壁紙")) qualityTags.push(tag);
    else if (label.includes("壁紙")) typeTags.push(tag);
    else characterTags.push(tag);
  }
  return { qualityTags, workTags, characterTags, typeTags };
}

function parseMetadata(document, detailUrl) {
  const tags = Array.from(document.querySelectorAll("span.tagst a[href]"))
    .map((a) => tagCopy(a, detailUrl));
  const groups = classifyTags(tags);
  return {
    schema: 4,
    post_id: sourcePostId(detailUrl),
    date: coerceStr(document.querySelector("time.entry-date")?.getAttribute("datetime")),
    tags,
    qualityTags: groups.qualityTags,
    workTags: groups.workTags,
    characterTags: groups.characterTags,
    typeTags: groups.typeTags,
  };
}

function cleanName(raw) {
  return coerceStr(raw)
    .replace(/\([^)]*(?:画像サイズ|サイズ|最大長辺)[^)]*\)/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .replace(/^(縮小画像|画像をダウンロード)$/u, "");
}

function nameFromImageUrl(href, baseUrl) {
  const full = resolveUrl(href, baseUrl);
  const file = full.split(/[?#]/, 1)[0].split("/").pop() || "";
  return file.replace(/\.(?:jpe?g|png|webp|gif)$/i, "").trim();
}

function collectCleanNames(values) {
  return values.map(cleanName).filter(Boolean);
}

function parseNames(document, expectedCount) {
  const h3Names = Array.from(document.querySelectorAll(".post h3, article h3"))
    .map(textOf)
    .filter(Boolean);
  if (expectedCount > 0 && h3Names.length === expectedCount) return h3Names;

  for (const attr of ["title", "alt"]) {
    const names = collectCleanNames(
      Array.from(document.querySelectorAll(".post-img img.size-full, .wp-img img.size-full, .wp-img-pc img.size-full, .pc-post img.size-full, .android-post img.size-full"))
        .map((img) => img.getAttribute(attr) || ""),
    );
    if (names.length > 0) return names;
  }

  return collectCleanNames(
    Array.from(document.querySelectorAll("p.wp-img3.clearfix.center"))
      .map(textOf)
      .filter((text) =>
        /画像サイズ|サイズ[:：]/.test(text) &&
        !/最大長辺|比率のスマホ用/.test(text),
      ),
  );
}

function nameHasImageIndex(name, index) {
  return coerceStr(name).includes(`【${index}】`) || coerceStr(name).includes(`${index}枚目`);
}

function buildDownloadOpts(baseName, index, total, metadataId, detailUrl) {
  let name = coerceStr(baseName).trim();
  if (total > 1) {
    if (name && nameHasImageIndex(name, index)) {
      // keep site title
    } else if (name) {
      name = `${name}(${index})`;
    } else {
      name = `(${index})`;
    }
  }
  const opts = { metadata_id: metadataId, url: detailUrl };
  if (name) opts.name = name;
  return opts;
}

async function processDownloadHref(href, progressSlice, opts, baseUrl) {
  const fullImage = resolveUrl(href, baseUrl);
  if (!fullImage || /resize/i.test(fullImage) || !isImageUrl(fullImage)) {
    if (progressSlice > 0.0) addProgress(progressSlice);
    return;
  }
  await downloadImage(fullImage, opts);
  if (progressSlice > 0.0) addProgress(progressSlice);
}

async function processDetailPage(href, workPctBudget, workIdx, workTotal, baseUrl) {
  const full = resolveUrl(href, baseUrl);
  console.log(`[anihonet]   进入详情页 ${workIdx}/${workTotal}: ${full}`);
  const { document, finalUrl } = await openDocument(full);
  const metadata = parseMetadata(document, finalUrl);
  const metadataId = Number(createImageMetadata(metadata));
  let downloadHrefs = Array.from(document.querySelectorAll("a.button.add-dl"))
    .map((a) => a.getAttribute("href") || "")
    .filter(Boolean);
  if (downloadHrefs.length === 0) {
    downloadHrefs = Array.from(document.querySelectorAll("a.button:not(.add), .wp-img-pc > a, .wp-img > a"))
      .map((a) => a.getAttribute("href") || "")
      .filter(Boolean);
  }

  const names = parseNames(document, downloadHrefs.length);
  const perImage = downloadHrefs.length > 0 ? workPctBudget / downloadHrefs.length : 0.0;
  if (downloadHrefs.length === 0 && workPctBudget > 0.0) addProgress(workPctBudget);
  for (let index = 0; index < downloadHrefs.length; index += 1) {
    const baseName = names[index] || nameFromImageUrl(downloadHrefs[index], finalUrl);
    const opts = buildDownloadOpts(baseName, index + 1, downloadHrefs.length, metadataId, finalUrl);
    await processDownloadHref(downloadHrefs[index], perImage, opts, finalUrl);
  }
}

function collectDetailPageHrefs(document, pageUrl) {
  return Array.from(document.querySelectorAll(".itiran:last-of-type > a[href]"))
    .map((a) => resolveUrl(a.getAttribute("href"), pageUrl))
    .filter(Boolean);
}

function parseListPageTotalPages(document) {
  const text = textOf(document.querySelector(".post_box2 .center"));
  const match = text.match(/\d+\s*\/\s*(\d+)/);
  const n = match ? Number(match[1]) : 1;
  return n > 0 ? n : 1;
}

async function crawlAnimeSeries(seriesHref, themePctBudget, rowId, idxInRow, totalInRow, userStart, userEnd, baseUrl) {
  const full = resolveUrl(seriesHref, baseUrl);
  console.log(`[anihonet] 进入作品列表页 行=${rowId} 第${idxInRow}/${totalInRow} 个分类: ${full}`);
  let { document, finalUrl } = await openDocument(full);
  const listTotalPages = parseListPageTotalPages(document);
  let start = Math.max(1, Number(userStart || 1));
  let end = Number(userEnd || 0);
  const rangeMode = end > 0;
  if (rangeMode && start > end) [start, end] = [end, start];
  const pageSpan = Math.max(1, rangeMode ? end - start + 1 : listTotalPages);
  const pctPerListPage = themePctBudget / pageSpan;
  let pageIdx = 1;
  let completed = 0;

  while (true) {
    if (rangeMode && pageIdx > end) break;
    const shouldProcess = !rangeMode || (pageIdx >= start && pageIdx <= end);
    if (shouldProcess) {
      const detailHrefs = collectDetailPageHrefs(document, finalUrl);
      if (detailHrefs.length === 0) {
        addProgress(pctPerListPage);
      } else {
        const workPct = pctPerListPage / detailHrefs.length;
        for (let idx = 0; idx < detailHrefs.length; idx += 1) {
          await processDetailPage(detailHrefs[idx], workPct, idx + 1, detailHrefs.length, finalUrl);
        }
      }
      completed += 1;
    }
    if (rangeMode && pageIdx >= end) break;
    const nextHref = document.querySelector(".post_box2 .p-next a")?.getAttribute("href") || "";
    if (!nextHref) break;
    const nextFull = resolveUrl(nextHref, finalUrl);
    ({ document, finalUrl } = await openDocument(nextFull));
    pageIdx += 1;
  }

  const used = pctPerListPage * (rangeMode ? completed : pageIdx);
  const remainder = themePctBudget - used;
  if (remainder > 0.0001) addProgress(remainder);
}

function h3SectionLinks(document, rowId, pageUrl) {
  const h3 = document.getElementById(rowId);
  if (!h3) return [];
  const links = [];
  let node = h3.nextElementSibling;
  while (node && !(node.tagName === "H3" && ROW_IDS.includes(node.id)) && node.id !== "side") {
    links.push(...Array.from(node.querySelectorAll?.("a[href]") || []));
    node = node.nextElementSibling;
  }
  return links
    .map((a) => resolveUrl(a.getAttribute("href"), pageUrl))
    .filter((href) => href && href !== "#");
}

async function crawlAnimeGameIndex(rows, baseUrl) {
  const indexUrl = `${baseUrl}/anime-game-wallpaper`;
  const { document, finalUrl } = await openDocument(indexUrl);
  const selectedRows = ROW_IDS.filter((id) => rows?.[id] === true);
  const rowLinks = selectedRows.map((id) => ({ id, links: h3SectionLinks(document, id, finalUrl) }));
  const totalSeries = rowLinks.reduce((sum, row) => sum + row.links.length, 0);
  if (totalSeries === 0) return;
  const pctPerTheme = 100.0 / totalSeries;
  for (const row of rowLinks) {
    for (let idx = 0; idx < row.links.length; idx += 1) {
      await crawlAnimeSeries(row.links[idx], pctPerTheme, row.id, idx + 1, row.links.length, 1, 0, finalUrl);
    }
  }
}

function rankingListSlug(period, category) {
  const slugCategory = category === "img-pc" ? "imgpc" : category;
  return slugCategory === "all" ? `ranking-${period}` : `ranking-${period}-${slugCategory}`;
}

async function crawlKind(kind, startPage, endPage, period, baseUrl) {
  const totalPages = endPage - startPage + 1;
  const pctPerPage = totalPages > 0 ? 100.0 / totalPages : 0.0;
  const slug = rankingListSlug(period, kind);
  for (let page = startPage; page <= endPage; page += 1) {
    const pageUrl = page === 1 ? `${baseUrl}/${slug}` : `${baseUrl}/${slug}/${page}`;
    const { document, finalUrl } = await openDocument(pageUrl);
    const hrefs = Array.from(document.querySelectorAll("article .ranking-frame a[href]"))
      .map((a) => resolveUrl(a.getAttribute("href"), finalUrl))
      .filter(Boolean);
    if (hrefs.length === 0) {
      addProgress(pctPerPage);
      continue;
    }
    const pctPerItem = pctPerPage / hrefs.length;
    for (let idx = 0; idx < hrefs.length; idx += 1) {
      await processDetailPage(hrefs[idx], pctPerItem, idx + 1, hrefs.length, finalUrl);
    }
  }
}

function findThemeListHref(document, themeQuery, pageUrl) {
  const q = coerceStr(themeQuery).trim();
  if (!q) return "";
  for (const anchor of Array.from(document.querySelectorAll("div.post-list li > a[href], div.post-list a[href]"))) {
    if (textOf(anchor).includes(q)) return resolveUrl(anchor.getAttribute("href"), pageUrl);
  }
  return "";
}

async function crawlThemeFromIndex(themeQuery, pageStart, pageEnd, baseUrl) {
  const indexUrl = `${baseUrl}/anime-game-wallpaper`;
  const { document, finalUrl } = await openDocument(indexUrl);
  const href = findThemeListHref(document, themeQuery, finalUrl);
  if (!href) {
    addProgress(100.0);
    return;
  }
  await crawlAnimeSeries(href, 100.0, "theme", 1, 1, pageStart, pageEnd, finalUrl);
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = common?.baseUrl || DEFAULT_BASE_URL;
  const type = vars.wallpaper_type === "img-pc" ? "imgpc" : coerceStr(vars.wallpaper_type || "all");
  if (!["all", "sp", "image", "imgpc", "pc"].includes(type)) {
    console.log("错误：wallpaper_type 必须是 all/sp/image/imgpc/pc");
    return;
  }

  if (vars.crawl_mode === "single_work") {
    const workSlug = coerceStr(vars.selected_work);
    if (!workSlug) {
      addProgress(100.0);
      return;
    }
    await crawlAnimeSeries(`${baseUrl}/${workSlug}`, 100.0, "single", 1, 1, 1, 0, baseUrl);
  } else if (vars.crawl_mode === "by_theme") {
    await crawlThemeFromIndex(vars.theme_search, Number(vars.theme_start_page ?? 1), Number(vars.theme_end_page ?? 1), baseUrl);
  } else if (vars.crawl_mode === "index") {
    await crawlAnimeGameIndex(vars.rows || vars.index_rows || {}, baseUrl);
  } else if (vars.crawl_mode === "ranking") {
    await crawlKind(type, Number(vars.start_page ?? 1), Number(vars.end_page ?? 1), coerceStr(vars.ranking_period || "daily"), baseUrl);
  } else {
    console.log("错误：crawl_mode 必须是 ranking、single_work 或 by_theme");
  }
}

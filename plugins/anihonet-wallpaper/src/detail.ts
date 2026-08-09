// @ts-nocheck
// 详情页图片命名、过滤、metadata 创建与下载。
import { parseMetadata } from "./metadata";
import { coerceStr, isImageUrl, openDocument, resolveUrl, textOf } from "./runtime";

const { addProgress, createImageMetadata, downloadImage } = Kabegame;

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
      Array.from(
        document.querySelectorAll(
          ".post-img img.size-full, .wp-img img.size-full, .wp-img-pc img.size-full, .pc-post img.size-full, .android-post img.size-full",
        ),
      ).map((img) => img.getAttribute(attr) || ""),
    );
    if (names.length > 0) return names;
  }

  return collectCleanNames(
    Array.from(document.querySelectorAll("p.wp-img3.clearfix.center"))
      .map(textOf)
      .filter((text) =>
        /画像サイズ|サイズ[:：]/.test(text) &&
        !/最大長辺|比率のスマホ用/.test(text)
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
      // 保留站点原始标题。
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

export async function processDetailPage(href, workPctBudget, workIdx, workTotal, baseUrl) {
  const full = resolveUrl(href, baseUrl);
  console.log(`[anihonet]   进入详情页 ${workIdx}/${workTotal}: ${full}`);
  const { document, finalUrl } = await openDocument(full);
  const metadata = parseMetadata(document, finalUrl);
  const metadataId = Number(createImageMetadata(metadata));
  let downloadHrefs = Array.from(document.querySelectorAll("a.button.add-dl"))
    .map((anchor) => anchor.getAttribute("href") || "")
    .filter(Boolean);
  if (downloadHrefs.length === 0) {
    downloadHrefs = Array.from(
      document.querySelectorAll("a.button:not(.add), .wp-img-pc > a, .wp-img > a"),
    )
      .map((anchor) => anchor.getAttribute("href") || "")
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

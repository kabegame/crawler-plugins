// @ts-nocheck
// PixAI 作品标签：tack 使用归一化后的 codeName（无法派生时退回稳定 id），作者使用用户 id。

import { arrayValue, coerceStr } from "./util";

function labelKey(value) {
  const key = coerceStr(value)
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

function tackLabel(tack) {
  const fallbackId = labelKey(tack?.id);
  const key = labelKey(tack?.codeName) || fallbackId;
  if (!key) return null;
  const name =
    coerceStr(tack?.displayName).trim() ||
    coerceStr(tack?.defaultName).trim() ||
    coerceStr(tack?.codeName).trim() ||
    key;
  return { key, category: "pixai/tag", name };
}

function artistLabel(detail) {
  const author = detail?.author;
  const key = labelKey(author?.id) || labelKey(detail?.authorId);
  if (!key) return null;
  const name = coerceStr(author?.displayName).trim() || coerceStr(author?.username).trim() || key;
  return { key, category: "pixai/artist", name };
}

export function labelsFromArtworkDetail(detail) {
  const labels = [];
  const seen = new Set();
  for (const tack of arrayValue(detail?.tacks)) {
    const label = tackLabel(tack);
    if (!label) continue;
    const identity = `${label.category}/${label.key}`.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    labels.push(label);
  }

  const artist = artistLabel(detail);
  if (artist) labels.push(artist);
  return labels;
}

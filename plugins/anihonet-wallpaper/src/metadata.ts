// @ts-nocheck
// 详情页 metadata 解析与标签分类。
import { WORKS } from "./works";
import { coerceStr, resolveUrl, textOf } from "./runtime";

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

export function parseMetadata(document, detailUrl) {
  const tags = Array.from(document.querySelectorAll("span.tagst a[href]"))
    .map((anchor) => tagCopy(anchor, detailUrl));
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

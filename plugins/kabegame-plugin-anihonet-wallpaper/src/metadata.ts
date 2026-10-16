// @ts-nocheck
// 详情页 metadata 解析与原站 taxonomy 分类。
import { coerceStr, resolveUrl, textOf } from "./runtime";

function sourcePostId(detailUrl) {
  const parts = coerceStr(detailUrl).split(/[?#]/, 1)[0].split("/").filter(
    Boolean,
  );
  const last = parts[parts.length - 1] || "";
  return /^\d+$/.test(last) ? last : "";
}

function tagCopy(anchor, baseUrl) {
  const rel = coerceStr(anchor.getAttribute("rel"))
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  return {
    name: textOf(anchor),
    href: resolveUrl(anchor.getAttribute("href"), baseUrl),
    rel,
  };
}

function relTokens(anchor) {
  return coerceStr(anchor.getAttribute("rel"))
    .split(/\s+/)
    .filter(Boolean);
}

export function parseMetadata(document, detailUrl) {
  const categories = [];
  const tags = [];
  for (const anchor of document.querySelectorAll("span.tagst a[href]")) {
    const rel = relTokens(anchor);
    if (rel.includes("category")) categories.push(tagCopy(anchor, detailUrl));
    else if (rel.includes("tag")) tags.push(tagCopy(anchor, detailUrl));
  }
  return {
    schema: 5,
    post_id: sourcePostId(detailUrl),
    date: coerceStr(
      document.querySelector("time.entry-date")?.getAttribute("datetime"),
    ),
    categories,
    tags,
  };
}

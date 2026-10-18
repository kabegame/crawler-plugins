// 详情页 metadata 解析与原站 taxonomy 分类。
import { coerceStr, resolveUrl, textOf } from "./runtime";

// metadata 要能赋给 KabegameJsonValue，所以用 type 而非 interface（interface 没有隐式索引签名）。
type AnihonetTagCopy = {
  name: string;
  href: string;
  rel: string;
};

export type AnihonetMetadata = {
  schema: number;
  post_id: string;
  date: string;
  categories: AnihonetTagCopy[];
  tags: AnihonetTagCopy[];
};

function sourcePostId(detailUrl: unknown): string {
  const parts = coerceStr(detailUrl).split(/[?#]/, 1)[0].split("/").filter(
    Boolean,
  );
  const last = parts[parts.length - 1] || "";
  return /^\d+$/.test(last) ? last : "";
}

function tagCopy(anchor: Element, baseUrl: string): AnihonetTagCopy {
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

function relTokens(anchor: Element): string[] {
  return coerceStr(anchor.getAttribute("rel"))
    .split(/\s+/)
    .filter(Boolean);
}

export function parseMetadata(document: Document, detailUrl: string): AnihonetMetadata {
  const categories: AnihonetTagCopy[] = [];
  const tags: AnihonetTagCopy[] = [];
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

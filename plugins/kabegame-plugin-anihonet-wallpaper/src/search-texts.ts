// 元数据搜索片段覆盖 description.ejs 展示给用户的原文。
// metadata_migrations/migrate.js 有一份同规则副本，修改时必须同步。
import type { AnihonetMetadata } from "./metadata";

function trim(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function displayDate(value: unknown): string {
  const raw = trim(value);
  return raw.includes("T") ? raw.split("T", 1)[0] : raw;
}

// 条目可能是 { name } 对象，也可能缺失；非对象按空名处理（与原实现一致）。
function nameOf(value: unknown): string {
  return value && typeof value === "object" && "name" in value ? trim(value.name) : "";
}

function prefixedNames(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((item: unknown) => nameOf(item)).filter(Boolean).map((name) => `#${name}`);
}

export function searchTextsFromMetadata(metadata: AnihonetMetadata): string[] {
  const m = metadata || {};
  const out = ["anihonet"];
  const postId = trim(m.post_id);
  const field = (label: string, values: unknown[]) => {
    const list = values.map(trim).filter(Boolean);
    if (list.length > 0) out.push(label, ...list);
  };

  field("投稿日", [displayDate(m.date)]);
  field("源帖", [postId ? `#${postId}` : ""]);
  field("目录", prefixedNames(m.categories));
  field("标签", prefixedNames(m.tags));
  return [...new Set(out)];
}

// 元数据搜索片段只保留详情模板中的可见语义，不收录 JSON 键名、URL、计数或标注者。
// metadata_migrations/migrate.js 有一份同规则副本，修改时必须同步。

// 只声明搜索片段实际读取的字段：详情 metadata 的其余部分（URL、计数、标注者等）不参与。
// 输出侧要能赋给 KabegameJsonValue，所以统一用 type 而非 interface。
type SearchTextTag = {
  name?: unknown;
};

type SearchTextTagGroup = {
  name?: unknown;
  tags?: SearchTextTag[];
};

type SearchTextRating = {
  label?: unknown;
  count?: unknown;
};

type SearchTextMetadata = {
  tagGroups?: SearchTextTagGroup[] | null;
  rating?: SearchTextRating | null;
};

function trim(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function groupMarker(name: unknown): string {
  const value = trim(name).toLowerCase();
  // 搜索词按约定保留 `anthor` 这一词面。
  return value === "author" ? "anthor" : value;
}

export function searchTextsFromMetadata(
  metadata: SearchTextMetadata | null | undefined,
): string[] {
  const m: SearchTextMetadata = metadata || {};
  const groups = Array.isArray(m.tagGroups) ? m.tagGroups : [];
  const out = ["anime-picture", "anime", "picture"];

  for (const group of groups) {
    const marker = groupMarker(group?.name);
    if (marker) out.push(marker);
  }
  if (m.rating?.label || m.rating?.count) out.push("votes");

  for (const group of groups) {
    if (!Array.isArray(group?.tags)) continue;
    for (const tag of group.tags) {
      const name = trim(tag?.name);
      if (name) out.push(name);
    }
  }

  return [...new Set(out)];
}

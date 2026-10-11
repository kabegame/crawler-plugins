// @ts-nocheck
// 元数据搜索片段只保留详情模板中的可见语义，不收录 JSON 键名、URL、计数或标注者。
// metadata_migrations/migrate.js 有一份同规则副本，修改时必须同步。

function trim(value) {
  return value == null ? "" : String(value).trim();
}

function groupMarker(name) {
  const value = trim(name).toLowerCase();
  // 搜索词按约定保留 `anthor` 这一词面。
  return value === "author" ? "anthor" : value;
}

export function searchTextsFromMetadata(metadata) {
  const m = metadata || {};
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

// @ts-nocheck
// 元数据搜索片段覆盖 description.ejs 展示给用户的原文。
// metadata_migrations/migrate.js 有一份同规则副本，修改时必须同步。

function trim(value) {
  return value == null ? "" : String(value).trim();
}

function displayDate(value) {
  const raw = trim(value);
  return raw.includes("T") ? raw.split("T", 1)[0] : raw;
}

function prefixedNames(values) {
  if (!Array.isArray(values)) return [];
  return values.map((item) => trim(item?.name)).filter(Boolean).map((name) => `#${name}`);
}

export function searchTextsFromMetadata(metadata) {
  const m = metadata || {};
  const out = ["anihonet"];
  const postId = trim(m.post_id);
  const field = (label, values) => {
    const list = values.map(trim).filter(Boolean);
    if (list.length > 0) out.push(label, ...list);
  };

  field("投稿日", [displayDate(m.date)]);
  field("源帖", [postId ? `#${postId}` : ""]);
  field("目录", prefixedNames(m.categories));
  field("标签", prefixedNames(m.tags));
  return [...new Set(out)];
}

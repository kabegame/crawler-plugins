// yande.re metadata 迁移脚本：提供 provideLabels 与 provideSearchTextList，给历史图片补标签和搜索片段，
// 不改写 metadata。规则与 src/index.ts 的 labelsFromSidebarTags / searchTextsFromMetadata 一致
// （此处无法 import，保持两份同步）。

function tagLabelType(type) {
  const value = String(type || "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(value) ? value : "general";
}

function tagLabelKey(name) {
  const key = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

export function provideLabels(input) {
  const m = JSON.parse(input);
  const labels = [];
  for (const tag of (m && m.sidebar_tags) || []) {
    const key = tagLabelKey(tag && tag.name);
    if (!key) continue;
    const display = String((tag && tag.display) || "").replace(/\s+/g, " ").trim();
    labels.push({
      key,
      category: `yandere/${tagLabelType(tag.type)}`,
      name: display || key.replace(/_/g, " "),
    });
  }
  return labels;
}

// 元数据搜索片段："yandere"、有标签时写 "tags"、作品 ID、每个标签（侧栏显示名与站点标识各一条，
// 如 "hatsune miku" / "hatsune_miku"）、rating、上传者名称、喜欢者昵称、评论者名称、评论内容。
// 规则在 src/index.ts 与 metadata_migrations/migrate.js 各有一份，改一处要同步改另一处。
export function provideSearchTextList(input) {
  const meta = JSON.parse(input);
  const out = ["yandere"];
  const push = (value) => {
    const text = String(value ?? "").trim();
    if (text) out.push(text);
  };
  const tags = Array.isArray(meta?.sidebar_tags) ? meta.sidebar_tags : [];
  const stats = meta?.stats || {};
  if (tags.some((tag) => String(tag?.display || tag?.name || "").trim())) out.push("tags");
  push(stats.post_id);
  for (const tag of tags) {
    push(tag?.display);
    push(tag?.name);
  }
  push(stats.rating);
  push(meta?.posted_by_name);
  for (const user of Array.isArray(stats.favorited) ? stats.favorited : []) push(user?.name);
  for (const comment of Array.isArray(meta?.comments) ? meta.comments : []) {
    push(comment?.author_name);
    push(comment?.body);
  }
  return [...new Set(out)];
}

// Konachan metadata 迁移脚本：给历史图片补标签与元数据搜索片段，不改写 metadata。
// 规则与 src/index.ts 保持两份同步（此处运行在无 import 的裸 V8 里）。

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
      category: `konachan/${tagLabelType(tag.type)}`,
      name: display || key.replace(/_/g, " "),
    });
  }
  return labels;
}

export function provideSearchTextList(input) {
  const meta = JSON.parse(input);
  const s = meta.stats || {};
  const out = [];
  for (const tag of meta.sidebar_tags || []) {
    const name = String(tag?.name || "").trim();
    const display = String(tag?.display || "").trim();
    out.push(name && `konachan_tags_${name}`);
    if (display && display !== name) out.push(display);
  }
  out.push(
    s.post_id && `konachan_id_${s.post_id}`,
    meta.posted_by_name && `konachan_posted_${meta.posted_by_name}`,
    s.size && `konachan_size_${s.size}`,
    meta.source_href && `konachan_source_${meta.source_href}`,
    s.rating && `konachan_rating_${s.rating}`,
    meta.score && `konachan_score_${meta.score}`,
  );
  for (const fav of s.favorited || []) {
    out.push(fav?.name && `konachan_favorited_by_${fav.name}`);
  }
  return out.map((value) => String(value || "").trim()).filter(Boolean);
}

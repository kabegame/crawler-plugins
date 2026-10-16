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

// 每张图只写一个 `konachan`，每个有值的字段只写一个裸字段名标记词，值本身不带前缀（原因见 src/index.ts）。
export function provideSearchTextList(input) {
  const meta = JSON.parse(input);
  const s = meta.stats || {};
  const out = ["konachan"];
  const field = (key, values) => {
    const list = values.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (list.length) out.push(key, ...list);
  };
  field(
    "tags",
    (meta.sidebar_tags || []).flatMap((tag) => [tag?.name, tag?.display]),
  );
  field("id", [s.post_id]);
  field("posted", [meta.posted_by_name]);
  field("size", [s.size]);
  field("source", [meta.source_href]);
  field("rating", [s.rating]);
  field("score", [meta.score]);
  field("favorited_by", (s.favorited || []).map((fav) => fav?.name));
  return [...new Set(out)];
}

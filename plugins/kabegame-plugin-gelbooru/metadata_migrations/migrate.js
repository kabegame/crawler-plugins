// Gelbooru metadata 迁移脚本：只提供 provideLabels，给历史图片补标签，不改写 metadata。
// 规则与 src/index.ts 的 labelsFromTags 一致（此处无法 import，保持两份同步）。

const LABEL_CATEGORIES = new Set(["artist", "copyright", "character", "general", "metadata"]);

function tagLabelType(type) {
  const value = String(type || "").trim().toLowerCase();
  return LABEL_CATEGORIES.has(value) ? value : "general";
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
  const metadata = JSON.parse(input);
  const labels = [];
  for (const tag of (metadata && metadata.tags) || []) {
    const key = tagLabelKey(tag && tag.name);
    if (!key) continue;
    const display = String((tag && tag.display) || "").replace(/\s+/g, " ").trim();
    labels.push({
      key,
      category: `gelbooru/${tagLabelType(tag.type)}`,
      name: display || key.replace(/_/g, " "),
    });
  }
  return labels;
}

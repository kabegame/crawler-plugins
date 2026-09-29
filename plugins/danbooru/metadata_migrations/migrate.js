// Danbooru metadata 迁移脚本：只提供 provideLabels，给历史图片补标签，不改写 metadata。
// 规则与 src/index.ts 的 labelsFromTags 一致（此处无法 import，保持两份同步）。

// 站点只有五类标签：作家 / 角色 / 版权 / 元信息 / 通用；其余一律按 general 处理
const LABEL_CATEGORIES = new Set(["artist", "character", "copyright", "meta", "general"]);

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
  const m = JSON.parse(input);
  const labels = [];
  for (const tag of (m && m.tags) || []) {
    const key = tagLabelKey(tag && tag.name);
    if (!key) continue;
    const display = String((tag && tag.display) || "").replace(/\s+/g, " ").trim();
    labels.push({
      key,
      category: `danbooru/${tagLabelType(tag.type)}`,
      name: display || key.replace(/_/g, " "),
    });
  }
  return labels;
}

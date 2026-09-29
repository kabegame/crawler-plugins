// Konachan metadata 迁移脚本：只提供 provideLabels，给历史图片补标签，不改写 metadata。
// 规则与 src/index.ts 的 labelsFromSidebarTags 一致（此处无法 import，保持两份同步）。

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

// Zerochan metadata 迁移脚本：只提供 provideLabels，给历史图片补标签，不改写 metadata。
// 规则与 src/index.ts 的 labelsFromTags 一致（此处无法 import，保持两份同步）。

const LABEL_TYPES = new Set([
  "mangaka", "studio", "artist", "series", "movie", "game", "vtuber", "character", "group",
  "outfit", "theme", "ecchi", "meta", "media", "source-copyright", "source", "artbook",
]);

function tagLabelType(type) {
  const value = String(type || "").trim().toLowerCase();
  return LABEL_TYPES.has(value) ? value : "theme";
}

function tagLabelKey(name) {
  const key = String(name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^a-z0-9_\-() ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

export function provideLabels(input) {
  const m = JSON.parse(input);
  const labels = [];
  const seen = new Set();
  for (const tag of (m && m.tags) || []) {
    const key = tagLabelKey(tag && tag.tag);
    if (!key) continue;
    const category = `zerochan/${tagLabelType(tag.type)}`;
    const id = `${category}\n${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = String((tag && tag.tag) || "").replace(/\s+/g, " ").trim();
    labels.push({ key, category, name: name || key });
  }
  return labels;
}

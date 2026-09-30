// PixAI 历史图片补标签。当前及旧版 metadata 均把作品详情放在 v2 下；迁移脚本运行在无 import 的裸 V8 中，
// 因此这里与 src/labels.ts 保持一份等价实现。

function labelKey(value) {
  const key = String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

export function provideLabels(input) {
  const metadata = JSON.parse(input);
  const detail = metadata && metadata.v2;
  if (!detail || typeof detail !== "object") return [];

  const labels = [];
  const seen = new Set();
  for (const tack of Array.isArray(detail.tacks) ? detail.tacks : []) {
    const key = labelKey(tack && tack.codeName) || labelKey(tack && tack.id);
    if (!key) continue;
    const identity = `pixai/tag/${key}`.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    labels.push({
      key,
      category: "pixai/tag",
      name: text(tack && tack.displayName) || text(tack && tack.defaultName) || text(tack && tack.codeName) || key,
    });
  }

  const author = detail.author;
  const authorKey = labelKey(author && author.id) || labelKey(detail.authorId);
  if (authorKey) {
    labels.push({
      key: authorKey,
      category: "pixai/artist",
      name: text(author && author.displayName) || text(author && author.username) || authorKey,
    });
  }
  return labels;
}

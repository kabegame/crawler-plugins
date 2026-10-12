// PixAI 历史图片补标签与搜索片段。当前及旧版 metadata 均把作品详情放在 v2 下；迁移脚本运行在无 import 的
// 裸 V8 中，因此这里与 src/labels.ts、src/search-texts.ts 各保持一份等价实现。

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

// 元数据搜索片段（detail = metadata.v2）：作者显示名与用户名、所有 tack 名称（displayName / defaultName /
// codeName / 各语言 tackTerms）、作品描述、评论者显示名与用户名及评论内容、提示词。
// 提示词合并 prompts、extra.naturalPrompts（作者隐藏时为 HIDDEN_BY_AUTHOR，跳过）与 extra.referenceImagePrompts，
// 按中英文逗号与换行切开后去重，排在最后：应用每张图最多收 1000 条，超出时丢的只是提示词尾部。
// 单条超过 1024 字符会被应用整条丢弃，所以描述、评论等长文本先截断。
const SEARCH_TEXT_MAX_CHARS = 1024;
const PROMPT_HIDDEN = "HIDDEN_BY_AUTHOR";

function searchTextsFromDetail(detail) {
  const out = [];
  const push = (value) => {
    const text = String(value == null ? "" : value).trim();
    if (text) out.push(text.length > SEARCH_TEXT_MAX_CHARS ? text.slice(0, SEARCH_TEXT_MAX_CHARS) : text);
  };
  const list = (value) => (Array.isArray(value) ? value : []);
  if (!detail || typeof detail !== "object") return out;

  push(detail.author && detail.author.displayName);
  push(detail.author && detail.author.username);
  for (const tack of list(detail.tacks)) {
    push(tack && tack.displayName);
    push(tack && tack.defaultName);
    push(tack && tack.codeName);
    for (const term of list(tack && tack.tackTerms)) push(term && term.name);
  }
  const extra = detail.extra && typeof detail.extra === "object" ? detail.extra : {};
  push(extra.description);
  for (const comment of list(detail.comments)) {
    push(comment && comment.author && comment.author.displayName);
    push(comment && comment.author && comment.author.username);
    push(comment && comment.content);
  }
  for (const prompt of [detail.prompts, extra.naturalPrompts, extra.referenceImagePrompts]) {
    if (typeof prompt !== "string" || prompt.trim() === PROMPT_HIDDEN) continue;
    for (const part of prompt.split(/[,，\r\n]+/)) push(part);
  }
  return [...new Set(out)];
}

export function provideSearchTextList(input) {
  const metadata = JSON.parse(input);
  return searchTextsFromDetail(metadata && metadata.v2);
}

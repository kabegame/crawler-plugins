// metadata_migrations/migrate.js 的 provideSearchTextList 有一份同规则副本（迁移运行在无 import 的裸 V8 里），
// 改这里要同步改那里。
// 元数据搜索片段（detail = metadata.v2）：作者显示名与用户名、所有 tack 名称（displayName / defaultName /
// codeName / 各语言 tackTerms）、作品描述、评论者显示名与用户名及评论内容、提示词。
// 提示词合并 prompts、extra.naturalPrompts（作者隐藏时为 HIDDEN_BY_AUTHOR，跳过）与 extra.referenceImagePrompts，
// 按中英文逗号与换行切开后去重，排在最后：应用每张图最多收 1000 条，超出时丢的只是提示词尾部。
// 单条超过 1024 字符会被应用整条丢弃，所以描述、评论等长文本先截断。
import type { PixaiArtworkDetail, PixaiExtra } from "./types";

const SEARCH_TEXT_MAX_CHARS = 1024;
const PROMPT_HIDDEN = "HIDDEN_BY_AUTHOR";

export function searchTextsFromDetail(detail: PixaiArtworkDetail | null | undefined): string[] {
  const out: string[] = [];
  const push = (value: unknown): void => {
    const text = String(value == null ? "" : value).trim();
    if (text) out.push(text.length > SEARCH_TEXT_MAX_CHARS ? text.slice(0, SEARCH_TEXT_MAX_CHARS) : text);
  };
  const list = <T>(value: readonly T[] | null | undefined): readonly T[] => (Array.isArray(value) ? value : []);
  if (!detail || typeof detail !== "object") return out;

  push(detail.author && detail.author.displayName);
  push(detail.author && detail.author.username);
  for (const tack of list(detail.tacks)) {
    push(tack && tack.displayName);
    push(tack && tack.defaultName);
    push(tack && tack.codeName);
    for (const term of list(tack && tack.tackTerms)) push(term && term.name);
  }
  const extra: PixaiExtra = detail.extra && typeof detail.extra === "object" ? detail.extra : {};
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

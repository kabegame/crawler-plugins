// bilibili metadata 派生：新下载与 metadata migration 共用，保证标签和搜索词规则一致。
// 注意：本模块会被 metadata migration 与 Deno 测试单独 import，不要依赖宿主全局（如 Kabegame）。
import TinyPinyin from "tiny-pinyin";

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecordValue(value) ? value : {};
}

function tagName(value: unknown): string {
  return isRecordValue(value) ? text(value.name) : text(value);
}

/**
 * tiny-pinyin 把汉字逐字转为无声调拼音；其余字符再收敛到标签 key 允许的 ASCII 字符集。
 * 多音字采用 tiny-pinyin 的内置读音，同音标签会落到同一个 key。
 */
export function pinyinLabelKey(value: unknown): string {
  const source = text(value);
  if (!source) return "";

  let converted = source;
  try {
    if (TinyPinyin.isSupported()) {
      converted = "";
      for (const token of TinyPinyin.parse(source)) {
        if (token.type === 2) {
          if (converted && !converted.endsWith("-")) converted += "-";
          converted += `${token.target.toLowerCase()}-`;
        } else {
          converted += token.target;
        }
      }
    }
  } catch {
    // ICU 不可用时仍允许纯 ASCII 标签生成；未转换的汉字会在下面被剔除。
  }

  const key = converted
    .toLowerCase()
    .replace(/[^a-z0-9_()\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return key && key.length <= 64 ? key : "";
}

/**
 * 与宿主 `KabegameLabelInput` 结构一致。本模块会被 migration / Deno 测试单独编译，
 * 那里没有宿主全局类型，因此用本地别名而不是直接引用全局类型。
 */
export type MetadataLabel = {
  key: string;
  category?: string | null;
  name?: string | null;
};

export function labelsFromMetadata(metadata: unknown): MetadataLabel[] {
  const m = record(metadata);
  const labels: MetadataLabel[] = [];
  const seen = new Set<string>();
  const rawTags: unknown[] = Array.isArray(m.tags) ? m.tags : [];
  for (const rawTag of rawTags) {
    const name = tagName(rawTag);
    const key = pinyinLabelKey(name);
    if (!key) continue;
    const identity = `bilibili/tag/${key}`.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    labels.push({ key, category: "bilibili/tag", name });
  }
  return labels;
}

function chinaDate(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const date = new Date(Math.floor(seconds) * 1000 + 8 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

export function searchTextsFromMetadata(metadata: unknown): string[] {
  const m = record(metadata);
  if (text(m.source) === "bilibili_opus") {
    const opusId = text(m.opus_id);
    return opusId ? [opusId] : [];
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown): void => {
    const item = text(value);
    if (!item || seen.has(item)) return;
    seen.add(item);
    out.push(item);
  };

  const rawTags: unknown[] = Array.isArray(m.tags) ? m.tags : [];
  for (const tag of rawTags) {
    const name = tagName(tag);
    if (name) push(`#${name}`);
  }
  push(m.title);
  const author = record(m.author);
  push(author.name);
  push(author.mid);
  const rawCategories: unknown[] = Array.isArray(m.categories) ? m.categories : [];
  for (const category of rawCategories) {
    push(tagName(category));
  }
  const rawReplies: unknown[] = Array.isArray(m.replies) ? m.replies : [];
  for (const reply of rawReplies) {
    const item = record(reply);
    push(item.uname);
    push(item.message);
  }
  push(chinaDate(m.publish_time));
  return out;
}

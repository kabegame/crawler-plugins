// @ts-nocheck
// bilibili metadata 派生：新下载与 metadata migration 共用，保证标签和搜索词规则一致。
import TinyPinyin from "tiny-pinyin";

function text(value) {
  return value == null ? "" : String(value).trim();
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function tagName(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? text(value.name) : text(value);
}

/**
 * tiny-pinyin 把汉字逐字转为无声调拼音；其余字符再收敛到标签 key 允许的 ASCII 字符集。
 * 多音字采用 tiny-pinyin 的内置读音，同音标签会落到同一个 key。
 */
export function pinyinLabelKey(value) {
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

export function labelsFromMetadata(metadata) {
  const m = record(metadata);
  const labels = [];
  const seen = new Set();
  for (const rawTag of Array.isArray(m.tags) ? m.tags : []) {
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

function chinaDate(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const date = new Date(Math.floor(seconds) * 1000 + 8 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

export function searchTextsFromMetadata(metadata) {
  const m = record(metadata);
  if (text(m.source) === "bilibili_opus") {
    const opusId = text(m.opus_id);
    return opusId ? [opusId] : [];
  }

  const out = [];
  const seen = new Set();
  const push = (value) => {
    const item = text(value);
    if (!item || seen.has(item)) return;
    seen.add(item);
    out.push(item);
  };

  for (const tag of Array.isArray(m.tags) ? m.tags : []) {
    const name = tagName(tag);
    if (name) push(`#${name}`);
  }
  push(m.title);
  const author = record(m.author);
  push(author.name);
  push(author.mid);
  for (const category of Array.isArray(m.categories) ? m.categories : []) {
    push(tagName(category));
  }
  for (const reply of Array.isArray(m.replies) ? m.replies : []) {
    const item = record(reply);
    push(item.uname);
    push(item.message);
  }
  push(chinaDate(m.publish_time));
  return out;
}

// metadata 派生：标签与元数据搜索词。规则以后若被 metadata migration 复用，两边保持一致。
import TinyPinyin from "tiny-pinyin";

import { record, str } from "./util";

/**
 * 中文标签 → 合法 key：tiny-pinyin 逐字转无声调拼音，其余字符收敛到 [a-z0-9_()-]。
 * 与 bilibili 插件同一规则；同音标签会落到同一个 key。
 */
export function pinyinLabelKey(value: unknown): string {
  const source = str(value).trim();
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
    // ICU 不可用时只保留 ASCII 部分
  }
  const key = converted
    .toLowerCase()
    .replace(/[^a-z0-9_()\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return key && key.length <= 64 ? key : "";
}

export function labelsFromMetadata(metadata: unknown): KabegameLabelInput[] {
  const m = record(metadata);
  const labels: KabegameLabelInput[] = [];
  const seen = new Set<string>();
  const push = (key: string, category: string, name: string) => {
    if (!key || !name) return;
    const identity = `${category}/${key}`.toLowerCase();
    if (seen.has(identity)) return;
    seen.add(identity);
    labels.push({ key, category, name });
  };
  const user = record(m.user);
  // 作者用 UID 作 key，改昵称不影响归档
  if (/^\d+$/.test(str(user.id))) push(str(user.id), "weibo/user", str(user.name) || str(user.id));
  for (const t of Array.isArray(m.super_topics) ? m.super_topics : []) {
    const name = str(record(t).name);
    push(pinyinLabelKey(name), "weibo/supertopic", name);
  }
  for (const topic of Array.isArray(m.topics) ? m.topics : []) {
    const name = str(topic);
    push(pinyinLabelKey(name), "weibo/topic", name);
  }
  return labels;
}

function chinaDate(iso: unknown): string {
  const date = new Date(str(iso));
  if (Number.isNaN(date.getTime())) return "";
  const cn = new Date(date.getTime() + 8 * 3600 * 1000);
  return `${cn.getUTCFullYear()}年${cn.getUTCMonth() + 1}月${cn.getUTCDate()}日`;
}

/** 详情面板上看得到的文字：话题、超话、正文、作者、IP 属地、日期、评论者与评论。 */
export function searchTextsFromMetadata(metadata: unknown): string[] {
  const m = record(metadata);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const item = str(value).trim();
    if (!item || seen.has(item)) return;
    seen.add(item);
    out.push(item);
  };
  for (const t of Array.isArray(m.super_topics) ? m.super_topics : []) push(`${str(record(t).name)}超话`);
  for (const topic of Array.isArray(m.topics) ? m.topics : []) push(`#${str(topic)}#`);
  push(m.text);
  const user = record(m.user);
  push(user.name);
  push(user.id);
  push(m.mblogid);
  push(m.region);
  push(chinaDate(m.created_at));
  const rt = record(m.retweeted_by);
  push(rt.name);
  for (const c of Array.isArray(m.comments) ? m.comments : []) {
    const item = record(c);
    for (const one of [item, ...(Array.isArray(item.replies) ? item.replies : [])]) {
      push(record(record(one).user).name);
      push(record(one).text);
    }
  }
  return out;
}

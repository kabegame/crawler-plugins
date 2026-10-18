// 哲风壁纸标签：相关标签使用拼音 key，作者优先使用稳定的站内用户 ID。
// metadata migration 与下载入口共用本文件，保证新旧图片生成完全一致的标签路径。

import TinyPinyin from "tiny-pinyin";

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * tiny-pinyin 刻意选择体积优先，不保证多音字准确。输出继续收敛成标签 key 允许的 ASCII 字符集；
 * 汉字间、原有空白和标点都折叠成单个 `-`，便于搜索和复制。
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
    // ICU 不可用时仍让纯 ASCII 标签继续生成；未转换的汉字会在下面被剔除。
  }

  const key = converted
    .toLowerCase()
    .replace(/[^a-z0-9_()\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return key && key.length <= 64 ? key : "";
}

export function labelsFromMetadata(metadata: unknown): KabegameLabelInput[] {
  const m = isRecord(metadata) ? metadata : {};
  const labels: KabegameLabelInput[] = [];
  const seen = new Set<string>();

  const rawTags: unknown[] = Array.isArray(m.tags) ? m.tags : [];
  for (const rawTag of rawTags) {
    const name = text(rawTag);
    const key = pinyinLabelKey(name);
    if (!key) continue;
    const identity = `haowallpaper/tag/${key}`.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    labels.push({ key, category: "haowallpaper/tag", name });
  }

  const publisher = isRecord(m.publisher) ? m.publisher : {};
  const authorName = text(publisher.name || m.author);
  const authorKey = pinyinLabelKey(publisher.id || m.author_id || authorName);
  if (authorKey) {
    labels.push({
      key: authorKey,
      category: "haowallpaper/artist",
      name: authorName || authorKey,
    });
  }

  return labels;
}

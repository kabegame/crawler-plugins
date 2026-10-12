// manyacg metadata 迁移脚本：给历史图片补元数据搜索片段，不改写 metadata。
// 规则与 src/index.ts 的 searchTextsFromMetadata 一致（此处运行在无 import 的裸 V8 里，保持两份同步）。

function str(value) {
  return value == null ? "" : String(value).trim();
}

export function provideSearchTextList(input) {
  const meta = JSON.parse(input) || {};
  const artist = meta.artist || {};
  const texts = [
    "manyacg",
    ...(meta.tags || []).map(str),
    str(meta.title),
    str(artist.name),
    str(meta.source_type || artist.type).toLowerCase(),
    str(artist.username).replace(/^@+/, ""),
    // 入库日期，取 created_at（"2025-02-12 14:45:50"）开头的 YYYY-MM-DD，与详情页显示的原串一致
    /^\d{4}-\d{2}-\d{2}/.exec(str(meta.created_at))?.[0] ?? "",
  ];
  return [...new Set(texts.filter(Boolean))];
}

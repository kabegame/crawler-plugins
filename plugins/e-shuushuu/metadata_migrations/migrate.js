// e-shuushuu metadata 迁移脚本：给历史图片补元数据搜索片段，不改写 metadata。
// 规则与 src/index.ts 的 searchTextsFromMetadata 一致（此处运行在无 import 的裸 V8 里，保持两份同步）。

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function provideSearchTextList(input) {
  const meta = JSON.parse(input) || {};
  const out = ["e-shuushuu"];
  const field = (key, values) => {
    const list = values.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (list.length) out.push(key, ...list);
  };
  const up = meta.uploader || {};
  field("uploader", [up.username, up.user_title]);
  // 日期拆成年、月（英文全名）、日三个词，与详情页显示的 "September 17, 2026" 对应；取 date_added 的 UTC 日期串
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(meta.date_added || ""));
  if (ymd) field("date", [ymd[1], MONTHS[Number(ymd[2]) - 1], String(Number(ymd[3]))]);
  field("tags", (meta.tags || []).map((tag) => tag?.title));
  field("id", [meta.image_id]);
  field("favorites", [meta.favorites ?? 0]);
  field("source", [meta.source_url]);
  const comments = (meta.comments || []).filter((c) => c && !c.deleted);
  field("comments", comments.flatMap((c) => [c.user?.username, c.post_text]));
  return [...new Set(out)];
}

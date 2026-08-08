// haowallpaper 统一 metadata 迁移脚本（kbMetadataMigration）。
//
// 输入/输出均为 JSON 字符串；按 metadata 内 `schema` 自检，幂等、一步到位：
// - schema 2 → 原样返回（当前结构）。
// - schema 1 / 无 schema → 保留已有结构化字段，并把旧 author 字段归一到 publisher。
//
// 运行环境为裸 V8（无 import、无宿主 API），只依赖原生 JSON/String。

function text(value) {
  return value == null ? "" : String(value).trim();
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function migrate(input) {
  const metadata = JSON.parse(input);
  if (text(metadata?.schema) === "2") return input;

  const legacy = record(metadata);
  const oldPublisher = record(legacy.publisher);
  const publisher = {
    id: text(oldPublisher.id || legacy.author_id),
    name: text(oldPublisher.name || legacy.author),
    profile_url: text(oldPublisher.profile_url || legacy.author_profile_url),
    avatar_url: text(oldPublisher.avatar_url || legacy.author_avatar_url),
    follower_count: text(
      oldPublisher.follower_count || legacy.author_follower_count,
    ),
    share_count: text(oldPublisher.share_count || legacy.author_share_count),
    download_count: text(
      oldPublisher.download_count || legacy.author_download_count,
    ),
    signature: text(oldPublisher.signature || legacy.author_signature),
  };

  return JSON.stringify({
    ...legacy,
    schema: 2,
    tags: Array.isArray(legacy.tags) ? legacy.tags : [],
    author: text(legacy.author || publisher.name),
    author_id: text(legacy.author_id || publisher.id),
    publisher,
  });
}

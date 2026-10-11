// anihonet-wallpaper 统一 metadata 迁移脚本（kbMetadataMigration）。
//
// schema 5 直接保留原站 taxonomy：
// - categories：详情页 rel 含 category 的链接。
// - tags：详情页 rel 含 tag、但不含 category 的链接。
//
// 旧 schema 未保存 rel，只能用已保存的 /category/ URL 恢复 category；
// 其余条目按 tag 迁移。运行环境为裸 V8，只依赖原生 JSON/String/RegExp。

function declaredSchema(metadata) {
  if (metadata == null || metadata.schema == null) return "";
  return String(metadata.schema).trim();
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function isTagObject(tag) {
  return typeof tag === "object" && tag !== null && !Array.isArray(tag);
}

function normalizedTag(tag, category) {
  if (isTagObject(tag)) {
    return {
      name: tag.name == null ? "" : String(tag.name).trim(),
      href: tag.href == null ? "" : String(tag.href).trim(),
      rel: category ? "category tag" : "tag",
    };
  }
  return {
    name: String(tag == null ? "" : tag).trim(),
    href: "",
    rel: category ? "category tag" : "tag",
  };
}

function relContainsCategory(tag) {
  if (!isTagObject(tag) || tag.rel == null) return false;
  return String(tag.rel)
    .split(/\s+/)
    .some((token) => token === "category");
}

function hrefIsCategory(tag) {
  if (!isTagObject(tag) || tag.href == null) return false;
  return /(?:^|\/)category(?:\/|$)/i.test(String(tag.href));
}

function legacyTags(metadata) {
  const flat = arrayOrEmpty(metadata.tags);
  if (flat.length > 0) return flat;
  return [
    ...arrayOrEmpty(metadata.qualityTags),
    ...arrayOrEmpty(metadata.workTags),
    ...arrayOrEmpty(metadata.characterTags),
    ...arrayOrEmpty(metadata.typeTags),
  ];
}

function splitLegacyTags(source) {
  const categories = [];
  const tags = [];
  const seen = Object.create(null);
  for (const raw of source) {
    const category = relContainsCategory(raw) || hrefIsCategory(raw);
    const tag = normalizedTag(raw, category);
    if (!tag.name && !tag.href) continue;
    const key = `${tag.name}\u0000${tag.href}`;
    if (seen[key]) continue;
    seen[key] = true;
    if (category) categories.push(tag);
    else tags.push(tag);
  }
  return { categories, tags };
}

export function migrate(input) {
  const metadata = JSON.parse(input);
  if (declaredSchema(metadata) === "5") return input;

  const groups = splitLegacyTags(legacyTags(metadata));
  const output = {
    schema: 5,
    categories: groups.categories,
    tags: groups.tags,
  };
  if (metadata.post_id != null) output.post_id = metadata.post_id;
  if (metadata.date != null) output.date = metadata.date;
  return JSON.stringify(output);
}

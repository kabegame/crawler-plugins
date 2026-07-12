// anime-pictures 统一 metadata 迁移脚本（kbMetadataMigration）。
//
// 输入/输出均为 JSON 字符串；按 metadata 内 `schema` 自检，幂等、一步到位：
// - schema 1 且不含遗留 `headInfoHtml` / `tagsHtml` → 原样返回（当前结构）。
// - 其他（遗留 HTML 片段 / 半结构化）→ 解析为 schema 1 结构化 JSON：
//   保留 `title` / `author` / `details` / `rating` / `tagGroups`，
//   丢弃 `headInfoHtml` / `tagsHtml`。
//
// 运行环境为裸 V8（无 import、无宿主 API），只依赖原生 JSON/String/RegExp。

function htmlUnescape(s) {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function cleanText(s) {
  s = s.replace(/<!--.*?-->/gs, "");
  s = s.replace(/<svg\b.*?<\/svg>/gs, " ");
  s = s.replace(/<[^>]+>/gs, " ");
  s = htmlUnescape(s);
  s = s.replace(/\s+/g, " ");
  return s.trim();
}

function attr(html, name) {
  const m = html.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  if (m && m[1] != null) return htmlUnescape(m[1]);
  return "";
}

function declaredSchema(m) {
  if (m == null || m.schema == null) return "";
  return String(m.schema).trim();
}

function isCurrentSchema(m) {
  return declaredSchema(m) === "1" && m.headInfoHtml == null && m.tagsHtml == null;
}

function tagType(className) {
  if (/(^|\s)copyright(\s|$)/.test(className)) return "copyright";
  if (/(^|\s)character(\s|$)/.test(className)) return "character";
  if (/(^|\s)artist(\s|$)/.test(className)) return "artist";
  if (/(^|\s)object(\s|$)/.test(className)) return "object";
  if (/(^|\s)reference(\s|$)/.test(className)) return "reference";
  return "";
}

function parseTitle(headHtml) {
  const m = headHtml.match(/<h1\b[^>]*>(.*?)<\/h1>/s);
  if (!m || m[1] == null) return "";
  return cleanText(m[1]);
}

function lineDetails(lines) {
  const details = [];
  if (!Array.isArray(lines)) return details;
  for (const line of lines) {
    const text = String(line).trim();
    if (text.length > 0) details.push({ text });
  }
  return details;
}

function parseDetailLinks(itemHtml) {
  const links = [];
  for (const anchorMatch of itemHtml.matchAll(/<a\b[^>]*>.*?<\/a>/gs)) {
    const anchorHtml = anchorMatch[0];
    const url = attr(anchorHtml, "href");
    const text = cleanText(anchorHtml);
    if (text.length > 0 || url.length > 0) {
      links.push({ text: text.length > 0 ? text : url, url });
    }
  }
  return links;
}

function parseDetailItems(headHtml) {
  let source = headHtml.replace(
    /<span\b[^>]*class="[^"]*\blight\b[^"]*"[^>]*>(.*?)<\/span>/gs,
    "$1",
  );
  source = source.replace(
    /<span\b[^>]*class="[^"]*\bcolor-sample\b[^"]*"[^>]*><\/span>/gs,
    "",
  );

  const details = [];
  for (const itemMatch of source.matchAll(
    /<span\b[^>]*class="[^"]*\binfo-item\b[^"]*"[^>]*>(.*?)<\/span>/gs,
  )) {
    const itemHtml = itemMatch[0];
    const text = cleanText(itemHtml);
    if (text.length === 0) continue;

    const detail = { text };
    const links = parseDetailLinks(itemHtml);
    if (links.length > 0) detail.links = links;

    const colorMatch = itemHtml.match(/background-color:\s*([^;"']+)/);
    if (colorMatch && colorMatch[1] != null) {
      detail.color = colorMatch[1].trim();
    }
    details.push(detail);
  }
  return details;
}

function parseTagGroups(tagsHtml) {
  const groups = [];
  let current = -1;
  const tokens = tagsHtml.matchAll(
    /<span\b[^>]*class="[^"]*\bsvelte-1ok3vri\b[^"]*"[^>]*>.*?<\/span>|<li\b[^>]*>.*?<\/li>/gs,
  );

  for (const tokenMatch of tokens) {
    const token = tokenMatch[0];
    if (/^<span\b/.test(token)) {
      const name = cleanText(token);
      if (name.length === 0) continue;
      groups.push({ name, tags: [] });
      current = groups.length - 1;
      continue;
    }

    const anchorMatch = token.match(/<a\b[^>]*>.*?<\/a>/s);
    if (!anchorMatch) continue;
    if (current < 0) {
      groups.push({ name: "", tags: [] });
      current = groups.length - 1;
    }

    const anchorHtml = anchorMatch[0];
    const name = cleanText(anchorHtml);
    const url = attr(anchorHtml, "href");
    if (name.length === 0 && url.length === 0) continue;

    const tag = { name, url, type: tagType(attr(anchorHtml, "class")) };

    const countMatch = token.match(
      /<span\b[^>]*class="[^"]*\bedit_tag\b[^"]*"[^>]*>(.*?)<\/span>/s,
    );
    if (countMatch && countMatch[1] != null) {
      const count = cleanText(countMatch[1]);
      if (count.length > 0) tag.count = count;
    }

    const byMatch = token.match(/\btitle="by\s+([^"]+)"/);
    if (byMatch && byMatch[1] != null) {
      tag.by = htmlUnescape(byMatch[1]).trim();
    }

    groups[current].tags.push(tag);
  }

  return groups;
}

export function migrate(input) {
  const m = JSON.parse(input);
  if (isCurrentSchema(m)) return input;

  const out = { schema: 1 };

  if (m.title != null) {
    out.title = m.title;
  } else if (m.headInfoHtml != null) {
    const title = parseTitle(m.headInfoHtml);
    if (title.length > 0) out.title = title;
  }

  if (m.author != null) out.author = m.author;

  if (m.details != null) {
    out.details = m.details;
  } else if (m.lines != null) {
    out.details = lineDetails(m.lines);
  } else if (m.headInfoHtml != null) {
    out.details = parseDetailItems(m.headInfoHtml);
  } else {
    out.details = [];
  }

  if (m.rating != null) out.rating = m.rating;

  if (Array.isArray(m.tagGroups) && m.tagGroups.length > 0) {
    out.tagGroups = m.tagGroups;
  } else if (m.tagsHtml != null) {
    out.tagGroups = parseTagGroups(m.tagsHtml);
  } else {
    out.tagGroups = [];
  }

  return JSON.stringify(out);
}

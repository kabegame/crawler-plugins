// @ts-nocheck
// anime-pictures V8 crawler: parse host HTML with DOMParser and store schema 1 metadata.
import { resolveUrl as resolveSdkUrl, sleep } from "@kabegame/plugin-sdk";
import { t } from "./i18n";
import { searchTextsFromMetadata } from "./search-texts";

const {
  addProgress,
  currentHtml,
  downloadImage,
  requireCookie,
  setHeader,
  to,
  warn,
} = Kabegame;

const DEFAULT_BASE_URL = "https://anime-pictures.net";

const REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
  // 兜底 UA（Linux 畅游）；运行时优先用 Kabegame.cefUserAgent()
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  Cookie:
    "sitelang=zh-cn; time_zone=Asia%2FTokyo",
};

function setRequestHeaders() {
  for (const [key, value] of Object.entries(REQUEST_HEADERS)) {
    setHeader(key, value);
  }
  // cf_clearance 绑定签发时的 UA：用畅游的真实 UA 覆盖上面写死的（旧版应用无此接口时保留兜底值）
  const cefUa = Kabegame.cefUserAgent?.();
  if (cefUa) setHeader("User-Agent", cefUa);
  log(cefUa ? t("userAgentFromCef", { ua: cefUa }) : t("userAgentBuiltin"));
  // 优先用畅游持久化的 Cookie（含 HttpOnly 的 cf_clearance），会覆盖上面写死的 Cookie
  if (!requireCookie()) {
    log(t("cookieMissing"), "warn");
  }
}

function log(message, level) {
  if (level === "warn") {
    warn(String(message ?? ""));
    return;
  }
  console.log(String(message ?? ""));
}

function coerceStr(value) {
  return value == null ? "" : String(value);
}

function resolveUrl(url, baseUrl) {
  const raw = coerceStr(url).trim();
  if (!raw) return "";
  return resolveSdkUrl(raw, baseUrl);
}

function parseHtml(html) {
  return new DOMParser().parseFromString(coerceStr(html), "text/html");
}

function isChallengePage(document) {
  const title = (document.title || "").trim();
  const bodyText =
    document.body && document.body.textContent
      ? document.body.textContent.slice(0, 2000)
      : "";
  return /just a moment|cloudflare|challenge|checking your browser/i.test(title) ||
    /just a moment|cloudflare|checking your browser/i.test(bodyText);
}

async function openDocument(url) {
  const finalUrl = await to(url);
  const html = await currentHtml();
  const document = parseHtml(html);
  if (isChallengePage(document)) {
    throw new Error(t("challengePage"));
  }
  return { finalUrl, document };
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function textOf(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function extractPostLinks(document, pageUrl) {
  const links = Array.from(document.querySelectorAll(".img-block > a[href]"))
    .map((a) => resolveUrl(a.getAttribute("href"), pageUrl));
  if (links.length) return unique(links);

  return unique(
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => {
        const href = resolveUrl(a.getAttribute("href"), pageUrl);
        const className = a.getAttribute("class") || "";
        if (
          /\/posts\/\d+/i.test(href) ||
          /\/pictures\/view_post\//i.test(href) ||
          (/\bimg-block\b/i.test(className) && /\/posts/i.test(href))
        ) {
          return href;
        }
        return "";
      }),
  );
}

function findDownloadUrl(document, pageUrl) {
  const downloadIcon = document.querySelector(".icon-download[href]");
  if (downloadIcon) {
    return resolveUrl(downloadIcon.getAttribute("href"), pageUrl);
  }

  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") || "";
    if (/download|image_original|full/i.test(href)) {
      return resolveUrl(href, pageUrl);
    }
  }
  return "";
}

function pickAnimePicturesDisplayName(document) {
  const tagsUl = document.querySelector(
    "ul.tags, .page-tags ul.tags, .wrapper.page-tags ul.tags",
  );
  if (tagsUl) {
    const work = textOf(tagsUl.querySelector("a.copyright"));
    const character = textOf(tagsUl.querySelector("a.character"));
    const artist = textOf(tagsUl.querySelector("a.artist"));
    const titleSeg = [work, character].filter(Boolean).join(" / ");
    const name = [titleSeg, artist].filter(Boolean).join(" / ");
    if (name) {
      log(
        t("pickNameResolved", {
          work: JSON.stringify(work || null),
          character: JSON.stringify(character || null),
          artist: JSON.stringify(artist || null),
          name: JSON.stringify(name),
        }),
      );
      return name;
    }
    log(t("pickNameNoLinks"));
  } else {
    log(t("pickNameNoTags"));
  }

  const illustRe = /^(イラスト|illustration|illustrations|арт|插画|圖片|图片)/i;
  const h1A = document.querySelector(
    ".post_content.head-info h1 a.copyright, .post-block h1 a.copyright",
  );
  const h1One = textOf(h1A);
  if (h1One) {
    log(t("pickNameFallbackH1", { name: JSON.stringify(h1One) }));
    return h1One;
  }

  const titleRaw = (document.title || "").trim();
  const lines = titleRaw
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length >= 2 && illustRe.test(lines[0])) {
    log(t("pickNameFallbackTitleLine", { name: JSON.stringify(lines[1]) }));
    return lines[1];
  }

  const oneLine = titleRaw.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  const tokens = oneLine.split(" ").filter(Boolean);
  if (tokens.length >= 2 && illustRe.test(tokens[0])) {
    log(t("pickNameFallbackTitleWord", { name: JSON.stringify(tokens[1]) }));
    return tokens[1];
  }

  log(t("pickNameEmpty", { title: JSON.stringify(oneLine.slice(0, 200)) }));
  return "";
}

function colorFromInfoItem(item) {
  const color = item.querySelector("span.color-sample");
  if (!color) return null;
  const style = color.getAttribute("style") || "";
  const match = style.match(/background-color:\s*([^;]+)/i);
  return match ? match[1].trim() : null;
}

function linksFromInfoItem(item, pageUrl) {
  return Array.from(item.querySelectorAll("a[href]"))
    .map((a) => {
      const text = textOf(a);
      const url = resolveUrl(a.getAttribute("href"), pageUrl);
      if (!text && !url) return null;
      return { text: text || url, url };
    })
    .filter(Boolean);
}

function infoItemPlainText(item) {
  const clone = item.cloneNode(true);
  const doc = clone.ownerDocument || item.ownerDocument;
  clone.querySelectorAll("svg").forEach((s) => s.remove());
  clone
    .querySelectorAll("a[href]")
    .forEach((a) => a.replaceWith(doc.createTextNode(textOf(a))));
  clone.querySelectorAll("span.color-sample").forEach((sp) => {
    const st = sp.getAttribute("style") || "";
    const m = st.match(/background-color:\s*([^;]+)/i);
    sp.replaceWith(doc.createTextNode(m ? ` ${m[1].trim()}` : ""));
  });
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function detailItemFromInfoItem(item, pageUrl) {
  const text = infoItemPlainText(item);
  if (!text) return null;
  const links = linksFromInfoItem(item, pageUrl);
  const color = colorFromInfoItem(item);
  const out = { text };
  if (links.length) out.links = links;
  if (color) out.color = color;
  return out;
}

function postTitleFromHead(head) {
  const h1 = head.querySelector("h1");
  if (!h1) return "";
  return textOf(h1);
}

function tagTypeFromAnchor(anchor) {
  if (anchor.classList.contains("copyright")) return "copyright";
  if (anchor.classList.contains("character")) return "character";
  if (anchor.classList.contains("artist")) return "artist";
  if (anchor.classList.contains("object")) return "object";
  if (anchor.classList.contains("reference")) return "reference";
  return "";
}

function extractTagGroups(document, pageUrl) {
  const tagsUl =
    document.querySelector("ul.tags[itemprop='keywords']") ||
    document.querySelector(".wrapper.page-tags ul.tags") ||
    document.querySelector("ul.tags");
  if (!tagsUl) return [];

  const groups = [];
  let current = null;
  for (const child of Array.from(tagsUl.children)) {
    if (child.tagName === "SPAN") {
      const name = textOf(child);
      if (!name) continue;
      current = { name, tags: [] };
      groups.push(current);
      continue;
    }

    if (child.tagName !== "LI") continue;
    const anchor = child.querySelector("a[href]");
    if (!anchor) continue;
    if (!current) {
      current = { name: "", tags: [] };
      groups.push(current);
    }
    const count = textOf(child.querySelector(".edit_tag"));
    const tag = {
      name: textOf(anchor),
      url: resolveUrl(anchor.getAttribute("href"), pageUrl),
      type: tagTypeFromAnchor(anchor),
    };
    const by = (child.getAttribute("title") || "").replace(/^by\s+/i, "").trim();
    if (count) tag.count = count;
    if (by) tag.by = by;
    current.tags.push(tag);
  }

  return groups.filter((group) => group.name || group.tags.length);
}

// 标签画册：把作品 / 角色 / 画师 / 参考 / 物体五类 tag 映射为应用标签，各自一个目录；没有类型的 tag 不写入。
// key 由 tag 名派生（小写、丢弃 key 字符集之外的字符、空白折叠为单个空格并去首尾），
// 保留 `sua (alien stage)` 这类原样的空格与括号；派生后为空或超长的直接跳过，
// 不做别的修正。metadata_migrations/migrate.js 的 provideLabels 有一份同规则的副本（迁移运行在
// 无 import 的裸 V8 里），改这里要同步改那里。
const LABEL_TAG_TYPES = ["copyright", "character", "artist", "reference", "object"];

function tagLabelKey(name) {
  const key = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

function labelsFromTagGroups(tagGroups) {
  const labels = [];
  for (const group of tagGroups || []) {
    for (const tag of group.tags || []) {
      if (!LABEL_TAG_TYPES.includes(tag.type)) continue;
      const key = tagLabelKey(tag.name);
      if (!key) continue;
      labels.push({ key, category: `anime-pictures/${tag.type}`, name: tag.name });
    }
  }
  return labels;
}

function buildAnimePicturesMetadata(document, pageUrl) {
  const head = document.querySelector(".post_content.head-info");
  if (!head) return null;

  let author = null;
  const authorSec = head.querySelector(".author-section");
  if (authorSec) {
    const avatarWrap = authorSec.querySelector("a[href*='profile']");
    const img = authorSec.querySelector("img");
    const userA = authorSec.querySelector("a.user_link");
    const name = textOf(userA);
    const profileHref = userA ? resolveUrl(userA.getAttribute("href"), pageUrl) : "";
    const avSrc = img && avatarWrap ? resolveUrl(img.getAttribute("src"), pageUrl) : "";
    if (name || avSrc || profileHref) {
      author = {
        name: name || "",
        profileUrl: profileHref || "",
        avatarUrl: avSrc || "",
      };
    }
  }

  const detailItems = [];
  const detailsSection = head.querySelector(".details-section");
  if (detailsSection) {
    for (const line of Array.from(detailsSection.querySelectorAll(".info-line"))) {
      if (line.querySelector("button.metrics-toggle")) continue;
      for (const item of Array.from(line.querySelectorAll(".info-item"))) {
        const detail = detailItemFromInfoItem(item, pageUrl);
        if (detail) detailItems.push(detail);
      }
    }
  }

  let rating = null;
  const ratingEl = document.querySelector(".vote_block span.rating");
  if (ratingEl) {
    const b = ratingEl.querySelector("b");
    const countEl = Array.from(ratingEl.querySelectorAll("span")).find((s) =>
      /^\d+$/.test((s.textContent || "").trim()),
    );
    if (b && countEl) {
      rating = {
        label: (b.textContent || "").trim(),
        count: (countEl.textContent || "").trim(),
      };
    }
  }

  return {
    schema: 1,
    title: postTitleFromHead(head),
    author,
    details: detailItems,
    rating,
    tagGroups: extractTagGroups(document, pageUrl),
  };
}

async function crawlDetail(url, pageWeight) {
  const { finalUrl, document } = await openDocument(url);
  const displayName = pickAnimePicturesDisplayName(document);
  const metadata = buildAnimePicturesMetadata(document, finalUrl);
  const downloadUrl = findDownloadUrl(document, finalUrl);

  log(
    t("displayName", { name: displayName ? JSON.stringify(displayName) : t("emptyValue") }),
  );
  log(
    t("metadata", { metadata: metadata ? JSON.stringify(metadata).slice(0, 500) : t("emptyValue") }),
  );

  await sleep(3000);
  if (!downloadUrl) {
    log(t("downloadLinkMissing", { url: finalUrl }), "warn");
    addProgress(pageWeight);
    return;
  }

  const opts = {
    cookie: true,
    url: finalUrl,
  };
  if (displayName) opts.name = displayName;
  if (metadata) {
    opts.metadata = metadata;
    opts.searchTexts = searchTextsFromMetadata(metadata);
  }
  const labels = labelsFromTagGroups(metadata?.tagGroups);
  if (labels.length > 0) opts.labels = labels;
  await downloadImage(downloadUrl, opts);
  addProgress(pageWeight);
}

function pageUrl(baseUrl, page, tag) {
  const query = [`page=${encodeURIComponent(String(page))}`];
  if (tag) query.push(`search_tag=${encodeURIComponent(tag)}`);
  return `${resolveUrl("/posts", baseUrl)}?${query.join("&")}`;
}

export async function crawl(common, custom) {
  setRequestHeaders();

  const baseUrl = common?.base_url || DEFAULT_BASE_URL;
  const startPage = Number(custom?.startPage ?? 0);
  const endPage = Number(custom?.endPage ?? startPage);
  const tag = coerceStr(custom?.tag).trim();

  if (endPage >= startPage + 100) {
    throw new Error(t("pageRangeTooLarge"));
  }
  if (endPage < startPage) {
    throw new Error(t("endPageBeforeStart"));
  }

  const totalPages = endPage - startPage + 1;
  const pageProgress = totalPages > 0 ? 100 / totalPages : 100;
  log(t("crawlStart", { startPage, endPage, tag: tag || t("emptyValue") }));

  for (let page = startPage; page <= endPage; page += 1) {
    const listUrl = pageUrl(baseUrl, page, tag);
    await sleep(2000);
    const { finalUrl, document } = await openDocument(listUrl);
    const links = extractPostLinks(document, finalUrl);
    log(t("pageImages", { page, count: links.length }));

    if (links.length === 0) {
      addProgress(pageProgress);
      continue;
    }

    const itemProgress = pageProgress / links.length;
    for (const link of links) {
      await sleep(2000);
      await crawlDetail(link, itemProgress);
    }
  }

  log(t("crawlDone"));
}

// @ts-nocheck
// 蓝色大肥鱼 V8 爬虫。
//
// 源站的 /archive-data.json?v=2 一次返回完整作品表；页面端也是读取这份冻结数据后在浏览器内筛选，
// 不存在服务端分页。角色和类型选项与 Provider 都按源站公开 taxonomy 固定维护。
// 热度 / 下载量来自 /cms-api/analytics/public，排序规则与源站 archive/archive.js 一致：
// 分别按 views / downloads 降序，数值相同时保持归档原顺序。

import TinyPinyin from "tiny-pinyin";
import { sleep } from "@kabegame/plugin-sdk";

const { addProgress, createImageMetadata, downloadImage, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://xn--pssy23gqgbz2d718b.com";
const ARCHIVE_PATH = "/archive-data.json?v=2";
const ANALYTICS_PATH = "/cms-api/analytics/public";
const REQUEST_ATTEMPTS = 3;

const CHARACTER_NAMES = {
  deepseek: "DeepSeek娘",
  gpt: "GPT娘",
  claude: "Claude娘",
  kimi: "Kimi娘",
  qwen: "通义千问娘",
  other: "其他角色",
  gemini: "Gemini娘",
  grok: "Grok娘",
  glm: "GLM娘",
  doubao: "豆包娘",
  "owner-picks": "站长自用",
  stepfun: "Stepfun娘",
  mimo: "MiMo娘",
};

const TYPE_NAMES = {
  meme: "梗图",
  illustration: "插画",
  setting: "设定图",
  comic: "漫画",
  standing: "立绘",
  other: "其他",
};

const VALID_CHARACTERS = new Set(["", ...Object.keys(CHARACTER_NAMES)]);
const VALID_TYPES = new Set(["", ...Object.keys(TYPE_NAMES)]);
const VALID_SORTS = new Set(["latest", "popular", "downloads", "random"]);

const LABEL_CHARACTER = "bluedafeiyu/character";
const LABEL_TAG = "bluedafeiyu/tag";
const KEY_ALLOWED = /^[a-z0-9_\-() ]+$/;

function log(message) {
  console.log(`[bluedafeiyu] ${message}`);
}

function str(value) {
  return value == null ? "" : String(value).trim();
}

function absoluteUrl(value, baseUrl) {
  const input = str(value);
  if (!input) return "";
  try {
    return new URL(input, baseUrl).href;
  } catch {
    return "";
  }
}

async function fetchJson(url, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "identity",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < REQUEST_ATTEMPTS) {
        log(
          `${label}读取失败，${attempt * 700}ms 后重试 ${attempt + 1}/${REQUEST_ATTEMPTS}：${error?.message ?? error}`,
        );
        await sleep(attempt * 700);
      }
    }
  }
  throw new Error(`${label}请求失败：${lastError?.message ?? lastError}`);
}

function toPinyin(text) {
  let converted = "";
  let hasHan = false;
  try {
    if (TinyPinyin.isSupported()) {
      for (const token of TinyPinyin.parse(text)) {
        if (token.type === 2) {
          hasHan = true;
          if (converted && !converted.endsWith("-")) converted += "-";
          converted += `${token.target.toLowerCase()}-`;
        } else {
          converted += token.target;
        }
      }
      return { converted, hasHan };
    }
  } catch {
    // ICU 不可用时交给确定性码点编码兜底。
  }
  return { converted: text, hasHan: false };
}

function hashKey(text) {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    hashA = Math.imul(hashA ^ codePoint, 0x01000193);
    hashB = Math.imul(hashB ^ codePoint, 0x85ebca6b);
  }
  return `u-${(hashA >>> 0).toString(36)}-${(hashB >>> 0).toString(36)}`;
}

function tagKey(value) {
  const text = str(value).normalize("NFKC").replace(/\s+/g, " ");
  if (!text) return "";
  const lower = text.toLowerCase();
  if (KEY_ALLOWED.test(lower) && lower.length <= 64) return lower;

  const { converted, hasHan } = toPinyin(text);
  if (hasHan && !/[^\x00-\x7f]/.test(converted)) {
    const pinyin = converted
      .toLowerCase()
      .replace(/[^a-z0-9_()\-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (pinyin && pinyin.length <= 64) return pinyin;
  }

  const encoded = `u-${Array.from(text, (char) => char.codePointAt(0).toString(36)).join("-")}`;
  return encoded.length <= 64 ? encoded : hashKey(text);
}

function buildLabels(work) {
  const labels = [];
  const seen = new Set();
  const push = (category, key, name) => {
    if (!key || seen.has(`${category}\n${key}`)) return;
    seen.add(`${category}\n${key}`);
    labels.push({ category, key, name });
  };

  const roleById = new Map((Array.isArray(work?.roles) ? work.roles : []).map((role) => [str(role?.id), role]));
  for (const characterId of Array.isArray(work?.cids) ? work.cids : []) {
    const key = str(characterId).toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(key)) continue;
    push(LABEL_CHARACTER, key, str(roleById.get(key)?.name) || CHARACTER_NAMES[key] || key);
  }
  for (const tag of Array.isArray(work?.tg) ? work.tg : []) {
    const name = str(tag);
    const key = tagKey(name);
    if (key) push(LABEL_TAG, key, name);
  }
  return labels;
}

function buildMetadata(work, baseUrl, statsSnapshot) {
  const pageUrl = `${baseUrl}/works/${encodeURIComponent(str(work.slug))}.html`;
  const metrics = statsSnapshot?.available ? statsSnapshot?.works?.[work.id] : null;
  const characterIds = (Array.isArray(work?.cids) ? work.cids : []).map(str).filter(Boolean);
  const typeIds = (Array.isArray(work?.k) ? work.k : []).map(str).filter(Boolean);
  const roles = (Array.isArray(work?.roles) ? work.roles : []).map((role) => ({
    id: str(role?.id),
    name: str(role?.name),
  }));

  return {
    schema: 1,
    work_id: str(work.id),
    slug: str(work.slug),
    page_url: pageUrl,
    title: str(work.n),
    description: str(work.d),
    commentary: str(work.cm),
    character_ids: characterIds,
    characters: roles,
    type_ids: typeIds,
    types: typeIds.map((id) => ({ id, name: TYPE_NAMES[id] || id })),
    tags: (Array.isArray(work?.tg) ? work.tg : []).map(str).filter(Boolean),
    collected_at: str(work.dt),
    media: {
      original_url: absoluteUrl(work.o, baseUrl),
      large_url: absoluteUrl(work.l, baseUrl),
      preview_url: absoluteUrl(work.i, baseUrl),
      width: Number(work.w) || 0,
      height: Number(work.h) || 0,
      format: str(work.f),
      bytes: Number(work.bytes) || 0,
      formatted_size: str(work.s),
    },
    author: {
      name: str(work.a),
      credited: !!work.ac,
      source_author: str(work.sa),
    },
    source: {
      url: absoluteUrl(work.su, baseUrl),
      kind: str(work.ok),
      note: str(work.ln),
    },
    license: {
      key: str(work.lk),
      short: str(work.ls),
      title: str(work.lt),
      note: str(work.ln),
      rights: work.rights && typeof work.rights === "object" ? work.rights : {},
    },
    stats: {
      available: !!statsSnapshot?.available,
      views: Number(metrics?.views) || 0,
      downloads: Number(metrics?.downloads) || 0,
      start_date: str(statsSnapshot?.startDate),
      synced_at: str(statsSnapshot?.syncedAt),
      stale: !!statsSnapshot?.stale,
      limited: !!statsSnapshot?.limited,
    },
  };
}

function buildSearchTexts(metadata) {
  const texts = [
    "蓝色大肥鱼",
    metadata.title,
    metadata.description,
    metadata.commentary,
    metadata.collected_at,
    metadata.author?.name,
    metadata.author?.source_author,
    metadata.license?.title,
    metadata.license?.rights?.creditName,
    metadata.license?.rights?.creditText,
    ...(metadata.characters || []).flatMap((character) => [
      character.name,
      character.name ? `角色 ${character.name}` : "",
    ]),
    ...(metadata.types || []).flatMap((type) => [type.name, type.name ? `类型 ${type.name}` : ""]),
    ...(metadata.tags || []),
  ];
  return [...new Set(texts.map(str).filter(Boolean))];
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}

function filterAndSort(works, character, type, sort, statsSnapshot) {
  const filtered = works.filter((work) => {
    const characters = Array.isArray(work?.cids) ? work.cids : [];
    const types = Array.isArray(work?.k) ? work.k : [];
    return (!character || characters.includes(character)) && (!type || types.includes(type));
  });

  if (sort === "popular" || sort === "downloads") {
    const metric = sort === "downloads" ? "downloads" : "views";
    if (statsSnapshot?.available) {
      filtered.sort(
        (a, b) =>
          (Number(statsSnapshot?.works?.[b.id]?.[metric]) || 0) - (Number(statsSnapshot?.works?.[a.id]?.[metric]) || 0),
      );
    } else {
      warn(`[bluedafeiyu] 公开统计不可用，${sort === "popular" ? "热度" : "下载量"}排序回退为最新顺序`);
    }
  } else if (sort === "random") {
    shuffle(filtered);
  }
  return filtered;
}

export async function crawl(common, custom) {
  const baseUrl = str(common?.base_url || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const vars = custom || {};
  const character = VALID_CHARACTERS.has(str(vars.character)) ? str(vars.character) : "";
  const type = VALID_TYPES.has(str(vars.type)) ? str(vars.type) : "";
  const sort = VALID_SORTS.has(str(vars.sort)) ? str(vars.sort) : "latest";

  log(`读取完整归档：${baseUrl}${ARCHIVE_PATH}`);
  const archive = await fetchJson(`${baseUrl}${ARCHIVE_PATH}`, "归档数据");
  const works = Array.isArray(archive?.works) ? archive.works : [];
  if (works.length === 0) throw new Error("archive-data.json 中没有作品，源站数据结构可能已变化");
  addProgress(3);

  let statsSnapshot = null;
  try {
    statsSnapshot = await fetchJson(`${baseUrl}${ANALYTICS_PATH}`, "公开统计");
  } catch (error) {
    warn(`[bluedafeiyu] 公开统计读取失败：${error?.message ?? error}`);
  }
  addProgress(2);

  const selected = filterAndSort(works, character, type, sort, statsSnapshot);
  log(
    `归档 ${works.length} 条，筛选后 ${selected.length} 条（角色=${character || "全部"}，类型=${type || "全部"}，排序=${sort}）`,
  );
  if (selected.length === 0) {
    addProgress(95);
    return;
  }

  const eachProgress = 95 / selected.length;
  for (const [index, work] of selected.entries()) {
    try {
      const metadata = buildMetadata(work, baseUrl, statsSnapshot);
      const originalUrl = metadata.media.original_url;
      if (!originalUrl) throw new Error("缺少原图 URL");
      const metadataId = Number(createImageMetadata(metadata, { searchTexts: buildSearchTexts(metadata) }));
      await downloadImage(originalUrl, {
        name: metadata.title || `${metadata.characters[0]?.name || "蓝色大肥鱼"} #${metadata.slug}`,
        url: metadata.page_url,
        metadata_id: metadataId,
        labels: buildLabels(work),
      });
      log(`  ${index + 1}/${selected.length} ${metadata.title || metadata.slug}`);
    } catch (error) {
      warn(`[bluedafeiyu] 作品 ${work?.slug || work?.id || index + 1} 失败：${error?.message ?? error}`);
    }
    addProgress(eachProgress);
  }
}

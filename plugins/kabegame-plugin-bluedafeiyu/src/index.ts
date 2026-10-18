// 蓝色大肥鱼 V8 爬虫。
//
// 源站的 /archive-data.json?v=2 一次返回完整作品表；页面端也是读取这份冻结数据后在浏览器内筛选，
// 不存在服务端分页。角色和类型选项与 Provider 都按源站公开 taxonomy 固定维护。
// 热度 / 下载量来自 /cms-api/analytics/public，排序规则与源站 archive/archive.js 一致：
// 分别按 views / downloads 降序，数值相同时保持归档原顺序。

import TinyPinyin from "tiny-pinyin";
import { sleep } from "@kabegame/plugin-sdk";
import { t } from "./i18n";

const { addProgress, createImageMetadata, downloadImage, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://xn--pssy23gqgbz2d718b.com";
const ARCHIVE_PATH = "/archive-data.json?v=2";
const ANALYTICS_PATH = "/cms-api/analytics/public";
const REQUEST_ATTEMPTS = 3;

const CHARACTER_NAMES: Record<string, string> = {
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

const TYPE_NAMES: Record<string, string> = {
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

// 站点 JSON 的最小结构：字段都可能缺失，只在确实依赖处收窄。全部用 type 而非 interface，
// 因为输出侧（metadata）最终要赋给 KabegameJsonValue，interface 没有隐式索引签名。
type BlueRole = {
  id?: string | null;
  name?: string | null;
};

type BlueWork = {
  id: string;
  slug?: string | null;
  n?: string | null;
  d?: string | null;
  cm?: string | null;
  cids?: string[] | null;
  k?: string[] | null;
  roles?: BlueRole[] | null;
  tg?: string[] | null;
  dt?: string | null;
  o?: string | null;
  l?: string | null;
  i?: string | null;
  w?: number | string | null;
  h?: number | string | null;
  f?: string | null;
  bytes?: number | string | null;
  s?: string | null;
  a?: string | null;
  ac?: boolean | number | null;
  sa?: string | null;
  su?: string | null;
  ok?: string | null;
  ln?: string | null;
  lk?: string | null;
  ls?: string | null;
  lt?: string | null;
  rights?: Record<string, KabegameJsonValue> | null;
};

type BlueArchive = {
  works?: BlueWork[] | null;
};

type BlueMetric = {
  views?: number | string | null;
  downloads?: number | string | null;
};

type BlueStatsSnapshot = {
  available?: boolean | null;
  stale?: boolean | null;
  limited?: boolean | null;
  startDate?: string | null;
  syncedAt?: string | null;
  works?: Record<string, BlueMetric> | null;
};

type BlueMetadataCharacter = {
  id: string;
  name: string;
};

type BlueMetadataType = {
  id: string;
  name: string;
};

// metadata 是对外输出结构（templates/description.ejs 与 providers 消费），字段全部为 JSON 可序列化值。
type BlueMetadata = {
  schema: number;
  work_id: string;
  slug: string;
  page_url: string;
  title: string;
  description: string;
  commentary: string;
  character_ids: string[];
  characters: BlueMetadataCharacter[];
  type_ids: string[];
  types: BlueMetadataType[];
  tags: string[];
  collected_at: string;
  media: {
    original_url: string;
    large_url: string;
    preview_url: string;
    width: number;
    height: number;
    format: string;
    bytes: number;
    formatted_size: string;
  };
  author: {
    name: string;
    credited: boolean;
    source_author: string;
  };
  source: {
    url: string;
    kind: string;
    note: string;
  };
  license: {
    key: string;
    short: string;
    title: string;
    note: string;
    rights: Record<string, KabegameJsonValue>;
  };
  stats: {
    available: boolean;
    views: number;
    downloads: number;
    start_date: string;
    synced_at: string;
    stale: boolean;
    limited: boolean;
  };
};

// 配置字段来自 GUI（可能有类型）或 CLI --var（一定是字符串），统一按 unknown 收窄
type BlueVars = {
  character?: unknown;
  type?: unknown;
  sort?: unknown;
};

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message != null) return String(message);
  }
  return String(error);
}

function str(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function absoluteUrl(value: unknown, baseUrl: string): string {
  const input = str(value);
  if (!input) return "";
  try {
    return new URL(input, baseUrl).href;
  } catch {
    return "";
  }
}

async function fetchJson<T = unknown>(url: string, label: string): Promise<T> {
  let lastError: unknown = null;
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
      // 外部 JSON 边界：响应体按调用方给出的接口形状断言
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < REQUEST_ATTEMPTS) {
        console.log(
          t("requestRetry", {
            label,
            delay: attempt * 700,
            attempt: attempt + 1,
            max: REQUEST_ATTEMPTS,
            error: errorMessage(error),
          }),
        );
        await sleep(attempt * 700);
      }
    }
  }
  throw new Error(t("requestFailed", { label, error: errorMessage(lastError) }));
}

function toPinyin(text: string): { converted: string; hasHan: boolean } {
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

function hashKey(text: string): string {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    hashA = Math.imul(hashA ^ codePoint, 0x01000193);
    hashB = Math.imul(hashB ^ codePoint, 0x85ebca6b);
  }
  return `u-${(hashA >>> 0).toString(36)}-${(hashB >>> 0).toString(36)}`;
}

function tagKey(value: unknown): string {
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

  const encoded = `u-${Array.from(text, (char) => (char.codePointAt(0) ?? 0).toString(36)).join("-")}`;
  return encoded.length <= 64 ? encoded : hashKey(text);
}

function buildLabels(work: BlueWork): KabegameLabelInput[] {
  const labels: KabegameLabelInput[] = [];
  const seen = new Set<string>();
  const push = (category: string, key: string, name: string): void => {
    if (!key || seen.has(`${category}\n${key}`)) return;
    seen.add(`${category}\n${key}`);
    labels.push({ category, key, name });
  };

  const roles: BlueRole[] = Array.isArray(work?.roles) ? work.roles : [];
  const roleById = new Map<string, BlueRole>(roles.map((role): [string, BlueRole] => [str(role?.id), role]));
  const characterIds: string[] = Array.isArray(work?.cids) ? work.cids : [];
  for (const characterId of characterIds) {
    const key = str(characterId).toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(key)) continue;
    push(LABEL_CHARACTER, key, str(roleById.get(key)?.name) || CHARACTER_NAMES[key] || key);
  }
  const tags: string[] = Array.isArray(work?.tg) ? work.tg : [];
  for (const tag of tags) {
    const name = str(tag);
    const key = tagKey(name);
    if (key) push(LABEL_TAG, key, name);
  }
  return labels;
}

function buildMetadata(work: BlueWork, baseUrl: string, statsSnapshot: BlueStatsSnapshot | null): BlueMetadata {
  const pageUrl = `${baseUrl}/works/${encodeURIComponent(str(work.slug))}.html`;
  const metrics = statsSnapshot?.available ? statsSnapshot?.works?.[work.id] : null;
  const characterIds: string[] = (Array.isArray(work?.cids) ? work.cids : []).map(str).filter(Boolean);
  const typeIds: string[] = (Array.isArray(work?.k) ? work.k : []).map(str).filter(Boolean);
  const roles: BlueMetadataCharacter[] = (Array.isArray(work?.roles) ? work.roles : []).map((role) => ({
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
      // 站点没有独立的 source note 字段；work.ln 是详情页显示在「授权状态」后的说明，
      // source.note 沿用同一段文字，license.note 才是它的语义归属。
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

function buildSearchTexts(metadata: BlueMetadata): string[] {
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

function shuffle<T>(list: T[]): void {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}

function filterAndSort(
  works: BlueWork[],
  character: string,
  type: string,
  sort: string,
  statsSnapshot: BlueStatsSnapshot | null,
): BlueWork[] {
  const filtered = works.filter((work) => {
    const characters: string[] = Array.isArray(work?.cids) ? work.cids : [];
    const types: string[] = Array.isArray(work?.k) ? work.k : [];
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
      warn(t("statsUnavailable", { sort: sort === "popular" ? t("sortPopular") : t("sortDownloads") }));
    }
  } else if (sort === "random") {
    shuffle(filtered);
  }
  return filtered;
}

export async function crawl(common: unknown, custom: Record<string, any> | null | undefined): Promise<void> {
  const cfg = (common || {}) as { baseUrl?: string | null };
  const baseUrl = str(cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const vars = (custom || {}) as BlueVars;
  const character = VALID_CHARACTERS.has(str(vars.character)) ? str(vars.character) : "";
  const type = VALID_TYPES.has(str(vars.type)) ? str(vars.type) : "";
  const sort = VALID_SORTS.has(str(vars.sort)) ? str(vars.sort) : "latest";

  console.log(t("readingArchive", { url: `${baseUrl}${ARCHIVE_PATH}` }));
  const archive = await fetchJson<BlueArchive>(`${baseUrl}${ARCHIVE_PATH}`, t("archiveLabel"));
  const works: BlueWork[] = Array.isArray(archive?.works) ? archive.works : [];
  if (works.length === 0) throw new Error(t("archiveEmpty"));
  addProgress(3);

  let statsSnapshot: BlueStatsSnapshot | null = null;
  try {
    statsSnapshot = await fetchJson<BlueStatsSnapshot>(`${baseUrl}${ANALYTICS_PATH}`, t("statsLabel"));
  } catch (error) {
    warn(t("statsReadFailed", { error: errorMessage(error) }));
  }
  addProgress(2);

  const selected = filterAndSort(works, character, type, sort, statsSnapshot);
  console.log(
    t("filterSummary", {
      total: works.length,
      selected: selected.length,
      character: character || t("all"),
      type: type || t("all"),
      sort,
    }),
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
      if (!originalUrl) throw new Error(t("missingOriginalUrl"));
      const metadataId = Number(createImageMetadata(metadata, { searchTexts: buildSearchTexts(metadata) }));
      const opts: KabegameDownloadImageOptions = {
        name: metadata.title || `${metadata.characters[0]?.name || "蓝色大肥鱼"} #${metadata.slug}`,
        url: metadata.page_url,
        metadata_id: metadataId,
        labels: buildLabels(work),
      };
      await downloadImage(originalUrl, opts);
      console.log(`[bluedafeiyu]   ${index + 1}/${selected.length} ${metadata.title || metadata.slug}`);
    } catch (error) {
      warn(t("workFailed", { work: work?.slug || work?.id || index + 1, error: errorMessage(error) }));
    }
    addProgress(eachProgress);
  }
}

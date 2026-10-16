// @ts-nocheck
// ManyACG V8 爬虫：筛选 / 语义搜索 / 相似作品 / 随机 四种互斥模式。
//
// 站点是 Nuxt 单页应用，数据全部来自 https://api.manyacg.top/v1 的 JSON 接口（无需登录、图片无防盗链），
// 所以不进页面。各接口的行为都经实测，规则如下，改动前请重新核对：
//   - /artwork/list    筛选：tag（只能一个完整标签名）、artist_id（24 位 ObjectID）、keyword 三者是 AND 关系，
//                      按入库时间倒序；page_size ≤ 200；越过最后一页或条件无结果都返回 404。
//   - hybrid=true      语义搜索：只认 keyword，tag / artist_id 会让结果全部不满足；总量封顶 1000 条；
//                      相邻页会有少量重复，必须按作品 ID 去重。
//   - similar_target   相似作品：只认作品 ID，其余筛选参数被忽略；没有自然终点（翻到第 50 页仍是满页）。
//   - /artwork/random  随机：只认 limit（≤ 200）与 r18，不能翻页，也不接受任何筛选。
//   - r18              0 仅全年龄 / 1 仅 R-18 / 2 混合，四种模式都生效。

import TinyPinyin from "tiny-pinyin";

const { addProgress, createImageMetadata, downloadImage, warn } = Kabegame;

const API_BASE = "https://api.manyacg.top/v1";
const DEFAULT_SITE = "https://manyacg.top";
const PAGE_SIZE = 50;
const RANDOM_MAX = 200;
const REQUEST_ATTEMPTS = 3;

// 标签画册：站点没有标签分类，所有标签归 tag，作者单独一类。
const LABEL_TAG = "manyacg/tag";
const LABEL_ARTIST = "manyacg/artist";

function log(message) {
  console.log(`[manyacg] ${message}`);
}

function str(value) {
  return value == null ? "" : String(value).trim();
}

// ---------------------------------------------------------------- 接口 ----

// 返回 { status, data }：404 表示「没有结果 / 越过最后一页」，由调用方当作正常结束；
// 400 等参数错误直接抛出（带服务端 message），其余失败重试几次后抛出。
async function apiGet(path, query) {
  const url = `${API_BASE}${path}?${new URLSearchParams(query)}`;
  let lastError = null;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return { status: 404, data: null };
      let body = null;
      try {
        body = await res.json();
      } catch {
        // 非 JSON 响应交给下面的状态码处理
      }
      if (res.status === 400) throw Object.assign(new Error(body?.message || "参数错误"), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, data: Array.isArray(body?.data) ? body.data : [] };
    } catch (e) {
      if (e?.fatal) throw e;
      lastError = e;
    }
  }
  throw new Error(`请求失败：${lastError?.message ?? lastError}`);
}

// ---------------------------------------------------------- label 与 key ----

// label key 只允许 [a-zA-Z0-9_-]、英文括号与空格（不在首尾、不连续），≤ 64 字节，且宿主只拒绝不修正。
// 站点标签中日英文混杂，按下列顺序派生，name 始终是站点原文（只在创建标签时生效）：
//   1. 纯 ASCII 且字符都合法的（danbooru 风格如 `klee_(genshin_impact)`）直接小写作 key；
//   2. 含汉字、且转成拼音后全是 ASCII 的，用拼音 key（与 haowallpaper 同款 tiny-pinyin，体积优先、不保证多音字，
//      同音不同字的标签会合并到同一个 key）；
//   3. 其余（假名、韩文、emoji，或带 `:o` 这类被剥掉字符就会撞名的）确定性编码为 u-<base36 码点>，
//      过长时回落双哈希。
const KEY_ALLOWED = /^[a-z0-9_\-() ]+$/;

// 汉字转拼音、其余原样保留；没有汉字时 hasHan 为 false，调用方据此决定是否走拼音路径。
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
    // ICU 不可用时放弃拼音，交给下面的编码兜底
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
  const encoded = `u-${Array.from(text, (ch) => ch.codePointAt(0).toString(36)).join("-")}`;
  return encoded.length <= 64 ? encoded : hashKey(text);
}

// 作者以平台 + UID 作 key（不随改名变化）；缺 UID 时退回站内 ObjectID。
function artistKey(artist) {
  const platform = str(artist?.type).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const uid = str(artist?.uid).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const key = platform && uid ? `${platform}-${uid}` : str(artist?.id).toLowerCase();
  return key && key.length <= 64 ? key : "";
}

function buildLabels(art) {
  const labels = [];
  const seen = new Set();
  const push = (category, key, name) => {
    if (!key) return;
    const id = `${category}\n${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    labels.push({ key, category, name: name || key });
  };
  if (art.artist) push(LABEL_ARTIST, artistKey(art.artist), str(art.artist.name));
  for (const tag of art.tags || []) push(LABEL_TAG, tagKey(tag), str(tag));
  return labels;
}

// ------------------------------------------------------------ metadata ----

// metadata 存足以还原源站详情页的稳定字段（templates/description.ejs 消费）：
// 标题、作者与来源、简介、标签、各图尺寸。like_count 站点现在恒为 0，但仍是详情页的数据，照存。
function buildMetadata(art, pageUrl) {
  const artist = art.artist || {};
  return {
    schema: 1,
    artwork_id: str(art.id),
    page_url: pageUrl,
    title: str(art.title),
    description: str(art.description),
    source_url: str(art.source_url),
    source_type: str(art.source_type),
    r18: !!art.r18,
    like_count: Number(art.like_count) || 0,
    created_at: str(art.created_at),
    tags: (art.tags || []).map(str).filter(Boolean),
    artist: {
      id: str(artist.id),
      name: str(artist.name),
      type: str(artist.type),
      uid: str(artist.uid),
      username: str(artist.username),
    },
    pictures: (art.pictures || []).map((p) => ({
      id: str(p.id),
      index: Number(p.index) || 0,
      width: Number(p.width) || 0,
      height: Number(p.height) || 0,
      file_name: str(p.file_name),
      hash: str(p.hash),
      regular: str(p.regular),
      thumbnail: str(p.thumbnail),
    })),
  };
}

// 元数据搜索片段：manyacg、全部标签、作品名、作者名、平台名（pixiv / twitter 等）、平台作者名（去掉 @）、入库日期。
// metadata_migrations/migrate.js 的 provideSearchTextList 有一份同规则副本，改这里要同步改那里。
function searchTextsFromMetadata(meta) {
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

function displayName(art, index, total) {
  const base = str(art.title) || `${str(art.artist?.name) || "ManyACG"} #${str(art.id).slice(-6)}`;
  return total > 1 ? `${base} (${index + 1}/${total})` : base;
}

// ---------------------------------------------------------------- 下载 ----

async function downloadArtwork(art, siteBase) {
  const pictures = (art.pictures || [])
    .filter((p) => p?.regular)
    .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
  if (pictures.length === 0) {
    warn(`[manyacg] 作品 ${art?.id} 没有可下载的图片，跳过`);
    return 0;
  }
  const pageUrl = `${siteBase}/artwork/${art.id}`;
  // 一个作品的多张图共用同一行 metadata。
  const metadata = buildMetadata(art, pageUrl);
  const metadataId = Number(createImageMetadata(metadata, { searchTexts: searchTextsFromMetadata(metadata) }));
  const labels = buildLabels(art);
  for (const [index, picture] of pictures.entries()) {
    const opts = { name: displayName(art, index, pictures.length), url: pageUrl, metadata_id: metadataId };
    if (labels.length > 0) opts.labels = labels;
    await downloadImage(picture.regular, opts);
  }
  return pictures.length;
}

// 逐个处理一批作品，按作品数摊分 pct 进度；单个作品失败只 warn，不中断任务。
async function processArtworks(list, seen, siteBase, pct, bump) {
  const fresh = list.filter((art) => art?.id && !seen.has(art.id));
  const skipped = list.length - fresh.length;
  if (skipped > 0) log(`  去掉本次任务内已出现过的 ${skipped} 个作品`);
  if (fresh.length === 0) {
    bump(pct);
    return;
  }
  const each = pct / fresh.length;
  for (const [i, art] of fresh.entries()) {
    seen.add(art.id);
    try {
      const count = await downloadArtwork(art, siteBase);
      log(`  ${i + 1}/${fresh.length} ${str(art.title) || art.id}：${count} 张`);
    } catch (e) {
      warn(`[manyacg] 作品 ${art.id} 失败：${e?.message ?? e}`);
    }
    bump(each);
  }
}

// ---------------------------------------------------------------- 入口 ----

// 粘贴链接或直接填 ID 都行：取第一个 24 位十六进制串。
function parseObjectId(input) {
  const match = str(input).match(/[0-9a-f]{24}/i);
  return match ? match[0].toLowerCase() : "";
}

export async function crawl(common, custom) {
  const siteBase = str(common?.base_url || DEFAULT_SITE).replace(/\/+$/, "");
  const vars = custom || {};
  const mode = ["semantic", "similar", "random"].includes(vars.mode) ? vars.mode : "filter";
  const r18 = ["0", "1", "2"].includes(str(vars.r18)) ? str(vars.r18) : "0";

  // 进度累计：提前结束时补满到 100。
  let progressed = 0;
  const bump = (pct) => {
    progressed += pct;
    addProgress(pct);
  };
  const finish = () => {
    if (progressed < 100) addProgress(100 - progressed);
  };
  const seen = new Set();

  if (mode === "random") {
    const limit = Math.min(RANDOM_MAX, Math.max(1, Number(vars.count ?? 30) || 30));
    log(`随机模式：${limit} 个作品（r18=${r18}）`);
    try {
      const { data } = await apiGet("/artwork/random", { limit: String(limit), r18 });
      await processArtworks(data || [], seen, siteBase, 100, bump);
    } catch (e) {
      warn(`[manyacg] 随机读取失败：${e?.message ?? e}`);
    }
    finish();
    return;
  }

  // 列表类三种模式：只把该模式认的参数放进 query，其余一律不传（实测其它参数要么被忽略、要么破坏结果）。
  const query = { r18, page_size: String(PAGE_SIZE) };
  let title = "";
  if (mode === "semantic") {
    const keyword = str(vars.keyword);
    if (!keyword) {
      warn("[manyacg] 语义搜索必须填写关键词");
      finish();
      return;
    }
    query.keyword = keyword;
    query.hybrid = "true";
    title = `语义搜索「${keyword}」`;
  } else if (mode === "similar") {
    const id = parseObjectId(vars.artwork);
    if (!id) {
      warn("[manyacg] 相似作品模式需要填写参考作品的链接或 24 位 ID");
      finish();
      return;
    }
    query.similar_target = id;
    title = `相似作品 ${id}`;
  } else {
    const parts = [];
    const tag = str(vars.tag);
    const keyword = str(vars.keyword);
    if (tag) {
      query.tag = tag;
      parts.push(`标签「${tag}」`);
    }
    if (str(vars.artist)) {
      const artistId = parseObjectId(vars.artist);
      // 填了作者却解析不出 ID 时不能悄悄忽略，否则会变成抓全站。
      if (!artistId) {
        warn("[manyacg] 作者需要填写作者页链接或 24 位作者 ID（Pixiv / Twitter 的用户 ID 不能用）");
        finish();
        return;
      }
      query.artist_id = artistId;
      parts.push(`作者 ${artistId}`);
    }
    if (keyword) {
      query.keyword = keyword;
      parts.push(`关键词「${keyword}」`);
    }
    title = parts.length > 0 ? `筛选：${parts.join(" + ")}` : "筛选：最新";
  }

  const startPage = Math.max(1, Number(vars.start_page ?? 1) || 1);
  const endPage = Math.max(startPage, Number(vars.end_page ?? startPage) || startPage);
  const pctPerPage = 100 / (endPage - startPage + 1);
  log(`${title}，r18=${r18}，第 ${startPage}~${endPage} 页（每页 ${PAGE_SIZE}）`);

  for (let page = startPage; page <= endPage; page += 1) {
    let list;
    try {
      ({ data: list } = await apiGet("/artwork/list", { ...query, page: String(page) }));
    } catch (e) {
      warn(`[manyacg] 第 ${page} 页读取失败：${e?.message ?? e}`);
      bump(pctPerPage);
      continue;
    }
    // 404 或空页：没有更多结果（条件无匹配 / 越过最后一页 / 语义搜索到 1000 条上限）。
    if (!list || list.length === 0) {
      log(`第 ${page} 页没有结果，已到末尾`);
      break;
    }
    log(`┌ 第 ${page} 页：${list.length} 个作品`);
    await processArtworks(list, seen, siteBase, pctPerPage, bump);
    log(`└ 第 ${page} 页完成`);
    // 不能按「不满一页」判断末页：语义搜索的中间页也可能比 page_size 少几条（实测 200 → 199），
    // 只认 404 / 空页。
  }
  finish();
}

// anime-pictures V8 crawler：列表 / 详情走 api.anime-pictures.net 的 JSON API，原图走 oimages 直链。
// 站点 HTML 页（/posts、/posts/<id>）受 Cloudflare 挑战，API 与 oimages 不受，因此无需畅游 Cookie。
// metadata 仍产出 schema 1 结构（title / author / details / rating / tagGroups），
// 与 HTML 解析时代的字段与文案一致，description.ejs / migrate.js / providers 无需改动。
import { sleep } from "@kabegame/plugin-sdk";
import { t } from "./i18n";
import { searchTextsFromMetadata } from "./search-texts";

const { addProgress, downloadImage, setHeader, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://anime-pictures.net";
const API_BASE = "https://api.anime-pictures.net/api/v3";
const IMAGE_BASE = "https://oimages.anime-pictures.net";
const AVATAR_BASE = "https://oavatars.anime-pictures.net";
// 站点语言与时区：决定分组名 / 详情文案的语言和日期显示，与历史 metadata 保持一致
const LANG = "zh-cn";
const TZ_OFFSET_HOURS = 9; // Asia/Tokyo，无夏令时
const POST_INTERVAL_MS = 5000;
const DEFAULT_POSTS_PER_PAGE = 80;
const ORDER_BY_VALUES = new Set(["date", "date_r", "rating", "views", "size", "tag_num", "stars_date"]);

// 站点 JSON 的最小结构：字段都可能缺失，只在确实依赖处收窄。
// 输出侧（metadata）必须保持 JSON 可序列化，所以全部用 type 而非 interface。
type AnimePicturesApiPost = {
  id: number;
  md5?: string | null;
  ext?: string | null;
  datetime?: string | null;
  pubtime?: string | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
  download_count?: number | null;
  color?: number[] | null;
  score_number?: number | null;
};

type AnimePicturesApiUser = {
  id: number;
  name?: string | null;
  isavatar?: boolean | number | null;
  avatar_version?: number | null;
};

type AnimePicturesApiModerator = {
  id?: number | null;
  name?: string | null;
};

type AnimePicturesApiTag = {
  tag?: {
    tag?: string | null;
    type?: number | null;
    num?: number | null;
  } | null;
  user?: { name?: string | null } | null;
};

type AnimePicturesApiDetail = {
  post: AnimePicturesApiPost;
  user?: AnimePicturesApiUser | null;
  moderator?: AnimePicturesApiModerator | null;
  source?: { url?: string | null } | null;
  tags?: AnimePicturesApiTag[] | null;
  original_download_blocked?: boolean | null;
};

type AnimePicturesListResponse = {
  posts?: Array<{ id?: number }> | null;
  posts_count?: number | null;
  max_pages?: number | null;
};

type AnimePicturesDetailLink = {
  text: string;
  url: string;
};

type AnimePicturesDetailItem = {
  text: string;
  links?: AnimePicturesDetailLink[];
  color?: string;
};

type AnimePicturesTag = {
  name: string;
  url: string;
  type: string;
  count: string;
  by?: string;
};

type AnimePicturesTagGroup = {
  name: string;
  tags: AnimePicturesTag[];
};

type AnimePicturesAuthor = {
  name: string;
  profileUrl: string;
  avatarUrl: string;
};

type AnimePicturesMetadata = {
  schema: number;
  title: string;
  author: AnimePicturesAuthor | null;
  details: AnimePicturesDetailItem[];
  rating: { label: string; count: string };
  tagGroups: AnimePicturesTagGroup[];
};

type Rgb = [number, number, number];

const REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  // kira=1：oimages 原图的放行 Cookie，缺了会 302 回站点主页
  Cookie: "sitelang=zh-cn; time_zone=Asia%2FTokyo; kira=1",
};

function setRequestHeaders() {
  for (const [key, value] of Object.entries(REQUEST_HEADERS)) {
    setHeader(key, value);
  }
}

function log(message: unknown, level?: string): void {
  if (level === "warn") {
    warn(String(message ?? ""));
    return;
  }
  console.log(String(message ?? ""));
}

function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message != null) return String(message);
  }
  return String(error);
}

async function fetchJson<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(t("httpError", { status: res.status, url }));
  }
  return (await res.json()) as T;
}

// ── 站点前端规则的移植 ──────────────────────────────────────────────

// 标签类型编号 → HTML 时代的 class（3 / 5 / 6 三种版权同为 copyright，0 未知不归类）
const TAG_TYPE_CLASS: Record<number, string> = {
  0: "",
  1: "character",
  2: "reference",
  3: "copyright",
  4: "artist",
  5: "copyright",
  6: "copyright",
  7: "object",
};

// 标签类型编号 → 站点 zh-cn 文案（分组名）
const TAG_TYPE_NAME: Record<number, string> = {
  0: "未知",
  1: "角色",
  2: "参考",
  3: "版权（作品）",
  4: "作者",
  5: "游戏版权",
  6: "其他版权",
  7: "物体",
};

// 站点的主色调色板与 redmean 距离，按最近色取颜色名
const COLOR_PALETTE: Array<[Rgb, string]> = [
  [[0, 0, 0], "black"],
  [[255, 255, 255], "white"],
  [[128, 0, 0], "maroon"],
  [[255, 0, 0], "red"],
  [[128, 0, 128], "purple"],
  [[255, 0, 255], "fuchsia/pink"],
  [[0, 128, 0], "green"],
  [[0, 255, 0], "lime"],
  [[128, 128, 0], "olive"],
  [[255, 255, 0], "yellow"],
  [[0, 0, 128], "navy"],
  [[0, 0, 255], "blue"],
  [[0, 128, 128], "teal"],
  [[0, 255, 255], "aqua"],
  [[255, 128, 0], "orange"],
  [[176, 23, 31], "indian red"],
  [[220, 20, 60], "crimson"],
  [[255, 182, 193], "lightpink"],
  [[255, 192, 203], "pink"],
  [[219, 112, 147], "palevioletred"],
  [[75, 0, 130], "indigo"],
];

function colorDistance(a: Rgb, b: Rgb): number {
  const mean = Math.trunc((a[0] + b[0]) / 2);
  const r = a[0] - b[0];
  const g = a[1] - b[1];
  const bl = a[2] - b[2];
  return Math.sqrt((((512 + mean) * r * r) >> 8) + 4 * g * g + (((767 - mean) * bl * bl) >> 8));
}

function colorName(rgb: Rgb): string {
  let best = COLOR_PALETTE[0];
  let bestDist = colorDistance(best[0], rgb);
  for (const entry of COLOR_PALETTE.slice(1)) {
    const d = colorDistance(entry[0], rgb);
    if (d < bestDist) {
      best = entry;
      bestDist = d;
    }
  }
  return best[1];
}

// 标签计数缩写：564335 → "564K"
function shortCount(n: unknown): string {
  const value = Number(n);
  const units = ["", "K", "M"];
  if (!(value > 0)) return "0";
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1000)), units.length - 1);
  return `${(value / 1000 ** i).toFixed(0)}${units[i]}`;
}

// 文件大小：5546011 → "5.29MB"
function formatBytes(n: unknown): string {
  const value = Number(n);
  if (!(value > 0)) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${Number((value / 1024 ** i).toFixed(2))}${units[i]}`;
}

// API 时间为无时区标记的 UTC；按站点时区显示为 "YYYY/MM/DD HH:mm"
function formatDate(iso: unknown): string {
  const raw = coerceStr(iso);
  if (!raw) return "";
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms + TZ_OFFSET_HOURS * 3600 * 1000);
  const pad = (v: number): string => String(v).padStart(2, "0");
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function siteUrl(path: string, params?: Iterable<readonly [string, string]>): string {
  const url = new URL(path, DEFAULT_BASE_URL);
  for (const [k, v] of params || []) url.searchParams.set(k, v);
  url.searchParams.set("lang", LANG);
  return url.toString();
}

function profileUrl(userId: number): string {
  return `${DEFAULT_BASE_URL}/profile/${userId}?lang=${LANG}`;
}

function avatarUrl(user: AnimePicturesApiUser | null | undefined): string {
  if (!user?.isavatar) return "";
  return `${AVATAR_BASE}/${Math.floor(user.id / 1000)}/${user.id}.png?v=${user.avatar_version ?? 0}`;
}

// ── 列表 / 详情 / 原图 ──────────────────────────────────────────────

function listApiUrl(page: number, tag: string, postsPerPage: number, orderBy: string): string {
  const url = new URL(`${API_BASE}/posts`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("lang", LANG);
  url.searchParams.set("posts_per_page", String(postsPerPage));
  url.searchParams.set("order_by", orderBy);
  if (tag) url.searchParams.set("search_tag", tag);
  return url.toString();
}

function detailApiUrl(id: number): string {
  return `${API_BASE}/posts/${id}?lang=${LANG}`;
}

function postPageUrl(id: number): string {
  return `${DEFAULT_BASE_URL}/posts/${id}?lang=${LANG}`;
}

function originalUrl(post: AnimePicturesApiPost | null | undefined): string {
  const md5 = coerceStr(post?.md5);
  const ext = coerceStr(post?.ext);
  if (!/^[0-9a-f]{32}$/.test(md5) || !ext) return "";
  return `${IMAGE_BASE}/${md5.slice(0, 3)}/${md5}${ext}`;
}

// ── metadata（schema 1） ─────────────────────────────────────────────

// 分组按首次出现顺序、组内保持 API 顺序（与站点详情页一致）
function buildTagGroups(tags: AnimePicturesApiTag[] | null | undefined): AnimePicturesTagGroup[] {
  const groups: AnimePicturesTagGroup[] = [];
  const byType = new Map<number, AnimePicturesTagGroup>();
  for (const item of tags || []) {
    const t = item?.tag;
    if (!t) continue;
    const name = coerceStr(t.tag).trim();
    if (!name) continue;
    const typeCode = t.type ?? -1;
    let group = byType.get(typeCode);
    if (!group) {
      group = { name: TAG_TYPE_NAME[typeCode] ?? "", tags: [] };
      byType.set(typeCode, group);
      groups.push(group);
    }
    const tag: AnimePicturesTag = {
      name,
      url: siteUrl("/posts", [
        ["page", "0"],
        ["search_tag", name],
      ]),
      type: TAG_TYPE_CLASS[typeCode] ?? "",
      count: shortCount(t.num),
    };
    const by = coerceStr(item.user?.name).trim();
    if (by) tag.by = by;
    group.tags.push(tag);
  }
  return groups;
}

function buildDetails(detail: AnimePicturesApiDetail): AnimePicturesDetailItem[] {
  const post = detail.post;
  const details: AnimePicturesDetailItem[] = [];
  const width = Number(post.width);
  const height = Number(post.height);
  const size = Number(post.size);

  const moderator = detail.moderator;
  if (moderator?.name) {
    details.push({
      text: `当前状态设定者: ${moderator.name}`,
      links: [{ text: moderator.name, url: `${DEFAULT_BASE_URL}/profile/${moderator.id}` }],
    });
  }
  const uploaded = formatDate(post.datetime);
  if (uploaded) details.push({ text: `上传日期: ${uploaded}` });
  const published = formatDate(post.pubtime);
  if (published) details.push({ text: `发布日期: ${published}` });

  if (width > 0 && height > 0) {
    const res = `${width}x${height}`;
    const aspect = (width / height).toFixed(2);
    details.push({
      text: `${res} ${aspect}`,
      links: [
        {
          text: res,
          url: siteUrl("/posts/", [
            ["page", "0"],
            ["res_x", String(width)],
            ["res_y", String(height)],
          ]),
        },
        {
          text: aspect,
          url: siteUrl("/posts", [
            ["page", "0"],
            ["aspect", aspect],
          ]),
        },
      ],
    });
  }
  if (size > 0) {
    details.push({ text: `${formatBytes(size)} ${post.download_count ?? 0}` });
  }

  const rgb: Rgb | null = Array.isArray(post.color) && post.color.length === 3
    ? [Number(post.color[0]), Number(post.color[1]), Number(post.color[2])]
    : null;
  if (rgb) {
    const name = colorName(rgb);
    const css = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    details.push({
      text: `${name} ${css}`,
      links: [
        {
          text: name,
          url: siteUrl("/posts", [
            ["page", "0"],
            ["color", `${rgb.join("_")}_30`],
          ]),
        },
      ],
      color: css,
    });
  }

  const sourceUrl = coerceStr(detail.source?.url).trim();
  if (sourceUrl) {
    details.push({ text: `来源: ${sourceUrl}`, links: [{ text: sourceUrl, url: sourceUrl }] });
  }
  return details;
}

function buildMetadata(detail: AnimePicturesApiDetail, tagGroups: AnimePicturesTagGroup[]): AnimePicturesMetadata {
  const post = detail.post;
  const user = detail.user;
  const firstCopyright = tagGroups.flatMap((g) => g.tags).find((t) => t.type === "copyright");
  return {
    schema: 1,
    title: ["动漫图片", firstCopyright?.name, `№${post.id}`].filter(Boolean).join(" "),
    author: user ? { name: coerceStr(user.name), profileUrl: profileUrl(user.id), avatarUrl: avatarUrl(user) } : null,
    details: buildDetails(detail),
    rating: { label: "评分：", count: String(post.score_number ?? 0) },
    tagGroups,
  };
}

// 展示名：作品 / 角色 / 画师
function pickDisplayName(tagGroups: AnimePicturesTagGroup[]): string {
  const tags = tagGroups.flatMap((g) => g.tags);
  const first = (type: string): string => tags.find((t) => t.type === type)?.name || "";
  const titleSeg = [first("copyright"), first("character")].filter(Boolean).join(" / ");
  return [titleSeg, first("artist")].filter(Boolean).join(" / ");
}

// 标签画册：把作品 / 角色 / 画师 / 参考 / 物体五类 tag 映射为应用标签，各自一个目录；没有类型的 tag 不写入。
// key 由 tag 名派生（小写、丢弃 key 字符集之外的字符、空白折叠为单个空格并去首尾），
// 保留 `sua (alien stage)` 这类原样的空格与括号；派生后为空或超长的直接跳过，
// 不做别的修正。metadata_migrations/migrate.js 的 provideLabels 有一份同规则的副本（迁移运行在
// 无 import 的裸 V8 里），改这里要同步改那里。
const LABEL_TAG_TYPES = ["copyright", "character", "artist", "reference", "object"];

function tagLabelKey(name: unknown): string {
  const key = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

function labelsFromTagGroups(tagGroups: AnimePicturesTagGroup[]): KabegameLabelInput[] {
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

// ── 主流程 ───────────────────────────────────────────────────────────

async function crawlPost(id: number, index: number, total: number, weight: number): Promise<void> {
  try {
    const detail = await fetchJson<AnimePicturesApiDetail>(detailApiUrl(id));
    const post = detail?.post;
    const downloadUrl = originalUrl(post);
    if (!downloadUrl) {
      log(t("postMissingSource", { index, total, id }), "warn");
      return;
    }
    if (detail.original_download_blocked) {
      log(t("postDownloadBlocked", { index, total, id }), "warn");
      return;
    }

    const tagGroups = buildTagGroups(detail.tags);
    const metadata = buildMetadata(detail, tagGroups);
    const displayName = pickDisplayName(tagGroups);
    log(
      t("postReady", {
        index,
        total,
        id,
        width: post.width,
        height: post.height,
        tagCount: tagGroups.reduce((n, g) => n + g.tags.length, 0),
        displayName: JSON.stringify(displayName || t("emptyValue")),
      }),
    );

    // 任务请求头（含 kira=1 Cookie）会随 downloadImage 一并发给 oimages
    const opts: KabegameDownloadImageOptions = {
      url: postPageUrl(id),
      metadata,
      searchTexts: searchTextsFromMetadata(metadata),
    };
    if (displayName) opts.name = displayName;
    const labels = labelsFromTagGroups(tagGroups);
    if (labels.length > 0) opts.labels = labels;
    await downloadImage(downloadUrl, opts);
  } catch (e) {
    log(t("postFailed", { index, total, id, error: errorMessage(e) }), "warn");
  } finally {
    addProgress(weight);
  }
}

export async function crawl(_common: unknown, custom: Record<string, unknown> | null | undefined): Promise<void> {
  setRequestHeaders();

  const startPage = Number(custom?.startPage ?? 0);
  const endPage = Number(custom?.endPage ?? startPage);
  const tag = coerceStr(custom?.tag).trim();
  const postsPerPage = Number(custom?.postsPerPage ?? DEFAULT_POSTS_PER_PAGE);
  const orderBy = coerceStr(custom?.orderBy ?? "date") || "date";

  if (!Number.isInteger(postsPerPage) || postsPerPage < 1 || postsPerPage > 100) {
    throw new Error(t("postsPerPageInvalid"));
  }
  if (!ORDER_BY_VALUES.has(orderBy)) {
    throw new Error(t("orderByInvalid", { orderBy }));
  }

  if (endPage >= startPage + 100) {
    throw new Error(t("pageRangeTooLarge"));
  }
  if (endPage < startPage) {
    throw new Error(t("endPageBeforeStart"));
  }

  const totalPages = endPage - startPage + 1;
  const pageProgress = 100 / totalPages;
  log(
    t("crawlStart", {
      startPage,
      endPage,
      postsPerPage,
      orderBy,
      tag: tag || t("emptyValue"),
    }),
  );

  for (let page = startPage; page <= endPage; page += 1) {
    await sleep(2000);
    const list = await fetchJson<AnimePicturesListResponse>(listApiUrl(page, tag, postsPerPage, orderBy));
    const ids = (list.posts ?? [])
      .map((p) => p?.id)
      .filter((id): id is number => Number.isInteger(id));
    log(
      t("pageImages", {
        page,
        count: ids.length,
        total: list?.posts_count ?? "?",
        maxPage: list?.max_pages ?? "?",
      }),
    );

    if (ids.length === 0) {
      addProgress(pageProgress);
      const maxPages = list.max_pages;
      if (typeof maxPages === "number" && Number.isInteger(maxPages) && page >= maxPages) {
        log(t("lastPageReached", { maxPage: maxPages }));
        addProgress(pageProgress * (endPage - page));
        break;
      }
      continue;
    }

    const itemProgress = pageProgress / ids.length;
    for (let i = 0; i < ids.length; i += 1) {
      // oimages 对原图下载限流（429），每张间隔 5s，与 HTML 时代的实际节奏相当
      await sleep(POST_INTERVAL_MS);
      await crawlPost(ids[i], i + 1, ids.length, itemProgress);
    }
  }

  log(t("crawlDone"));
}

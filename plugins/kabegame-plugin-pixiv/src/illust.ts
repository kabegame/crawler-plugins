// 单个作品：详情、评论、标签、metadata 与全部分页原图下载。各模式只负责产出作品 id。
import { coerceStr, fetchJson } from "./common";
import { t } from "./i18n";

const { createImageMetadata, downloadImage, setHeader, warn } = Kabegame;

// 站点 JSON 的最小结构：字段都可能缺失，只在确实依赖处收窄。metadata 要能赋给
// KabegameJsonValue，所以全部用 type 而非 interface（interface 没有隐式索引签名）。
type PixivTagTranslation = {
  en?: string | null;
};

type PixivTag = {
  tag?: string | null;
  translation?: PixivTagTranslation | null;
};

type PixivTagList = {
  tags?: PixivTag[] | null;
  authorId?: string | null;
};

type PixivIllustBody = {
  illustId?: string | null;
  id?: string | null;
  title?: string | null;
  illustTitle?: string | null;
  description?: string | null;
  illustComment?: string | null;
  userId?: string | null;
  userName?: string | null;
  uploadDate?: string | null;
  createDate?: string | null;
  bookmarkCount?: number | null;
  likeCount?: number | null;
  viewCount?: number | null;
  tags?: PixivTagList | null;
};

type PixivComment = {
  userName?: string | null;
  comment?: string | null;
};

type PixivIllustResponse = {
  body?: PixivIllustBody | null;
};

type PixivPage = {
  urls?: { original?: string | null } | null;
};

// filter 收窄后的分页项：original 一定有值，后续不再重复判空。
type PixivPageWithUrl = {
  urls: { original: string };
};

type PixivPagesResponse = {
  body?: PixivPage[] | null;
};

type PixivCommentsResponse = {
  error?: boolean | null;
  body?: { comments?: PixivComment[] | null } | null;
};

// downloadIllust 写入 metadata 的两种形态：有详情时带 body + 评论，没有详情时只记 id。
type PixivMetadata = { body: PixivIllustBody; comments: PixivComment[] } | { illustId: string };

function pixivTrimIllustBody(body: PixivIllustBody): PixivIllustBody {
  return {
    illustId: body?.illustId,
    id: body?.id,
    title: body?.title,
    illustTitle: body?.illustTitle,
    description: body?.description,
    illustComment: body?.illustComment,
    userId: body?.userId,
    userName: body?.userName,
    uploadDate: body?.uploadDate,
    createDate: body?.createDate,
    bookmarkCount: body?.bookmarkCount,
    likeCount: body?.likeCount,
    viewCount: body?.viewCount,
    tags: body?.tags,
  };
}

// 标签画册：Pixiv 的 tag 字段是站点默认的原始名（通常为日语），translation.en 是适合生成
// ASCII key 的英文翻译。key 与 name 必须分开：key 优先取英文翻译；英文翻译缺失时，ASCII 原始名
// 直接规范化，假名转写为罗马字，剩余非 ASCII 字符确定性编码为 u-<base36 code points>（过长时
// 回落双哈希）。name 保留原始名，缺失时依次回落英文翻译与 key。作者以不会随改名变化的 UID 作 key。
// metadata_migrations/migrate.js 的 provideLabels 有一份同规则的副本（迁移运行在无 import 的裸 V8 里），
// 改这里要同步改那里。
const PIXIV_KANA_ROMAJI: Record<string, string> = {
  ぁ: "a",
  あ: "a",
  ぃ: "i",
  い: "i",
  ぅ: "u",
  う: "u",
  ぇ: "e",
  え: "e",
  ぉ: "o",
  お: "o",
  か: "ka",
  が: "ga",
  き: "ki",
  ぎ: "gi",
  く: "ku",
  ぐ: "gu",
  け: "ke",
  げ: "ge",
  こ: "ko",
  ご: "go",
  さ: "sa",
  ざ: "za",
  し: "shi",
  じ: "ji",
  す: "su",
  ず: "zu",
  せ: "se",
  ぜ: "ze",
  そ: "so",
  ぞ: "zo",
  た: "ta",
  だ: "da",
  ち: "chi",
  ぢ: "ji",
  つ: "tsu",
  づ: "zu",
  て: "te",
  で: "de",
  と: "to",
  ど: "do",
  な: "na",
  に: "ni",
  ぬ: "nu",
  ね: "ne",
  の: "no",
  は: "ha",
  ば: "ba",
  ぱ: "pa",
  ひ: "hi",
  び: "bi",
  ぴ: "pi",
  ふ: "fu",
  ぶ: "bu",
  ぷ: "pu",
  へ: "he",
  べ: "be",
  ぺ: "pe",
  ほ: "ho",
  ぼ: "bo",
  ぽ: "po",
  ま: "ma",
  み: "mi",
  む: "mu",
  め: "me",
  も: "mo",
  ゃ: "ya",
  や: "ya",
  ゅ: "yu",
  ゆ: "yu",
  ょ: "yo",
  よ: "yo",
  ら: "ra",
  り: "ri",
  る: "ru",
  れ: "re",
  ろ: "ro",
  ゎ: "wa",
  わ: "wa",
  ゐ: "i",
  ゑ: "e",
  を: "wo",
  ん: "n",
  ゔ: "vu",
  ゕ: "ka",
  ゖ: "ke",
};

const PIXIV_KANA_PAIR_ROMAJI: Record<string, string> = {
  きゃ: "kya",
  きゅ: "kyu",
  きょ: "kyo",
  ぎゃ: "gya",
  ぎゅ: "gyu",
  ぎょ: "gyo",
  しゃ: "sha",
  しゅ: "shu",
  しょ: "sho",
  じゃ: "ja",
  じゅ: "ju",
  じょ: "jo",
  ちゃ: "cha",
  ちゅ: "chu",
  ちょ: "cho",
  ぢゃ: "ja",
  ぢゅ: "ju",
  ぢょ: "jo",
  にゃ: "nya",
  にゅ: "nyu",
  にょ: "nyo",
  ひゃ: "hya",
  ひゅ: "hyu",
  ひょ: "hyo",
  びゃ: "bya",
  びゅ: "byu",
  びょ: "byo",
  ぴゃ: "pya",
  ぴゅ: "pyu",
  ぴょ: "pyo",
  みゃ: "mya",
  みゅ: "myu",
  みょ: "myo",
  りゃ: "rya",
  りゅ: "ryu",
  りょ: "ryo",
  うぃ: "wi",
  うぇ: "we",
  うぉ: "wo",
  ゔぁ: "va",
  ゔぃ: "vi",
  ゔぇ: "ve",
  ゔぉ: "vo",
  しぇ: "she",
  じぇ: "je",
  ちぇ: "che",
  てぃ: "ti",
  てぅ: "tu",
  でぃ: "di",
  でぅ: "du",
  とぅ: "tu",
  どぅ: "du",
  ふぁ: "fa",
  ふぃ: "fi",
  ふぇ: "fe",
  ふぉ: "fo",
  ふゅ: "fyu",
};

function pixivHiragana(char: string): string {
  const codePoint = char.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x30a1 && codePoint <= 0x30f6
    ? String.fromCodePoint(codePoint - 0x60)
    : char;
}

function pixivKanaUnit(chars: string[], index: number): { value: string; length: number } | null {
  if (!chars[index]) return null;
  const first = pixivHiragana(chars[index]);
  const second = index + 1 < chars.length
    ? pixivHiragana(chars[index + 1])
    : "";
  const pair = PIXIV_KANA_PAIR_ROMAJI[first + second];
  if (pair) return { value: pair, length: 2 };
  const single = PIXIV_KANA_ROMAJI[first];
  return single ? { value: single, length: 1 } : null;
}

function pixivAppendKeyPart(
  state: { value: string; kind: string },
  value: string,
  kind: string,
): void {
  if (!value) return;
  if (
    state.value && state.kind !== kind && /[a-z0-9]$/.test(state.value) &&
    /^[a-z0-9]/.test(value)
  ) {
    state.value += "-";
  }
  state.value += value;
  state.kind = kind;
}

function pixivLabelKey(value: unknown): string {
  const key = coerceStr(value)
    .replace(/[ー—―]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

function pixivOriginalTagKey(value: unknown): string {
  const normalized = coerceStr(value).normalize("NFKC").replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (!/[^\x00-\x7f]/.test(normalized)) return pixivLabelKey(normalized);

  const chars = Array.from(normalized);
  const state = { value: "", kind: "" };
  for (let index = 0; index < chars.length;) {
    const char = chars[index];
    if (/^[\x00-\x7f]$/.test(char)) {
      pixivAppendKeyPart(state, char, "readable");
      index += 1;
      continue;
    }
    if (/^[ー—―]$/.test(char)) {
      pixivAppendKeyPart(state, "-", "readable");
      index += 1;
      continue;
    }

    const hiragana = pixivHiragana(char);
    if (hiragana === "っ") {
      const next = pixivKanaUnit(chars, index + 1);
      if (next) {
        const consonant = next.value.match(/^[bcdfghjkmprstvwxyz]/)?.[0] || "";
        pixivAppendKeyPart(state, consonant + next.value, "readable");
        index += next.length + 1;
        continue;
      }
    }
    const kana = pixivKanaUnit(chars, index);
    if (kana) {
      pixivAppendKeyPart(state, kana.value, "readable");
      index += kana.length;
      continue;
    }

    const codePoints: string[] = [];
    while (index < chars.length) {
      const pending = chars[index];
      if (/^[\x00-\x7fー—―]$/.test(pending) || pixivKanaUnit(chars, index)) {
        break;
      }
      codePoints.push((pending.codePointAt(0) ?? 0).toString(36));
      index += 1;
    }
    pixivAppendKeyPart(state, `u-${codePoints.join("-")}`, "unicode");
  }

  const readableKey = pixivLabelKey(state.value);
  if (readableKey && readableKey.length <= 64) return readableKey;

  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (const char of normalized) {
    const codePoint = char.codePointAt(0) ?? 0;
    hashA = Math.imul(hashA ^ codePoint, 0x01000193);
    hashB = Math.imul(hashB ^ codePoint, 0x85ebca6b);
  }
  return `u-${(hashA >>> 0).toString(36)}-${(hashB >>> 0).toString(36)}`;
}

function labelsFromIllustBody(body: PixivIllustBody | null): KabegameLabelInput[] {
  const labels: KabegameLabelInput[] = [];
  const tags = Array.isArray(body?.tags?.tags) ? body.tags.tags : [];
  for (const tag of tags) {
    const originalName = coerceStr(tag?.tag).trim();
    const englishName = coerceStr(tag?.translation?.en).trim();
    const key = pixivLabelKey(englishName) || pixivOriginalTagKey(originalName);
    if (!key) continue;
    labels.push({
      key,
      category: "pixiv/tag",
      name: originalName || englishName || key.replace(/_/g, " "),
    });
  }

  const authorId = coerceStr(body?.userId || body?.tags?.authorId).trim();
  const authorKey = pixivLabelKey(authorId);
  if (authorKey) {
    labels.push({
      key: authorKey,
      category: "pixiv/artist",
      name: coerceStr(body?.userName).trim() || authorKey,
    });
  }
  return labels;
}

// 元数据搜索片段："pixiv"、作者名、作者 ID、每个标签加 # 前缀（原始名与英文翻译各一条）、
// 投稿日期（"2026年5月21日"）；有评论时再写 "comments" 与每条评论的评论者名称、评论内容。
// 日期取 uploadDate（缺失回落 createDate，与详情模板一致），按 Pixiv 所在的日本时区（UTC+9，无夏令时）
// 取日，结果不随运行设备的时区变化。
// 规则在 src/illust.ts 与 metadata_migrations/migrate.js 各有一份，改一处要同步改另一处。
function pixivDateText(value: unknown): string {
  const ms = Date.parse(coerceStr(value));
  if (!Number.isFinite(ms)) return "";
  const jst = new Date(ms + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`;
}

function pixivSearchTexts(metadata: PixivMetadata): string[] {
  const body: PixivIllustBody = "body" in metadata &&
      typeof metadata.body === "object" &&
      !Array.isArray(metadata.body)
    ? metadata.body
    : {};
  const out = ["pixiv"];
  const push = (value: unknown) => {
    const text = coerceStr(value).trim();
    if (text) out.push(text);
  };
  push(body.userName);
  push(body.userId || body.tags?.authorId);
  const tags = Array.isArray(body.tags?.tags) ? body.tags.tags : [];
  for (const tag of tags) {
    for (const name of [tag?.tag, tag?.translation?.en]) {
      const text = coerceStr(name).trim();
      if (text) out.push(`#${text}`);
    }
  }
  push(pixivDateText(body.uploadDate ?? body.createDate));
  const comments: PixivComment[] =
    "comments" in metadata && Array.isArray(metadata.comments) ? metadata.comments : [];
  if (comments.length > 0) {
    out.push("comments");
    for (const comment of comments) {
      push(comment?.userName);
      push(comment?.comment);
    }
  }
  return [...new Set(out)];
}

// 只保留带原图地址的分页项；filter 之后页项类型收窄，下载处不再重复判空。
function isPageWithOriginal(page: PixivPage): page is PixivPageWithUrl {
  return Boolean(page?.urls?.original);
}

async function fetchPixivComments(illustId: string): Promise<PixivComment[]> {
  try {
    setHeader("Referer", `https://www.pixiv.net/artworks/${illustId}`);
    const url =
      `https://www.pixiv.net/ajax/illusts/comments/roots?illust_id=${illustId}&offset=0&limit=20&lang=en`;
    const json = await fetchJson<PixivCommentsResponse>(url);
    const comments = json?.body?.comments;
    if (json && json.error !== true && comments) {
      return comments;
    }
  } catch {
    warn(t("commentsFetchFailed", { illustId }));
  }
  return [];
}

export async function downloadIllust(illustId: string): Promise<void> {
  setHeader("Referer", `https://www.pixiv.net/artworks/${illustId}`);
  let illustBody: PixivIllustBody | null = null;
  try {
    illustBody =
      (await fetchJson<PixivIllustResponse>(`https://www.pixiv.net/ajax/illust/${illustId}?lang=en`))
        ?.body || null;
  } catch {
    // Deleted or restricted details still allow trying pages below.
  }

  try {
    const json = await fetchJson<PixivPagesResponse>(
      `https://www.pixiv.net/ajax/illust/${illustId}/pages`,
    );
    const body = Array.isArray(json?.body) ? json.body : [];
    const pages = body.filter(isPageWithOriginal);
    if (pages.length === 0) return;

    const baseName = coerceStr(illustBody?.title) || illustId;
    const comments = await fetchPixivComments(illustId);
    const labels = labelsFromIllustBody(illustBody);
    const metadata: PixivMetadata = illustBody
      ? { body: pixivTrimIllustBody(illustBody), comments }
      : { illustId };
    const metadataId = Number(
      createImageMetadata(metadata, { searchTexts: pixivSearchTexts(metadata) }),
    );

    for (let index = 0; index < pages.length; index += 1) {
      const displayName = pages.length > 1
        ? `${baseName}(${index + 1})`
        : baseName;
      const opts: KabegameDownloadImageOptions = {
        name: displayName,
        metadata_id: metadataId,
        url: `https://www.pixiv.net/artworks/${illustId}`,
      };
      if (labels.length > 0) opts.labels = labels;
      await downloadImage(pages[index].urls.original, opts);
    }
  } catch {
    // Works may be deleted/restricted. Skip quietly like the Rhai plugin.
  }
}


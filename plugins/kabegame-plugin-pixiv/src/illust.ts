// @ts-nocheck
// 单个作品：详情、评论、标签、metadata 与全部分页原图下载。各模式只负责产出作品 id。
import { coerceStr, fetchJson } from "./common";
import { t } from "./i18n";

const { createImageMetadata, downloadImage, setHeader, warn } = Kabegame;

function pixivTrimIllustBody(body) {
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
const PIXIV_KANA_ROMAJI = {
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

const PIXIV_KANA_PAIR_ROMAJI = {
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

function pixivHiragana(char) {
  const codePoint = char.codePointAt(0);
  return codePoint >= 0x30a1 && codePoint <= 0x30f6
    ? String.fromCodePoint(codePoint - 0x60)
    : char;
}

function pixivKanaUnit(chars, index) {
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

function pixivAppendKeyPart(state, value, kind) {
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

function pixivLabelKey(value) {
  const key = coerceStr(value)
    .replace(/[ー—―]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

function pixivOriginalTagKey(value) {
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

    const codePoints = [];
    while (index < chars.length) {
      const pending = chars[index];
      if (/^[\x00-\x7fー—―]$/.test(pending) || pixivKanaUnit(chars, index)) {
        break;
      }
      codePoints.push(pending.codePointAt(0).toString(36));
      index += 1;
    }
    pixivAppendKeyPart(state, `u-${codePoints.join("-")}`, "unicode");
  }

  const readableKey = pixivLabelKey(state.value);
  if (readableKey && readableKey.length <= 64) return readableKey;

  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (const char of normalized) {
    const codePoint = char.codePointAt(0);
    hashA = Math.imul(hashA ^ codePoint, 0x01000193);
    hashB = Math.imul(hashB ^ codePoint, 0x85ebca6b);
  }
  return `u-${(hashA >>> 0).toString(36)}-${(hashB >>> 0).toString(36)}`;
}

function labelsFromIllustBody(body) {
  const labels = [];
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
function pixivDateText(value) {
  const ms = Date.parse(coerceStr(value));
  if (!Number.isFinite(ms)) return "";
  const jst = new Date(ms + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`;
}

function pixivSearchTexts(metadata) {
  const body = metadata && typeof metadata.body === "object" &&
      !Array.isArray(metadata.body)
    ? metadata.body
    : {};
  const out = ["pixiv"];
  const push = (value) => {
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
  const comments = Array.isArray(metadata?.comments) ? metadata.comments : [];
  if (comments.length > 0) {
    out.push("comments");
    for (const comment of comments) {
      push(comment?.userName);
      push(comment?.comment);
    }
  }
  return [...new Set(out)];
}

async function fetchPixivComments(illustId) {
  try {
    setHeader("Referer", `https://www.pixiv.net/artworks/${illustId}`);
    const url =
      `https://www.pixiv.net/ajax/illusts/comments/roots?illust_id=${illustId}&offset=0&limit=20&lang=en`;
    const json = await fetchJson(url);
    if (json && json.error !== true && json.body?.comments) {
      return json.body.comments;
    }
  } catch {
    warn(t("commentsFetchFailed", { illustId }));
  }
  return [];
}

export async function downloadIllust(illustId) {
  setHeader("Referer", `https://www.pixiv.net/artworks/${illustId}`);
  let illustBody = null;
  try {
    illustBody =
      (await fetchJson(`https://www.pixiv.net/ajax/illust/${illustId}?lang=en`))
        ?.body || null;
  } catch {
    // Deleted or restricted details still allow trying pages below.
  }

  try {
    const json = await fetchJson(
      `https://www.pixiv.net/ajax/illust/${illustId}/pages`,
    );
    const body = Array.isArray(json?.body) ? json.body : [];
    const pages = body.filter((page) => page?.urls?.original);
    if (pages.length === 0) return;

    const baseName = coerceStr(illustBody?.title) || illustId;
    const comments = await fetchPixivComments(illustId);
    const labels = labelsFromIllustBody(illustBody);
    const metadata = illustBody
      ? { body: pixivTrimIllustBody(illustBody), comments }
      : { illustId };
    const metadataId = Number(
      createImageMetadata(metadata, { searchTexts: pixivSearchTexts(metadata) }),
    );

    for (let index = 0; index < pages.length; index += 1) {
      const displayName = pages.length > 1
        ? `${baseName}(${index + 1})`
        : baseName;
      await downloadImage(pages[index].urls.original, {
        name: displayName,
        metadata_id: metadataId,
        url: `https://www.pixiv.net/artworks/${illustId}`,
        ...(labels.length > 0 ? { labels } : {}),
      });
    }
  } catch {
    // Works may be deleted/restricted. Skip quietly like the Rhai plugin.
  }
}


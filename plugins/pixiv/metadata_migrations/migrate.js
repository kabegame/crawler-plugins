// Pixiv metadata 迁移脚本：只提供 provideLabels，给历史图片补标签，不改写 metadata。
// 规则与 src/index.ts 的 labelsFromIllustBody 一致（此处无法 import，保持两份同步）。

function coerceStr(value) {
  return value == null ? "" : String(value);
}

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

export function provideLabels(input) {
  const metadata = JSON.parse(input);
  const body = metadata && typeof metadata.body === "object" &&
      !Array.isArray(metadata.body)
    ? metadata.body
    : null;
  if (!body) return [];

  const labels = [];
  const tags = Array.isArray(body.tags?.tags) ? body.tags.tags : [];
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

  const authorId = coerceStr(body.userId || body.tags?.authorId).trim();
  const authorKey = pixivLabelKey(authorId);
  if (authorKey) {
    labels.push({
      key: authorKey,
      category: "pixiv/artist",
      name: coerceStr(body.userName).trim() || authorKey,
    });
  }
  return labels;
}

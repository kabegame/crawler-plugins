// hydrus ClientStrings 的执行语义：StringMatch.Test、StringConverter.Convert、StringProcessor.ProcessStrings。
// 参数都是升级后的当前版本元组。
import { casefold, compareCodePoints, HydrusUnsupportedError, infoOf, T, typeName } from "../serialisable/core.js";
import { datetimeTimestamp, strptime } from "./strptime.js";

// HydrusConstants.TIMEZONE_*
const TIMEZONE_UTC = 0;
const TIMEZONE_OFFSET = 2;

const STRING_MATCH_FIXED = 0;
const STRING_MATCH_FLEXIBLE = 1;
const STRING_MATCH_REGEX = 2;

// ClientStrings.FLEXIBLE_MATCH_*
const FLEXIBLE_PATTERNS = {
  0: /^[a-zA-Z]+$/,
  1: /^[a-zA-Z\d]+$/,
  2: /^\d+$/,
  3: /^[\da-fA-F]+$/,
  4: /^[a-zA-Z\d+/]+={0,2}$/,
  5: /^[a-zA-Z\d\-_]+={0,2}$/,
  6: /^([a-zA-Z\d]|%2B|%2F)+(%3D){0,2}$/,
};

/** 转换失败只丢弃当前字符串，对应 hydrus 的 StringConvertException。 */
export class StringConvertError extends Error {
  name = "StringConvertError";
}

/** Python 字符串长度按码点计。 */
const pyLen = (s) => [...s].length;

/**
 * Python re 语法到 JS RegExp 的常见差异：命名组、开头的内联 flag、\A / \Z。
 * 不认识的写法原样交给 RegExp，编译失败时由调用方处理。
 */
export function pyRegex(pattern, extraFlags = "") {
  let flags = extraFlags;
  let p = pattern.replace(/^\(\?([aiLmsux]+)\)/, (_, f) => {
    if (f.includes("i")) flags += "i";
    if (f.includes("m")) flags += "m";
    if (f.includes("s")) flags += "s";
    return "";
  });
  p = p
    .replace(/\(\?P<([A-Za-z_]\w*)>/g, "(?<$1>")
    .replace(/\(\?P=([A-Za-z_]\w*)\)/g, "\\k<$1>")
    .replace(/\\A/g, "^")
    .replace(/\\Z/g, "$(?![\\s\\S])");
  return new RegExp(p, [...new Set(flags)].join(""));
}

/** StringMatch.Matches */
export function stringMatches(sm, text) {
  const [matchType, matchValue, minChars, maxChars] = infoOf(sm);
  const len = pyLen(text);
  if (minChars !== null && len < minChars) return false;
  if (maxChars !== null && len > maxChars) return false;
  if (matchType === STRING_MATCH_FIXED) return text === matchValue;
  if (matchType === STRING_MATCH_FLEXIBLE || matchType === STRING_MATCH_REGEX) {
    const re = matchType === STRING_MATCH_FLEXIBLE ? FLEXIBLE_PATTERNS[matchValue] : pyRegex(matchValue);
    if (!re) return false;
    // hydrus 先去掉换行再 strip
    const textToTest = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).join("").trim();
    return re.test(textToTest);
  }
  return true; // STRING_MATCH_ANY
}

function pySlice(s, start, end) {
  const cps = [...s];
  const norm = (i) => (i === undefined ? undefined : i < 0 ? Math.max(cps.length + i, 0) : Math.min(i, cps.length));
  return cps.slice(norm(start), norm(end)).join("");
}

function base64Utf8(s, urlSafe) {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  const out = btoa(bin);
  return urlSafe ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
}

function unbase64Utf8(s, urlSafe) {
  let t = urlSafe ? s.replace(/-/g, "+").replace(/_/g, "/") : s;
  t += "=".repeat((4 - (t.length % 4)) % 4);
  const bin = atob(t);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Python re.sub 的替换串：\1、\g<1>、\g<name> → JS 的 $1、$<name>。 */
function pyReplacement(repl) {
  return repl
    .replace(/\$/g, "$$$$")
    .replace(/\\g<(\d+)>/g, "$$$1")
    .replace(/\\g<([A-Za-z_]\w*)>/g, "$$<$1>")
    .replace(/\\(\d{1,2})/g, "$$$1")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

/** StringConverter.Convert */
export function convert(converter, s) {
  const [conversions] = infoOf(converter);
  for (const [type, data] of conversions) {
    try {
      switch (type) {
        case 0: s = pySlice(s, data); break; // REMOVE_TEXT_FROM_BEGINNING
        case 1: s = pySlice(s, 0, -data); break; // REMOVE_TEXT_FROM_END
        case 2: s = data + s; break; // PREPEND_TEXT
        case 3: s = s + data; break; // APPEND_TEXT
        case 6: s = pySlice(s, 0, data); break; // CLIP_TEXT_FROM_BEGINNING
        case 7: s = pySlice(s, -data); break; // CLIP_TEXT_FROM_END
        case 8: s = [...s].reverse().join(""); break; // REVERSE
        case 9: { // REGEX_SUB
          const [pattern, repl] = data;
          s = s.replace(pyRegex(pattern, "g"), pyReplacement(repl));
          break;
        }
        case 10: { // DATE_DECODE：datetime.strptime(s, phrase)，再按时区设置转成时间戳
          const [phrase, timezone, timezoneOffset] = data;
          let dt = strptime(s, phrase);
          if (timezone === TIMEZONE_UTC || timezone === TIMEZONE_OFFSET) {
            // hydrus 重新构造 datetime：丢掉解析出的时区与微秒，按 UTC 解释
            dt = { ...dt, microsecond: 0, utcOffset: timezone === TIMEZONE_OFFSET ? timezoneOffset : 0 };
          }
          s = String(Math.trunc(datetimeTimestamp(dt)));
          break;
        }
        case 14: { // DATEPARSER_DECODE：hydrus 用 dateparser 自动识别，这里只认 Date.parse 能解析的格式（ISO 8601、RFC 2822 等）
          const ms = Date.parse(s.trim());
          if (Number.isNaN(ms)) throw new Error(`无法识别的日期 "${s}"`);
          s = String(Math.trunc(ms / 1000));
          break;
        }
        case 11: { // INTEGER_ADDITION
          if (!/^\s*[+-]?\d+\s*$/.test(s)) throw new Error(`"${s}" 不是整数`);
          s = String(BigInt(s.trim()) + BigInt(data));
          break;
        }
        case 4: // ENCODE
          if (data === 0) s = encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
          else if (data === 3) s = [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
          else if (data === 4) s = base64Utf8(s, false);
          else if (data === 5) s = base64Utf8(s, true);
          else throw new HydrusUnsupportedError(`未实现的编码类型 ${data}`);
          break;
        case 5: // DECODE
          if (data === 0) s = decodeURIComponent(s);
          else if (data === 3) s = new TextDecoder().decode(Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16)));
          else if (data === 4) s = unbase64Utf8(s, false);
          else if (data === 5) s = unbase64Utf8(s, true);
          else throw new HydrusUnsupportedError(`未实现的解码类型 ${data}`);
          break;
        default:
          throw new HydrusUnsupportedError(`未实现的字符串转换类型 ${type}`);
      }
    } catch (e) {
      if (e instanceof HydrusUnsupportedError) throw e;
      throw new StringConvertError(`转换 ${type} 失败: ${e?.message ?? e}`);
    }
  }
  return s;
}

/** Python 列表切片 xs[start:end]，start / end 为 null 表示省略 */
function pySliceList(xs, start, end) {
  const norm = (i) => (i === null ? null : i < 0 ? Math.max(xs.length + i, 0) : Math.min(i, xs.length));
  return xs.slice(norm(start) ?? 0, norm(end) ?? xs.length);
}

/** StringSlicer.Slice */
export function slice(slicer, texts) {
  const [indexStart, indexEnd] = infoOf(slicer);
  return pySliceList(texts, indexStart, indexEnd);
}

/**
 * separator.encode("latin-1", "backslashreplace").decode("unicode-escape")：
 * 码点 ≤ 0xFF 的字符原样当作字节，其余字符转成 \\u 转义文本；再按 Python 字符串字面量规则解释反斜杠转义。
 */
export function unicodeEscapeDecode(s) {
  const SIMPLE = { "\n": "", "\\": "\\", "'": "'", '"': '"', a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };
  // backslashreplace：latin-1 装不下的字符先变成 \uXXXX / \UXXXXXXXX 文本，再一起解转义
  s = [...s]
    .map((c) => {
      const cp = c.codePointAt(0);
      if (cp <= 0xff) return c;
      return cp > 0xffff ? `\\U${cp.toString(16).padStart(8, "0")}` : `\\u${cp.toString(16).padStart(4, "0")}`;
    })
    .join("");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const e = s[i + 1];
    if (e === undefined) throw new Error("\\ at end of string");
    if (e in SIMPLE) {
      out += SIMPLE[e];
      i++;
      continue;
    }
    if (/[0-7]/.test(e)) {
      const m = /^[0-7]{1,3}/.exec(s.slice(i + 1))[0];
      out += String.fromCodePoint(parseInt(m, 8));
      i += m.length;
      continue;
    }
    const hexLen = { x: 2, u: 4, U: 8 }[e];
    if (hexLen) {
      const hex = s.slice(i + 2, i + 2 + hexLen);
      if (hex.length !== hexLen || !/^[0-9a-fA-F]+$/.test(hex)) throw new Error(`truncated \\${e} escape`);
      const cp = parseInt(hex, 16);
      if (cp > 0x10ffff) throw new Error("illegal Unicode character");
      out += String.fromCodePoint(cp);
      i += 1 + hexLen;
      continue;
    }
    // \N{名称} 需要 Unicode 字符名表，这里不支持；其余未知转义保留反斜杠
    if (e === "N") throw new HydrusUnsupportedError("分隔符里的 \\N{...} 转义暂不支持");
    out += "\\";
  }
  return out;
}

/** StringSplitter.Split：返回 null 表示拆分失败（hydrus 丢弃该字符串） */
export function split(splitter, text) {
  const [separator, maxSplits] = infoOf(splitter);
  let sep;
  try {
    sep = unicodeEscapeDecode(separator);
  } catch (e) {
    if (e instanceof HydrusUnsupportedError) throw e;
    return null;
  }
  if (sep === "") return null; // Python: ValueError: empty separator
  let parts = text.split(sep);
  if (maxSplits !== null && maxSplits >= 0 && parts.length > maxSplits + 1) {
    parts = [...parts.slice(0, maxSplits), parts.slice(maxSplits).join(sep)];
  }
  return parts.filter((p) => p !== "");
}

/** HydrusText.HumanTextSortKey：数字段按整数比较，数字段排在文字段前。 */
function humanTextKey(t) {
  return casefold(t)
    .split(/([0-9]+)/)
    .map((sub) => (/^[0-9]+$/.test(sub) ? ["", BigInt(sub)] : [sub, 0n]));
}

export function humanTextCompare(a, b) {
  const ka = humanTextKey(a);
  const kb = humanTextKey(b);
  for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
    const c = compareCodePoints(ka[i][0], kb[i][0]);
    if (c !== 0) return c;
    if (ka[i][1] !== kb[i][1]) return ka[i][1] < kb[i][1] ? -1 : 1;
  }
  return ka.length - kb.length;
}

// ClientStrings.CONTENT_PARSER_SORT_TYPE_*
const SORT_TYPE_HUMAN_SORT = 2;
const SORT_TYPE_REVERSE = 3;

/**
 * StringSorter.Sort：REVERSE 直接倒序；其余按（正则取出的片段）字典序或人类排序，降序时保持稳定。
 * 给了正则时，取不到片段的字符串单独排序后接在最后。出错时 hydrus 原样返回输入。
 */
export function sort(sorter, texts) {
  const [sortType, asc, regex] = infoOf(sorter);
  try {
    const list = [...texts];
    if (sortType === SORT_TYPE_REVERSE) return list.reverse();
    let dataConvert = (s) => s;
    let invalid = [];
    let valid = list;
    if (regex !== null) {
      const re = pyRegex(regex);
      dataConvert = (s) => re.exec(s)?.[0] ?? "";
      invalid = list.filter((s) => dataConvert(s) === "");
      valid = list.filter((s) => dataConvert(s) !== "");
    }
    const cmp = sortType === SORT_TYPE_HUMAN_SORT ? humanTextCompare : compareCodePoints;
    const sign = asc ? 1 : -1;
    valid.sort((a, b) => sign * cmp(dataConvert(a), dataConvert(b)));
    invalid.sort((a, b) => sign * cmp(a, b));
    return [...valid, ...invalid];
  } catch {
    return [...texts];
  }
}

/** StringProcessor.ProcessStrings */
export function processStrings(processor, strings) {
  let current = [...strings];
  for (const [, step] of infoOf(infoOf(processor))) {
    let next = [];
    if (step[0] === T.STRING_SORTER) {
      next = sort(step, current);
    } else if (step[0] === T.STRING_SLICER) {
      next = slice(step, current);
    } else if (step[0] === T.STRING_MATCH) {
      for (const s of current) if (stringMatches(step, s)) next.push(s);
    } else if (step[0] === T.STRING_CONVERTER) {
      for (const s of current) {
        try {
          next.push(convert(step, s));
        } catch (e) {
          if (!(e instanceof StringConvertError)) throw e;
        }
      }
    } else if (step[0] === T.STRING_SPLITTER) {
      for (const s of current) next.push(...(split(step, s) ?? []));
    } else {
      throw new HydrusUnsupportedError(`未实现的字符串处理步骤 ${typeName(step[0])}`);
    }
    current = next;
  }
  return current;
}

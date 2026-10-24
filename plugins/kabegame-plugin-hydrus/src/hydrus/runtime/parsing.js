// hydrus ClientParsing 的执行语义：解析公式（HTML / JSON / COMPOUND / CONTEXT_VARIABLE / NESTED / STATIC）、
// ContentParser、PageParser 与子页面解析器。HTML 用宿主的 DOMParser（deno-dom），语义按 BeautifulSoup 对齐；
// JSON 用 pyjson.js，输出与 Python 的 str() / json.dumps 一致。
import { casefold, HydrusUnsupportedError, infoOf, sortedBy, T, typeName } from "../serialisable/core.js";
import {
  CONTENT_TYPE_MAPPINGS,
  CONTENT_TYPE_URLS,
  CONTENT_TYPE_VETO,
  HTML_CONTENT_ATTRIBUTE,
  HTML_CONTENT_HTML,
  HTML_CONTENT_STRING,
  HTML_RULE_TYPE_ASCENDING,
  HTML_RULE_TYPE_DESCENDING,
  HTML_RULE_TYPE_NEXT_SIBLINGS,
  HTML_RULE_TYPE_PREV_SIBLINGS,
  JSON_CONTENT_DICT_KEYS,
  JSON_CONTENT_JSON,
  JSON_CONTENT_STRING,
  JSON_PARSE_RULE_TYPE_ALL_ITEMS,
  JSON_PARSE_RULE_TYPE_ASCEND,
  JSON_PARSE_RULE_TYPE_DEMINIFY_JSON,
  JSON_PARSE_RULE_TYPE_DICT_KEY,
  JSON_PARSE_RULE_TYPE_INDEXED_ITEM,
  JSON_PARSE_RULE_TYPE_TEST_STRING_ITEMS,
} from "../serialisable/parsing.js";
import { isContainer, PyDict, PyInt, pyJsonDumps, pyJsonLoads, pyStr } from "./pyjson.js";
import { convert, humanTextCompare, processStrings, StringConvertError, stringMatches } from "./strings.js";
import { ensureUrlIsEncoded, looksLikeAFullUrl, urlJoin } from "./url.js";

const CONTENT_TYPE_HASH = 15;
const CONTENT_TYPE_TIMESTAMP = 16;
export const CONTENT_TYPE_TITLE = 17;
const CONTENT_TYPE_NOTES = 18;
const CONTENT_TYPE_HTTP_HEADERS = 22;

const TIMESTAMP_TYPE_MODIFIED_DOMAIN = 0;

export const URL_TYPE_NEXT = 6;
export const URL_TYPE_DESIRED = 7;
export const URL_TYPE_SOURCE = 8;
export const URL_TYPE_SUB_GALLERY = 9;

/** 解析器执行时的错误：对应 hydrus 的 ParseException / VetoException。 */
export class ParseError extends Error {
  name = "ParseError";
}
export class VetoError extends Error {
  name = "VetoError";
}

// ---- HTML ----

// BeautifulSoup 按空白拆成列表的多值属性
const MULTI_VALUED = new Set(["class", "rel", "rev", "accept-charset", "headers", "accesskey", "dropzone"]);

/** bs4 find_all(attrs={k: v}) 对单个属性的匹配：多值属性任一值相等或整体相等即可。 */
function attrMatches(el, name, expected) {
  if (!el.hasAttribute(name)) return false;
  if (expected === true) return true;
  const raw = el.getAttribute(name) ?? "";
  if (MULTI_VALUED.has(name)) {
    const values = raw.split(/\s+/).filter(Boolean);
    return values.includes(expected) || values.join(" ") === expected;
  }
  return raw === expected;
}

function tagMatches(el, tagName, attrs) {
  if (tagName !== null && el.tagName.toLowerCase() !== tagName.toLowerCase()) return false;
  for (const [k, v] of Object.entries(attrs ?? {})) if (!attrMatches(el, k, v)) return false;
  return true;
}

/** node 是 Document 或 Element；bs4 的 find_all 只看后代，不含自身。 */
function descendants(node) {
  return [...node.querySelectorAll("*")];
}

function siblings(el, forward) {
  const out = [];
  let cur = forward ? el.nextElementSibling : el.previousElementSibling;
  while (cur) {
    out.push(cur);
    cur = forward ? cur.nextElementSibling : cur.previousElementSibling;
  }
  return out;
}

/** ParseRuleHTML.GetNodes */
function applyRule(rule, nodes) {
  const [ruleType, tagName, tagAttributes, tagIndex, tagDepth, shouldTestTagString, tagStringMatch] = infoOf(rule);
  let out = [];
  for (const node of nodes) {
    if (ruleType === HTML_RULE_TYPE_ASCENDING) {
      // bs4 的文档对象本身也是 Tag，tag_name 为空时会被计数
      let num = 0;
      let parent = node.parentNode;
      while (parent && (parent.nodeType === 1 || parent.nodeType === 9)) {
        const name = parent.nodeType === 9 ? "[document]" : parent.tagName.toLowerCase();
        if (tagName === null || name === tagName.toLowerCase()) num++;
        if (num === tagDepth) {
          out.push(parent);
          break;
        }
        parent = parent.parentNode;
      }
      continue;
    }
    let found;
    if (ruleType === HTML_RULE_TYPE_DESCENDING) found = descendants(node);
    else if (ruleType === HTML_RULE_TYPE_NEXT_SIBLINGS) found = node.nodeType === 1 ? siblings(node, true) : [];
    else if (ruleType === HTML_RULE_TYPE_PREV_SIBLINGS) found = node.nodeType === 1 ? siblings(node, false) : [];
    else throw new HydrusUnsupportedError(`未实现的 HTML 规则类型 ${ruleType}`);
    found = found.filter((el) => tagMatches(el, tagName, tagAttributes));
    if (tagIndex !== null) {
      // Python 下标允许负数
      const i = tagIndex < 0 ? found.length + tagIndex : tagIndex;
      if (i < 0 || i >= found.length) continue;
      found = [found[i]];
    }
    out.push(...found);
  }
  if (shouldTestTagString) out = out.filter((el) => stringMatches(tagStringMatch, tagString(el)));
  return out;
}

/** GetHTMLTagString：所有后代文本拼接，br / p 记为换行。bs4 的注释也是字符串。 */
function tagString(node) {
  const parts = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 1) {
        const name = c.tagName.toLowerCase();
        if (name === "br" || name === "p") parts.push("\n");
        walk(c);
      } else if (c.nodeType === 3 || c.nodeType === 4 || c.nodeType === 8) {
        parts.push(c.nodeValue ?? "");
      }
    }
  };
  walk(node);
  return parts.join("");
}

function rawTextFromTag(el, contentToFetch, attributeToFetch) {
  let result;
  if (contentToFetch === HTML_CONTENT_ATTRIBUTE) {
    if (!el.hasAttribute?.(attributeToFetch)) return null;
    const raw = el.getAttribute(attributeToFetch) ?? "";
    result = MULTI_VALUED.has(attributeToFetch) ? raw.split(/\s+/).filter(Boolean).join(" ") : raw;
  } else if (contentToFetch === HTML_CONTENT_STRING) {
    result = tagString(el);
  } else if (contentToFetch === HTML_CONTENT_HTML) {
    result = el.outerHTML;
  }
  return result ? result : null;
}

/** HydrusText.RemoveNewlines */
function removeNewlines(text) {
  return text
    .split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join("");
}

/** 一次解析过程共用的缓存：同一段文本只解析一次 HTML / JSON（对应 hydrus 的 parsing_cache）。 */
export class ParsingEnv {
  constructor() {
    /** @type {Map<string, any>} */
    this.soups = new Map();
    /** @type {Map<string, any>} */
    this.jsons = new Map();
  }

  soup(text) {
    let doc = this.soups.get(text);
    if (doc === undefined) {
      doc = new DOMParser().parseFromString(text, "text/html");
      if (!doc) throw new ParseError("无法解析 HTML");
      this.soups.set(text, doc);
    }
    return doc;
  }

  json(text) {
    if (!this.jsons.has(text)) this.jsons.set(text, pyJsonLoads(text));
    return this.jsons.get(text);
  }
}

/** HydrusText.LooksLikeHTML */
const looksLikeHtml = (t) => ["<html", "<HTML", "<!DOCTYPE html", "<!DOCTYPE HTML"].some((x) => t.includes(x));

function htmlRawTexts(formula, env, parsingText) {
  const [tagRules, contentToFetch, attributeToFetch] = infoOf(formula);
  let nodes = [env.soup(parsingText)];
  for (const [, rule] of infoOf(tagRules)) nodes = applyRule(rule, nodes);
  return nodes.map((el) => rawTextFromTag(el, contentToFetch, attributeToFetch)).filter((t) => t !== null);
}

function jsonRawTexts(formula, env, parsingText) {
  const [parseRules, contentToFetch] = infoOf(formula);
  let j;
  try {
    j = env.json(parsingText);
  } catch (e) {
    const head = looksLikeHtml(parsingText) ? "Unable to parse: Appeared to receive HTML instead of JSON." : `Unable to parse that JSON: ${e?.message ?? e}.`;
    throw new ParseError(`${head} Parsing text sample: ${parsingText.slice(0, 1024)}`);
  }
  return jsonTextsFrom(j, parseRules, contentToFetch);
}

/** ParseFormulaJSON._GetRawTextsFromJSON */
function jsonTextsFrom(root, parseRules, contentToFetch) {
  let nodesAndStacks = [[root, []]];
  for (const [ruleType, rule] of parseRules) {
    const next = [];
    for (const [node, stack] of nodesAndStacks) {
      const nextStack = [...stack, node];
      switch (ruleType) {
        case JSON_PARSE_RULE_TYPE_ALL_ITEMS:
          if (Array.isArray(node)) for (const item of node) next.push([item, nextStack]);
          else if (node instanceof PyDict) for (const [, v] of node.sortedItems()) next.push([v, nextStack]);
          break;
        case JSON_PARSE_RULE_TYPE_INDEXED_ITEM: {
          if (!isContainer(node)) break;
          const list = Array.isArray(node) ? node : [...node.map.keys()].sort(humanTextCompare);
          const i = rule < 0 ? list.length + rule : rule;
          if (i < 0 || i >= list.length) break;
          next.push([Array.isArray(node) ? list[i] : node.map.get(list[i]), nextStack]);
          break;
        }
        case JSON_PARSE_RULE_TYPE_DICT_KEY:
          if (!(node instanceof PyDict)) break;
          for (const [k, v] of node.sortedItems()) if (stringMatches(rule, k)) next.push([v, nextStack]);
          break;
        case JSON_PARSE_RULE_TYPE_TEST_STRING_ITEMS:
          // 只是过滤，栈不变
          if (isContainer(node) || node === null) break;
          if (stringMatches(rule, pyStr(node))) next.push([node, stack]);
          break;
        case JSON_PARSE_RULE_TYPE_ASCEND:
          if (stack.length >= rule) next.push([stack[stack.length - rule], stack.slice(0, stack.length - rule)]);
          break;
        case JSON_PARSE_RULE_TYPE_DEMINIFY_JSON: {
          if (!Array.isArray(node)) break;
          const i = rule < 0 ? node.length + rule : rule;
          if (i < 0 || i >= node.length) break;
          try {
            next.push([deminify(node, node[i]), nextStack]);
          } catch (e) {
            // hydrus 只吞 IndexError
            if (!(e instanceof RangeError)) throw e;
          }
          break;
        }
        default:
          throw new HydrusUnsupportedError(`未实现的 JSON 规则类型 ${ruleType}`);
      }
    }
    nodesAndStacks = next;
  }
  const out = [];
  for (const [node] of nodesAndStacks) {
    if (contentToFetch === JSON_CONTENT_STRING) {
      if (!isContainer(node) && node !== null) out.push(pyStr(node));
    } else if (contentToFetch === JSON_CONTENT_JSON) {
      out.push(pyJsonDumps(node));
    } else if (contentToFetch === JSON_CONTENT_DICT_KEYS) {
      if (node instanceof PyDict) for (const [k] of node.sortedItems()) out.push(k);
    }
  }
  return out;
}

/** JSON_PARSE_RULE_TYPE_DEMINIFY_JSON：把数组里的整数当成指向同一数组的下标展开（顶层整数除外）。 */
function deminify(root, item) {
  if (Array.isArray(item)) return item.map((x) => deminify(root, x));
  if (item instanceof PyDict) {
    const d = new PyDict();
    for (const [k, v] of item.map) d.map.set(k, deminify(root, v));
    return d;
  }
  // Python 里 bool 也是 int，但 isinstance(True, int) 走这里时 node[True] 即 node[1]
  if (item instanceof PyInt || typeof item === "boolean") {
    const index = item instanceof PyInt ? Number(item.value) : Number(item);
    const i = index < 0 ? root.length + index : index;
    if (i < 0 || i >= root.length) throw new RangeError("list index out of range");
    const target = root[i];
    if (target instanceof PyInt || typeof target === "boolean") return target;
    return deminify(root, target);
  }
  return item;
}

/** ParseFormulaZipper._ParseRawTexts */
function zipperRawTexts(formula, env, parsingContext, parsingText, collapseNewlines) {
  const [formulae, subPhrase] = infoOf(formula);
  const streams = [];
  for (const [, f] of infoOf(formulae)) {
    const stream = parseFormula(f, env, parsingContext, parsingText, collapseNewlines);
    // 有一路什么都没取到，就拼不出任何结果
    if (stream.length === 0) return [];
    streams.push(stream);
  }
  if (streams.length === 0) return [];
  const n = Math.max(...streams.map((s) => s.length));
  const out = [];
  for (let i = 0; i < n; i++) {
    let text = subPhrase;
    streams.forEach((stream, k) => {
      text = text.split(`\\${k + 1}`).join(i >= stream.length ? stream[stream.length - 1] : stream[i]);
    });
    out.push(text);
  }
  return out;
}

/**
 * ParseFormula.Parse
 * @param {any} formula
 * @param {ParsingEnv} env
 * @param {Record<string, string>} parsingContext  hydrus 的 parsing_context：url、post_url、gallery_url、post_index 等
 * @param {string} parsingText
 * @param {boolean} collapseNewlines
 * @returns {string[]}
 */
export function parseFormula(formula, env, parsingContext, parsingText, collapseNewlines) {
  let raw;
  switch (formula[0]) {
    case T.PARSE_FORMULA_HTML:
      raw = htmlRawTexts(formula, env, parsingText);
      break;
    case T.PARSE_FORMULA_JSON:
      raw = jsonRawTexts(formula, env, parsingText);
      break;
    case T.PARSE_FORMULA_ZIPPER:
      raw = zipperRawTexts(formula, env, parsingContext, parsingText, collapseNewlines);
      break;
    case T.PARSE_FORMULA_CONTEXT_VARIABLE: {
      const [variableName] = infoOf(formula);
      raw = Object.hasOwn(parsingContext, variableName) ? [String(parsingContext[variableName])] : [];
      break;
    }
    case T.PARSE_FORMULA_NESTED: {
      const [mainFormula, subFormula] = infoOf(formula);
      raw = parseFormula(mainFormula, env, parsingContext, parsingText, collapseNewlines).flatMap((t) => parseFormula(subFormula, env, parsingContext, t, collapseNewlines));
      break;
    }
    case T.PARSE_FORMULA_STATIC: {
      const [staticText, numToDo] = infoOf(formula);
      raw = Array.from({ length: Math.max(0, numToDo) }, () => staticText);
      break;
    }
    default:
      throw new HydrusUnsupportedError(`未实现的解析公式 ${typeName(formula[0])}`);
  }
  // CleanseImportTexts 修的是 Python 里落单的 UTF-16 代理对，JS 字符串本来就是 UTF-16，不用处理
  const texts = raw.map((t) => (collapseNewlines ? removeNewlines(t) : t.trim()));
  const processor = infoOf(formula)[FORMULA_PROCESSOR_INDEX[formula[0]]];
  return processStrings(processor, texts);
}

const FORMULA_PROCESSOR_INDEX = {
  [T.PARSE_FORMULA_HTML]: 4,
  [T.PARSE_FORMULA_JSON]: 3,
  [T.PARSE_FORMULA_ZIPPER]: 3,
  [T.PARSE_FORMULA_CONTEXT_VARIABLE]: 2,
  [T.PARSE_FORMULA_NESTED]: 3,
  [T.PARSE_FORMULA_STATIC]: 3,
};

// ---- 标签 ----

/** HydrusTags.StripTagTextOfGumpf 的主要部分 */
function stripGumpf(t) {
  return t
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(-|system:)+/, "")
    .trim();
}

/** HydrusTags.CombineTag */
function combineTag(namespace, subtag) {
  if (namespace === "") return subtag.includes(":") ? `:${subtag}` : subtag;
  return `${namespace}:${subtag}`;
}

/** HydrusTags.CleanTag */
export function cleanTag(tag) {
  let t = [...tag].slice(0, 1024).join("").toLowerCase();
  if (/^:(?=[^:]+$)/.test(t)) t = ":" + t;
  if (!t.includes(":")) return stripGumpf(t);
  t = stripGumpf(t);
  const i = t.indexOf(":");
  return combineTag(stripGumpf(t.slice(0, i)), stripGumpf(t.slice(i + 1)));
}

// ---- ContentParser / PageParser ----

/**
 * ParsedPost 的扁平表示（hydrus 里是一个 ParsedContent 列表，这里按类型拆开，类型内保持顺序）：
 *   urls: { url, urlType, priority }[]
 *   tags: string[]（已带 namespace，未清洗）
 *   titles: { title, priority }[]
 *   notes: { name, text }[]
 *   hashes: { type, encoding, value }[]
 *   timestamps: { type, value }[]（value 为 unix 秒）
 *   headers: { name, value }[]（CONTENT_TYPE_HTTP_HEADERS，之后请求这条帖子的页面和文件时带上）
 *   others: { contentType, name, text }[]（本插件不使用的内容，只为与 hydrus 的「有没有内容」判断一致）
 */
export function emptyPost() {
  return { urls: [], tags: [], titles: [], notes: [], hashes: [], timestamps: [], headers: [], others: [] };
}

/** ParsedPost.MergeParsedPost：把 src 的内容追加到 target 后面 */
export function mergePost(target, src) {
  for (const key of Object.keys(target)) target[key].push(...src[key]);
}

const postHasContent = (post) => Object.values(post).some((xs) => xs.length > 0);

/** HydrusText.CleanNoteText：去首尾空白、逐行 trim、把三个以上连续换行压成两个。 */
function cleanNoteText(t) {
  t = t
    .trim()
    .split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/)
    .map((l) => l.trim())
    .join("\n");
  while (t.includes("\n\n\n")) t = t.replace(/\n\n\n/g, "\n\n");
  return t;
}

/** ContentParser 里 URL 前面混着描述文字时的清理（remove_pre_url_gubbins）。 */
function removePreUrlGubbins(u) {
  u = u.replace(/^.*\s(https?:\/\/)/, "$1");
  return u.replace(/^(?:https?:\/\/)+(https?:\/\/)/, "$1");
}

/** ContentParser.Parse */
function parseContent(contentParser, env, parsingContext, parsingText, post) {
  const [name, contentType, formula, additionalInfo] = infoOf(contentParser);
  let texts;
  try {
    texts = parseFormula(formula, env, parsingContext, parsingText, contentType !== CONTENT_TYPE_NOTES);
  } catch (e) {
    if (e instanceof ParseError) throw new ParseError(`Content Parser ${name}: ${e.message}`);
    throw e;
  }
  if (contentType === CONTENT_TYPE_NOTES) texts = texts.map(cleanNoteText);
  switch (contentType) {
    case CONTENT_TYPE_URLS: {
      const [urlType, priority] = additionalInfo;
      for (let u of texts) {
        if (Object.hasOwn(parsingContext, "url")) {
          if (!looksLikeAFullUrl(u) && (u.includes("http://") || u.includes("https://"))) u = removePreUrlGubbins(u);
          if (!looksLikeAFullUrl(u)) u = urlJoin(parsingContext.url, u);
          u = ensureUrlIsEncoded(u);
        }
        post.urls.push({ url: u, urlType, priority });
      }
      return;
    }
    case CONTENT_TYPE_MAPPINGS: {
      const namespace = additionalInfo;
      for (const t of texts) post.tags.push(namespace === null ? t : combineTag(namespace, t));
      return;
    }
    case CONTENT_TYPE_TITLE:
      for (const t of texts) post.titles.push({ title: htmlUnescape(t), priority: additionalInfo });
      return;
    case CONTENT_TYPE_VETO: {
      const [vetoIfMatchesFound, sm] = additionalInfo;
      const found = texts.some((t) => stringMatches(sm, t));
      if ((vetoIfMatchesFound && found) || (!vetoIfMatchesFound && !found)) throw new VetoError(`veto: ${name}`);
      return;
    }
    case CONTENT_TYPE_NOTES:
      for (const t of texts) post.notes.push({ name: additionalInfo, text: t });
      return;
    case CONTENT_TYPE_HASH: {
      const [type, encoding] = additionalInfo;
      for (const t of texts) post.hashes.push({ type, encoding, value: t });
      return;
    }
    case CONTENT_TYPE_TIMESTAMP:
      for (const t of texts) {
        // ParsedPost.GetTimestamp 只认能 int() 的文本
        if (/^\s*[+-]?\d+\s*$/.test(t)) post.timestamps.push({ type: additionalInfo, value: parseInt(t, 10) });
      }
      return;
    case CONTENT_TYPE_HTTP_HEADERS:
      for (const t of texts) post.headers.push({ name: additionalInfo, value: t });
      return;
    default:
      for (const t of texts) post.others.push({ contentType, name, text: t });
  }
}

/** html.unescape：用 textarea 的 RCDATA 解析只解码实体、不解析标签 */
function htmlUnescape(s) {
  if (!s.includes("&")) return s;
  const doc = new DOMParser().parseFromString(`<!doctype html><textarea>${s.replace(/<\/textarea/gi, "&lt;/textarea")}</textarea>`, "text/html");
  return doc?.querySelector("textarea")?.textContent ?? s;
}

/**
 * PageParser.Parse
 * @param {any} pageParser  升级后的 PAGE_PARSER 元组
 * @param {string} text  页面原文
 * @param {Record<string, string>} parsingContext  会被修改（post_index），与 hydrus 一样在一次解析中共用
 * @param {ParsingEnv} [env]
 */
export function parsePage(pageParser, text, parsingContext, env = new ParsingEnv()) {
  const [name, , converter, subsidiary, contentParsers] = infoOf(pageParser);
  let converted;
  try {
    converted = convert(converter, text);
  } catch (e) {
    if (e instanceof StringConvertError) throw new ParseError(`Page Parser ${name}: ${e.message}`);
    throw e;
  }
  const myPost = emptyPost();
  try {
    if (!Object.hasOwn(parsingContext, "post_index")) parsingContext.post_index = "0";
    for (const [, cp] of infoOf(contentParsers)) parseContent(cp, env, parsingContext, converted, myPost);
    if (myPost.urls.some((u) => u.urlType === URL_TYPE_DESIRED)) parsingContext.post_index = String(parseInt(parsingContext.post_index, 10) + 1);
  } catch (e) {
    if (e instanceof ParseError) throw new ParseError(`Page Parser ${name}: ${e.message}`);
    throw e;
  }
  const spps = infoOf(subsidiary).map(([, spp]) => spp);
  if (spps.length === 0) return postHasContent(myPost) ? [myPost] : [];
  const sorted = sortedBy(spps, (spp) => casefold(infoOf(infoOf(spp)[2])[0]));
  return sorted.flatMap((spp) => parseSubsidiary(spp, myPost, parsingContext, converted, env));
}

/** SubsidiaryPageParser.Parse：公式把页面切成多段，每段交给子解析器，每个结果再并上父级内容。 */
function parseSubsidiary(spp, parentPost, parsingContext, parsingText, env) {
  const [formula, sortPostsBySourceTime, pageParser] = infoOf(spp);
  const results = [];
  try {
    let texts;
    try {
      texts = parseFormula(formula, env, parsingContext, parsingText, false);
    } catch (e) {
      if (e instanceof ParseError) return results;
      throw e;
    }
    for (const t of texts) {
      if (t.length === 0) continue;
      let posts;
      try {
        posts = parsePage(pageParser, t, parsingContext, env);
      } catch (e) {
        if (e instanceof VetoError) continue;
        throw e;
      }
      for (const p of posts) {
        mergePost(p, parentPost);
        results.push(p);
      }
    }
    if (sortPostsBySourceTime) sortBySourceTime(results);
  } catch (e) {
    if (e instanceof ParseError) throw new ParseError(`Subsidiary Page Parser ${pageParser[1]}: ${e.message}`);
    throw e;
  }
  return results;
}

/** 最新的在前，没有来源时间的排最后（稳定排序） */
function sortBySourceTime(posts) {
  const key = (p) => sourceTimeOf(p);
  posts.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null || kb === null) return (ka === null ? 1 : 0) - (kb === null ? 1 : 0);
    return kb - ka;
  });
}

/** ParsedPost.GetTimestamp(TIMESTAMP_TYPE_MODIFIED_DOMAIN)：取最早的，且不晚于当前时间前 5 秒 */
export function sourceTimeOf(post) {
  const now = Math.floor(Date.now() / 1000);
  const ts = post.timestamps.filter((t) => t.type === TIMESTAMP_TYPE_MODIFIED_DOMAIN).map((t) => Math.min(now - 5, t.value));
  return ts.length === 0 ? null : Math.min(...ts);
}

/** ParsedPost.GetURLs(types, only_get_top_priority)：按优先级分组，取最高一组或全部，去重 */
export function urlsOf(post, urlTypes, onlyTopPriority = false) {
  const groups = new Map();
  for (const u of post.urls) {
    if (!urlTypes.includes(u.urlType)) continue;
    if (!groups.has(u.priority)) groups.set(u.priority, []);
    groups.get(u.priority).push(u.url);
  }
  let list;
  if (onlyTopPriority) {
    const top = groups.size === 0 ? null : Math.max(...groups.keys());
    list = top === null ? [] : groups.get(top);
  } else {
    list = [...groups.values()].flat();
  }
  return [...new Set(list)];
}

/** GetTitleFromParsedPosts：优先级最高的标题 */
export function titleOf(posts) {
  const titles = posts.flatMap((p) => p.titles).sort((a, b) => b.priority - a.priority || (a.title < b.title ? 1 : -1));
  return titles[0]?.title ?? null;
}

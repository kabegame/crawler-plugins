// hydrus 的 URL 处理：ClientNetworkingFunctions、URLClass、GalleryURLGenerator 与
// NetworkDomainManager 里 URL class 查找、解析器关联的执行语义。
import { HydrusUnsupportedError, infoOf, T } from "../serialisable/core.js";
import { makesChanges } from "../serialisable/strings.js";
import { ensureComponentIsEncoded, ensureParamComponentIsEncoded, ensurePathComponentIsEncoded, URL_TYPE_GALLERY, URL_TYPE_POST, URL_TYPE_WATCHABLE } from "../serialisable/url.js";
import { convert, processStrings, stringMatches } from "./strings.js";

const GALLERY_INDEX_TYPE_PATH_COMPONENT = 0;
const GALLERY_INDEX_TYPE_PARAMETER = 1;

// ---- ClientNetworkingFunctions ----

/**
 * ParseURL 之前的 url.strip() 与 UnicodeNormaliseURL：netloc（第一个 / 之前）做 NFKC 规范化，
 * 其中的 ? 和 # 换成 _（urllib 遇到这些字符会出错）。
 */
function cleanUrlText(url) {
  url = url.trim();
  if (url.startsWith("file:")) return url;
  const i = url.indexOf("://");
  if (i < 0) return url;
  const rest = url.slice(i + 3);
  const j = rest.indexOf("/");
  const netloc = (j < 0 ? rest : rest.slice(0, j)).normalize("NFKC").replace(/[?#]/g, "_");
  return `${url.slice(0, i)}://${netloc}${j < 0 ? "" : rest.slice(j)}`;
}

/** ClientNetworkingFunctions.ParseURL：urllib.parse.urlparse 的子集，保留原始（未解码）的各部分。 */
export function parseUrl(url) {
  url = cleanUrlText(url);
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(url);
  if (!m) return null;
  return { scheme: m[1].toLowerCase(), netloc: m[2], path: m[3], query: m[4] ?? "", fragment: m[5] ?? "" };
}

/** urllib.parse.urlunparse，params 恒为空。 */
export function unparseUrl({ scheme, netloc, path, query, fragment }) {
  return `${scheme}://${netloc}${path}${query ? `?${query}` : ""}${fragment ? `#${fragment}` : ""}`;
}

export function looksLikeAFullUrl(text) {
  const p = parseUrl(text);
  return !!p && p.scheme !== "" && p.netloc !== "";
}

/** 新式规则：只去掉一个开头的 /。 */
export function pathTextToList(path) {
  return (path.startsWith("/") ? path.slice(1) : path).split("/");
}

/** ConvertQueryTextToDict */
export function queryTextToDict(queryText) {
  const dict = new Map();
  const singleValues = [];
  const order = [];
  for (const pair of queryText.split("&")) {
    const i = pair.indexOf("=");
    if (i < 0) {
      if (pair === "") continue;
      singleValues.push(pair);
      order.push(null);
    } else {
      const key = pair.slice(0, i);
      order.push(key);
      dict.set(key, pair.slice(i + 1));
    }
  }
  return { dict, singleValues, order };
}

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** ConvertQueryDictToText；order 为 null 时按字母序。 */
export function queryDictToText(dict, singleValues, order = null) {
  if (order === null) {
    order = [...dict.keys()].sort(byCodePoint);
    singleValues = [...singleValues].sort(byCodePoint);
    for (let i = 0; i < singleValues.length; i++) order.push(null);
  }
  const params = [];
  let sv = 0;
  for (const key of order) {
    if (key === null) {
      if (sv < singleValues.length) params.push(singleValues[sv++]);
    } else if (dict.has(key)) {
      params.push(`${key}=${dict.get(key)}`);
    }
  }
  return params.join("&");
}

/** EnsureURLIsEncoded */
export function ensureUrlIsEncoded(url, keepFragment = true) {
  if (!looksLikeAFullUrl(url)) return url;
  const p = parseUrl(url);
  const { dict, singleValues, order } = queryTextToDict(p.query);
  const encDict = new Map([...dict].map(([k, v]) => [ensureParamComponentIsEncoded(k), ensureParamComponentIsEncoded(v)]));
  return unparseUrl({
    scheme: p.scheme,
    netloc: p.netloc,
    path: "/" + pathTextToList(p.path).map(ensurePathComponentIsEncoded).join("/"),
    query: queryDictToText(encDict, singleValues.map(ensureParamComponentIsEncoded), order.map((k) => (k === null ? null : ensureParamComponentIsEncoded(k)))),
    fragment: keepFragment ? p.fragment : "",
  });
}

/** urllib.parse.urljoin 的近似：用 WHATWG URL 解析相对地址。 */
export function urlJoin(base, url) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- URL class ----

/**
 * 把升级后的 URL_CLASS 元组读成对象。
 * @param {Map<string, string>} [paramOverrides]  用户对参数默认值的覆盖（相当于在 hydrus 里编辑 URL class）：
 *   值非空时替换默认值且不再做默认值处理；值为空时去掉默认值，该参数缺省时不再补上。
 */
export function readUrlClass(tuple, paramOverrides = new Map()) {
  const [
    key,
    urlType,
    preferredScheme,
    domainMask,
    booleans,
    pathComponents,
    parameters,
    hasSingleValueParameters,
    singleValueParametersMatch,
    headerOverrides,
    apiLookupConverter,
    sendReferralUrl,
    referralUrlConverter,
    galleryIndexType,
    galleryIndexIdentifier,
    galleryIndexDelta,
    exampleUrl,
  ] = infoOf(tuple);
  const [rawDomains, domainRegexes, matchSubdomains, keepMatchedSubdomains] = infoOf(domainMask);
  const [alphabetise, noMorePath, noMoreParams, keepExtraForServer, canProduceMultipleFiles, shouldBeAssociatedWithFiles, keepFragment] = booleans;
  const regexes = [...domainRegexes, ...rawDomains.map(reEscape)].sort(byCodePoint);
  return {
    name: tuple[1],
    key,
    urlType,
    preferredScheme,
    domain: {
      match: regexes.map((r) => new RegExp((matchSubdomains ? "^(.*\\.)?" : "^(www[^\\.]*\\.)?") + r + "$")),
      clip: regexes.map((r) => new RegExp(r + "$")),
      keepMatchedSubdomains,
      // URLDomainMask.GetSortingComplexity
      sortingComplexity: rawDomains.length + domainRegexes.length === 0 ? 10 : Math.max(...[...rawDomains, ...domainRegexes].map((d) => [...d].length)),
    },
    alphabetise,
    noMorePath,
    noMoreParams,
    keepExtraForServer,
    canProduceMultipleFiles,
    shouldBeAssociatedWithFiles,
    keepFragment,
    pathComponents: pathComponents.map(([match, defaultValue]) => ({ match, defaultValue })),
    parameters: infoOf(parameters).map(([, p]) => {
      if (p[0] !== T.URL_CLASS_PARAMETER_FIXED_NAME) throw new HydrusUnsupportedError(`URL class "${tuple[1]}" 使用了未实现的参数类型`);
      const [name, match, isEphemeral, defaultValue, defaultValueProcessor] = infoOf(p);
      if (defaultValue !== null && paramOverrides.has(name)) {
        const value = paramOverrides.get(name);
        if (value === "") return { name, match, isEphemeral: true, defaultValue: null, defaultValueProcessor };
        return { name, match, isEphemeral, defaultValue: ensureParamComponentIsEncoded(value), defaultValueProcessor: null };
      }
      return { name, match, isEphemeral, defaultValue, defaultValueProcessor };
    }),
    hasSingleValueParameters,
    singleValueParametersMatch,
    headerOverrides: new Map(headerOverrides),
    apiLookupConverter,
    usesApiUrl: makesChanges(apiLookupConverter),
    sendReferralUrl,
    referralUrlConverter,
    galleryIndexType,
    galleryIndexIdentifier,
    galleryIndexDelta,
    exampleUrl,
  };
}

function hostOf(netloc) {
  return netloc.replace(/^.*@/, "").replace(/:\d+$/, "").toLowerCase();
}

/** URLClass.Test 的布尔版本（Matches）。 */
export function urlClassMatches(uc, url) {
  const p = parseUrl(ensureUrlIsEncoded(url));
  if (!p) return false;
  if (!uc.domain.match.some((re) => re.test(p.netloc))) return false;

  const components = pathTextToList(p.path);
  if (uc.noMorePath && components.length > uc.pathComponents.length) return false;
  for (const [i, { match, defaultValue }] of uc.pathComponents.entries()) {
    if (i < components.length) {
      if (!stringMatches(match, components[i])) return false;
    } else if (defaultValue === null) {
      return false;
    }
  }

  const { dict, singleValues } = queryTextToDict(p.query);
  if (uc.noMoreParams) {
    const names = new Set(uc.parameters.map((x) => x.name));
    for (const name of dict.keys()) if (!names.has(name)) return false;
  }
  for (const param of uc.parameters) {
    if (!dict.has(param.name)) {
      if (param.defaultValue === null && !param.isEphemeral) return false;
      continue;
    }
    if (!stringMatches(param.match, dict.get(param.name))) return false;
  }
  if (singleValues.length > 0 && !uc.hasSingleValueParameters && uc.noMoreParams) return false;
  if (uc.hasSingleValueParameters) {
    if (singleValues.length === 0) return false;
    if (!singleValues.every((v) => stringMatches(uc.singleValueParametersMatch, v))) return false;
  }
  return true;
}

/** URLClassParameterFixedName.GetDefaultValue(with_processing=True)：处理失败或没有结果时用原值 */
function processedDefaultValue(param) {
  if (param.defaultValueProcessor === null) return param.defaultValue;
  try {
    const out = processStrings(param.defaultValueProcessor, [param.defaultValue]);
    return out.length > 0 ? out[0] : param.defaultValue;
  } catch {
    return param.defaultValue;
  }
}

/** URLClass.GetAPIURL */
export function apiUrl(uc, url) {
  return convert(uc.apiLookupConverter, normaliseUrl(uc, url, true));
}

function clipNetloc(uc, netloc) {
  if (uc.domain.keepMatchedSubdomains) return netloc;
  const host = netloc.replace(/:\d+$/, "");
  const port = netloc.slice(host.length);
  for (const re of uc.domain.clip) {
    const m = re.exec(host);
    if (m) return m[0] + port;
  }
  throw new Error(`域名 ${netloc} 与 URL class "${uc.name}" 不匹配`);
}

/** URLClass.Normalise */
export function normaliseUrl(uc, url, forServer = false) {
  const p = parseUrl(url);
  const components = pathTextToList(p.path);

  let pathParts = components;
  if (uc.usesApiUrl || !forServer || components.length < uc.pathComponents.length) {
    pathParts = uc.pathComponents.map(({ defaultValue }, i) => {
      if (i < components.length) return components[i];
      if (defaultValue !== null) return defaultValue;
      throw new Error("URL 路径段不够");
    });
  }

  const { dict, singleValues, order } = queryTextToDict(p.query);
  const keyToParam = new Map();
  const remaining = new Set(dict.keys());
  for (const param of uc.parameters) {
    if (remaining.has(param.name)) {
      keyToParam.set(param.name, param);
      remaining.delete(param.name);
    } else if (param.defaultValue !== null) {
      keyToParam.set(param.name, param);
      dict.set(param.name, processedDefaultValue(param));
      order.push(param.name);
    } else if (!param.isEphemeral) {
      throw new Error(`URL 缺少参数 ${param.name}`);
    }
  }
  for (const name of remaining) keyToParam.set(name, null);
  const filtered = new Map();
  for (const [name, param] of keyToParam) {
    if (param === null) {
      if (!(forServer && uc.keepExtraForServer)) continue;
    } else if (param.isEphemeral && !forServer) {
      continue;
    }
    filtered.set(name, dict.get(name));
  }
  const wantSingle = uc.hasSingleValueParameters || (forServer && uc.keepExtraForServer);

  return unparseUrl({
    scheme: uc.preferredScheme,
    netloc: clipNetloc(uc, p.netloc),
    path: "/" + pathParts.join("/"),
    query: queryDictToText(filtered, wantSingle ? singleValues : [], uc.alphabetise ? null : order),
    fragment: uc.keepFragment ? p.fragment : "",
  });
}

/** URLClass.CanGenerateNextGalleryPage */
export function canGenerateNextGalleryPage(uc) {
  return uc.urlType === URL_TYPE_GALLERY && uc.galleryIndexType !== null;
}

/** URLClass.GetNextGalleryPage */
export function nextGalleryPage(uc, url) {
  const p = parseUrl(normaliseUrl(uc, url, true));
  if (uc.galleryIndexType === GALLERY_INDEX_TYPE_PATH_COMPONENT) {
    const parts = pathTextToList(p.path);
    const index = parts[uc.galleryIndexIdentifier];
    if (index === undefined || !/^\s*[+-]?\d+\s*$/.test(index)) throw new Error("无法从路径生成下一页");
    parts[uc.galleryIndexIdentifier] = String(parseInt(index, 10) + uc.galleryIndexDelta);
    p.path = "/" + parts.join("/");
  } else if (uc.galleryIndexType === GALLERY_INDEX_TYPE_PARAMETER) {
    const { dict, singleValues, order } = queryTextToDict(p.query);
    const index = dict.get(uc.galleryIndexIdentifier);
    if (index === undefined || !/^\s*[+-]?\d+\s*$/.test(index)) throw new Error(`参数里没有可递增的 ${uc.galleryIndexIdentifier}`);
    dict.set(uc.galleryIndexIdentifier, String(parseInt(index, 10) + uc.galleryIndexDelta));
    p.query = queryDictToText(dict, uc.hasSingleValueParameters ? singleValues : [], uc.alphabetise ? null : order);
  } else {
    throw new Error("不认识的翻页规则");
  }
  return unparseUrl(p);
}

/** URLClass.GetSortingComplexityKey，用于「最具体的 URL class 优先」。 */
function complexityKey(uc) {
  let exampleLen = uc.exampleUrl.length;
  try {
    exampleLen = normaliseUrl(uc, uc.exampleUrl, true).length;
  } catch {
    // 与 hydrus 一致，失败时退回原示例长度
  }
  return [
    uc.domain.sortingComplexity,
    uc.pathComponents.filter((c) => c.defaultValue === null).length,
    uc.pathComponents.length,
    uc.parameters.filter((x) => x.defaultValue === null).length,
    uc.parameters.length,
    exampleLen,
  ];
}

function compareTuples(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** URLClass.IsParsable */
export const isParsable = (uc) => uc.urlType === URL_TYPE_POST || uc.urlType === URL_TYPE_GALLERY || uc.urlType === URL_TYPE_WATCHABLE;

/** SortURLClassesListDescendingComplexity：稳定排序，最具体的在前 */
export function sortByDescendingComplexity(urlClasses) {
  return urlClasses
    .map((uc) => ({ uc, key: complexityKey(uc) }))
    .sort((a, b) => compareTuples(b.key, a.key))
    .map((x) => x.uc);
}

/** ConvertURLClassesIntoAPIPairs：会转成 API 地址、且 API 地址能被另一个 URL class 认出的那些 */
export function apiPairs(urlClasses) {
  const pairs = [];
  for (const uc of urlClasses) {
    if (!uc.usesApiUrl) continue;
    let api;
    try {
      api = apiUrl(uc, ensureUrlIsEncoded(uc.exampleUrl));
    } catch {
      continue;
    }
    const other = urlClasses.find((o) => o !== uc && urlClassMatches(o, api));
    if (other) pairs.push([uc, other]);
  }
  return pairs;
}

/**
 * NetworkDomainManager.STATICLinkURLClassesAndParsers：按解析器名排序，用每个示例 URL 按「最具体优先」
 * 找到第一个匹配的 URL class；会转成 API 地址的 URL class 由 API 的解析器负责，不参与关联。
 * 已在 existing 里或本轮已关联的 URL class 不再改动。
 * @param {any[]} urlClasses  readUrlClass 读出的对象
 * @param {any[]} parsers  PAGE_PARSER 元组
 * @param {Map<string, string>} existing  URL class key → 解析器 key
 * @returns {Map<string, string>} 新增的关联
 */
export function linkUrlClassesAndParsers(urlClasses, parsers, existing) {
  const sorted = sortByDescendingComplexity(urlClasses);
  const unparsable = new Set(apiPairs(sorted).map(([a]) => a));
  const links = new Map();
  for (const parser of [...parsers].sort((a, b) => byCodePoint(a[1], b[1]))) {
    for (const exampleUrl of infoOf(parser)[5]) {
      const uc = sorted.find((c) => !unparsable.has(c) && urlClassMatches(c, exampleUrl));
      if (uc && isParsable(uc) && !existing.has(uc.key) && !links.has(uc.key)) links.set(uc.key, infoOf(parser)[1]);
    }
  }
  return links;
}

/**
 * 一组 downloader 对象的查找表：URL → URL class → 解析器。
 * links 是下载器库里存的关联（URL class key → 解析器 key）；不传时按 hydrus 导入时的自动关联规则现算。
 */
export class DomainManager {
  /**
   * @param {{ urlClasses: any[], parsers: any[], links?: Map<string, string> }} objects  升级后的元组
   * @param {Map<string, string>} [paramOverrides]  见 readUrlClass
   */
  constructor({ urlClasses, parsers, links }, paramOverrides = new Map()) {
    this.urlClasses = sortByDescendingComplexity(urlClasses.map((t) => readUrlClass(t, paramOverrides)));
    this.parsers = [...parsers].sort((a, b) => byCodePoint(a[1], b[1]));
    const parserByKey = new Map(this.parsers.map((p) => [infoOf(p)[1], p]));
    const linkKeys = links ?? linkUrlClassesAndParsers(this.urlClasses, this.parsers, new Map());
    this.parserByUrlClassKey = new Map();
    for (const [ucKey, parserKey] of linkKeys) {
      const parser = parserByKey.get(parserKey);
      if (parser) this.parserByUrlClassKey.set(ucKey, parser);
    }
  }

  urlClassFor(url) {
    return this.urlClasses.find((uc) => urlClassMatches(uc, url)) ?? null;
  }

  /** _GetNormalisedAPIURLClassAndURL：沿 API 转换链走到最终的 URL class，返回规范化后的请求地址。 */
  apiTarget(url) {
    const first = this.urlClassFor(url);
    if (!first) return null;
    const seen = new Set([first]);
    let uc = first;
    let api = url;
    while (uc.usesApiUrl) {
      api = apiUrl(uc, api);
      const next = this.urlClassFor(api);
      if (!next) throw new Error(`找不到 ${api} 的 URL class（由 ${url} 经 API 转换而来）`);
      if (seen.has(next)) throw new Error(`${url} 的 API 转换形成了环（${seen.size} 个 URL class）`);
      seen.add(next);
      uc = next;
    }
    return { urlClass: uc, url: normaliseUrl(uc, api, true), originalUrlClass: first };
  }

  /** GetURLToFetchAndParser；URL 不认识时返回 null，parser 为 null 表示没有关联的解析器。 */
  fetchTarget(url) {
    const t = this.apiTarget(url);
    if (!t) return null;
    return { ...t, parser: this.parserByUrlClassKey.get(t.urlClass.key) ?? null };
  }
}

/** GalleryURLGenerator.GenerateGalleryURL */
export function generateGalleryUrl(gug, queryText) {
  const [, template, phrase, separator] = infoOf(gug);
  if (phrase === "" || !template.includes(phrase)) throw new Error(`GUG "${gug[1]}" 的 URL 模板没有替换占位符`);
  const terms = queryText.replace(/%20/g, " ").split(" ");
  const q = template.indexOf("?");
  const tagsInParams = q >= 0 && template.slice(q + 1).includes(phrase);
  const encoded = terms.map((t) => (tagsInParams ? ensureComponentIsEncoded(t, "") : ensurePathComponentIsEncoded(t)));
  return ensureUrlIsEncoded(template.split(phrase).join(encoded.join(separator)));
}

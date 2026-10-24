// ClientNetworkingGUG.py 与 ClientNetworkingURLClass.py 中序列化相关的部分。
import { dictObjectItems, infoOf, listObjects, load, normaliseHex, pyBool, pyDictItems, register, serialisableList, T } from "./core.js";
import { makesChanges, STRING_MATCH_FIXED, stringConverter, stringMatch, stringProcessor } from "./strings.js";

// HydrusConstants.URL_TYPE_*
export const URL_TYPE_POST = 0;
export const URL_TYPE_API = 1;
export const URL_TYPE_FILE = 2;
export const URL_TYPE_GALLERY = 3;
export const URL_TYPE_WATCHABLE = 4;
export const URL_TYPE_UNKNOWN = 5;
export const URL_TYPE_NEXT = 6;
export const URL_TYPE_DESIRED = 7;
export const URL_TYPE_SOURCE = 8;
export const URL_TYPE_SUB_GALLERY = 9;

export const SEND_REFERRAL_URL_ONLY_IF_PROVIDED = 0;

// ---- ClientNetworkingFunctions 的 URL 组件编码 ----

const PARAM_EXCEPTION_CHARS = "!$&'()*+,;=@:/?";
const PATH_EXCEPTION_CHARS = "!$&'()*+,;=@:";
const ALWAYS_SAFE = /^[A-Za-z0-9_.\-~]$/;

/** urllib.parse.quote(s, safe=...) */
export function pyQuote(s, safe) {
  let out = "";
  for (const b of new TextEncoder().encode(s)) {
    const ch = String.fromCharCode(b);
    if (b < 0x80 && (ALWAYS_SAFE.test(ch) || safe.includes(ch))) out += ch;
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** ensure_component_is_encoded：幂等编码，已编码的 %XX 不再二次编码，孤立的 % 编成 %25。 */
export function ensureComponentIsEncoded(mixed, safeChars) {
  return mixed
    .split("%")
    .map((part, i) => (i > 0 ? (/^[0-9A-Fa-f]{2}/.test(part) ? "%" : "%25") : "") + pyQuote(part, safeChars))
    .join("");
}

export const ensureParamComponentIsEncoded = (s) => ensureComponentIsEncoded(s, PARAM_EXCEPTION_CHARS);
export const ensurePathComponentIsEncoded = (s) => ensureComponentIsEncoded(s, PATH_EXCEPTION_CHARS);

// ---- GalleryURLGenerator ----

register({
  type: T.GALLERY_URL_GENERATOR,
  version: 1,
  named: true,
  normalise: ([key, urlTemplate, replacementPhrase, separator, initialSearchText, exampleSearchText]) => [
    normaliseHex(key),
    urlTemplate,
    replacementPhrase,
    separator,
    initialSearchText,
    exampleSearchText,
  ],
});

// NestedGalleryURLGenerator：只存子 GUG 的 (key, name)，执行时由 domain manager 先按 key、再按名字找回子 GUG
register({
  type: T.NESTED_GALLERY_URL_GENERATOR,
  version: 1,
  named: true,
  normalise: ([key, initialSearchText, gugKeysAndNames]) => [
    normaliseHex(key),
    initialSearchText,
    gugKeysAndNames.map(([gugKey, gugName]) => [normaliseHex(gugKey), gugName]),
  ],
});

// ---- URLDomainMask ----

const sortedStrings = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** URLDomainMask(raw_domains, domain_regexes, match_subdomains, keep_matched_subdomains).GetSerialisableTuple() */
export function urlDomainMask({ rawDomains = [], domainRegexes = [], matchSubdomains = false, keepMatchedSubdomains = false } = {}) {
  return [T.URL_DOMAIN_MASK, 1, [sortedStrings(rawDomains), sortedStrings(domainRegexes), matchSubdomains, keepMatchedSubdomains]];
}

register({
  type: T.URL_DOMAIN_MASK,
  version: 1,
  normalise: ([rawDomains, domainRegexes, matchSubdomains, keepMatchedSubdomains]) =>
    infoOf(
      urlDomainMask({
        rawDomains,
        domainRegexes,
        matchSubdomains,
        // 兼容 hydrus 修过的坏数据：非 bool 时强制转换
        keepMatchedSubdomains: typeof keepMatchedSubdomains === "boolean" ? keepMatchedSubdomains : pyBool(keepMatchedSubdomains),
      }),
    ),
});

// ---- URLClassParameterFixedName ----

/** URLClassParameterFixedName(name, value_string_match) 并可选 SetDefaultValue */
export function urlClassParameterFixedName({ name, valueStringMatch, defaultValue = null }) {
  return [T.URL_CLASS_PARAMETER_FIXED_NAME, 2, [name, valueStringMatch, false, defaultValue, stringProcessor()]];
}

register({
  type: T.URL_CLASS_PARAMETER_FIXED_NAME,
  version: 2,
  upgrade: {
    // 注意 hydrus 这里用的是 StringConverter() 而不是 StringProcessor()，照搬
    1: ([name, valueStringMatch, defaultValue]) => [2, [name, valueStringMatch, false, defaultValue, stringConverter()]],
  },
  normalise: ([name, valueStringMatch, isEphemeral, defaultValue, defaultValueProcessor], ctx) => [
    name,
    load(valueStringMatch, ctx),
    isEphemeral,
    defaultValue,
    load(defaultValueProcessor, ctx),
  ],
});

// ---- URLClass ----

function encodeFixedStringMatch(sm, encode) {
  const [matchType, matchValue, minChars, maxChars, exampleString] = infoOf(sm);
  if (matchType !== STRING_MATCH_FIXED) return sm;
  return stringMatch({ matchType, matchValue: encode(matchValue), minChars, maxChars, exampleString: encode(exampleString) });
}

register({
  type: T.URL_CLASS,
  version: 15,
  named: true,
  upgrade: {
    1: ([urlType, scheme, netloc, matchSub, keepSub, pathComponents, parameters, exampleUrl], ctx) => [
      2,
      [ctx.generateKey(), urlType, scheme, netloc, matchSub, keepSub, pathComponents, parameters, stringConverter([], exampleUrl), exampleUrl],
    ],
    2: ([key, urlType, scheme, netloc, matchSub, keepSub, pathComponents, parameters, apiLookup, exampleUrl]) => {
      const shouldBeAssociatedWithFiles = urlType === URL_TYPE_FILE || urlType === URL_TYPE_POST;
      return [3, [key, urlType, scheme, netloc, matchSub, keepSub, pathComponents, parameters, apiLookup, shouldBeAssociatedWithFiles, exampleUrl]];
    },
    3: ([key, urlType, scheme, netloc, matchSub, keepSub, pathComponents, parameters, apiLookup, assoc, exampleUrl]) => [
      4,
      [key, urlType, scheme, netloc, matchSub, keepSub, pathComponents, parameters, apiLookup, false, assoc, exampleUrl],
    ],
    4: ([key, urlType, scheme, netloc, matchSub, keepSub, pathComponents, parameters, apiLookup, multi, assoc, exampleUrl]) => [
      5,
      [key, urlType, scheme, netloc, matchSub, keepSub, pathComponents, parameters, apiLookup, multi, assoc, null, null, 1, exampleUrl],
    ],
    5: (info, ctx) => {
      const [key, urlType, scheme, netloc, matchSub, keepSub, pathComponents, parameters, ...rest] = info;
      // 旧格式：路径段是 SerialisableList[StringMatch]，参数是 SerialisableDictionary{name: StringMatch}
      const newPath = listObjects(pathComponents, ctx).map((sm) => [sm, null]);
      const newParams = dictObjectItems(parameters, ctx).map(([name, sm]) => [name, [sm, null]]);
      return [6, [key, urlType, scheme, netloc, matchSub, keepSub, newPath, newParams, ...rest]];
    },
    6: (info) => {
      const [key, urlType, scheme, netloc, matchSub, keepSub, path, params, apiLookup, ...rest] = info;
      const referral = stringConverter([], "https://hostname.com/post/page.php?id=123456&s=view");
      return [7, [key, urlType, scheme, netloc, matchSub, keepSub, path, params, apiLookup, SEND_REFERRAL_URL_ONLY_IF_PROVIDED, referral, ...rest]];
    },
    7: (info) => {
      const [key, urlType, scheme, netloc, matchSub, keepSub, ...rest] = info;
      return [8, [key, urlType, scheme, netloc, matchSub, keepSub, true, ...rest]];
    },
    8: (info) => {
      const [key, urlType, scheme, netloc, matchSub, keepSub, alphabetise, path, params, apiLookup, sendReferral, referral, multi, assoc, giType, giId, giDelta, exampleUrl] = info;
      const booleans = [matchSub, keepSub, alphabetise, multi, assoc, false];
      return [9, [key, urlType, scheme, netloc, booleans, path, params, apiLookup, sendReferral, referral, giType, giId, giDelta, exampleUrl]];
    },
    9: (info) => {
      const [key, urlType, scheme, netloc, booleans, path, params, ...rest] = info;
      return [10, [key, urlType, scheme, netloc, booleans, path, params, [], ...rest]];
    },
    10: (info) => {
      const [key, urlType, scheme, netloc, booleans, path, params, ...rest] = info;
      return [11, [key, urlType, scheme, netloc, booleans, path, params, false, stringMatch(), ...rest]];
    },
    11: (info) => {
      const [matchSub, keepSub, alphabetise, multi, assoc, keepFragment] = info[4];
      const out = [...info];
      out[4] = [matchSub, keepSub, alphabetise, false, false, multi, assoc, keepFragment];
      return [12, out];
    },
    12: (info, ctx) => {
      const out = [...info];
      const params = info[6].map(([name, [sm, defaultValue]]) =>
        urlClassParameterFixedName({
          // post[id] -> post%5Bid%5D
          name: ensureParamComponentIsEncoded(name),
          valueStringMatch: encodeFixedStringMatch(load(sm, ctx), ensureParamComponentIsEncoded),
          defaultValue: defaultValue === null ? null : ensureParamComponentIsEncoded(defaultValue),
        }),
      );
      out[6] = serialisableList(params);
      out[5] = info[5].map(([sm, defaultValue]) => [
        encodeFixedStringMatch(load(sm, ctx), ensurePathComponentIsEncoded),
        defaultValue === null ? null : ensurePathComponentIsEncoded(defaultValue),
      ]);
      return [13, out];
    },
    13: (info, ctx) => {
      const urlType = info[1];
      const [matchSub, keepSub, alphabetise, noMorePath, noMoreParams, multi, assoc, keepFragment] = info[4];
      const apiLookup = load(info[10], ctx);
      const keepExtra = !(noMoreParams || makesChanges(apiLookup) || (urlType !== URL_TYPE_GALLERY && urlType !== URL_TYPE_WATCHABLE));
      const out = [...info];
      out[4] = [matchSub, keepSub, alphabetise, noMorePath, noMoreParams, keepExtra, multi, assoc, keepFragment];
      return [14, out];
    },
    14: (info) => {
      const netloc = info[3];
      const [matchSub, keepSub, ...booleans] = info[4];
      const out = [...info];
      out[3] = urlDomainMask({ rawDomains: [netloc], matchSubdomains: matchSub, keepMatchedSubdomains: keepSub });
      out[4] = booleans;
      return [15, out];
    },
  },
  normalise: (info, ctx) => {
    const [
      key,
      urlType,
      scheme,
      domainMask,
      booleans,
      pathComponents,
      parameters,
      hasSingleValueParameters,
      singleValueParametersMatch,
      headerOverrides,
      apiLookup,
      sendReferral,
      referral,
      giType,
      giId,
      giDelta,
      exampleUrl,
    ] = info;
    const [alphabetise, noMorePath, noMoreParams, keepExtra, multi, assoc, keepFragment] = booleans;
    return [
      normaliseHex(key),
      urlType,
      scheme,
      load(domainMask, ctx),
      [alphabetise, noMorePath, noMoreParams, noMoreParams ? false : keepExtra, multi, assoc, keepFragment],
      pathComponents.map(([sm, defaultValue]) => [load(sm, ctx), defaultValue]),
      load(parameters, ctx),
      hasSingleValueParameters,
      load(singleValueParametersMatch, ctx),
      pyDictItems(headerOverrides),
      load(apiLookup, ctx),
      sendReferral,
      load(referral, ctx),
      giType,
      giId,
      giDelta,
      exampleUrl,
    ];
  },
});

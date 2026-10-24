// hydrus/client/parsing/ClientParsing.py 中序列化相关的部分。
import { casefold, HydrusUnsupportedError, infoOf, load, normaliseHex, register, serialisableList, sortedBy, T, typeName, withInfo } from "./core.js";
import {
  CONTENT_PARSER_SORT_TYPE_NONE,
  makesChanges,
  STRING_CONVERSION_APPEND_TEXT,
  STRING_CONVERSION_CLIP_TEXT_FROM_BEGINNING,
  STRING_CONVERSION_CLIP_TEXT_FROM_END,
  STRING_CONVERSION_PREPEND_TEXT,
  STRING_CONVERSION_REMOVE_TEXT_FROM_BEGINNING,
  STRING_CONVERSION_REMOVE_TEXT_FROM_END,
  STRING_MATCH_FIXED,
  STRING_MATCH_REGEX,
  stringConverter,
  stringMatch,
  stringProcessor,
  stringSorter,
} from "./strings.js";
import { URL_TYPE_DESIRED, URL_TYPE_FILE, URL_TYPE_NEXT, URL_TYPE_POST, URL_TYPE_SOURCE } from "./url.js";

// HydrusConstants.CONTENT_TYPE_*
export const CONTENT_TYPE_MAPPINGS = 0;
export const CONTENT_TYPE_URLS = 7;
export const CONTENT_TYPE_VETO = 8;
export const CONTENT_TYPE_HASH = 15;

export const HTML_CONTENT_ATTRIBUTE = 0;
export const HTML_CONTENT_STRING = 1;
export const HTML_CONTENT_HTML = 2;

export const HTML_RULE_TYPE_DESCENDING = 0;
export const HTML_RULE_TYPE_ASCENDING = 1;
export const HTML_RULE_TYPE_NEXT_SIBLINGS = 2;
export const HTML_RULE_TYPE_PREV_SIBLINGS = 3;

// ---- ParseRuleHTML ----

/** ParseRuleHTML(...).GetSerialisableTuple()，默认值同 hydrus 构造函数 */
export function parseRuleHTML({ ruleType = null, tagName = null, tagAttributes = null, tagIndex = null, tagDepth = null } = {}) {
  if (ruleType === null) {
    ruleType = HTML_RULE_TYPE_DESCENDING;
    if (tagName === null) tagName = "a";
  }
  if ([HTML_RULE_TYPE_DESCENDING, HTML_RULE_TYPE_NEXT_SIBLINGS, HTML_RULE_TYPE_PREV_SIBLINGS].includes(ruleType)) {
    if (tagAttributes === null) tagAttributes = {};
  } else if (ruleType === HTML_RULE_TYPE_ASCENDING) {
    if (tagDepth === null) tagDepth = 1;
  }
  return [T.PARSE_RULE_HTML, 3, [ruleType, tagName, tagAttributes, tagIndex, tagDepth, false, stringMatch()]];
}

register({
  type: T.PARSE_RULE_HTML,
  version: 3,
  upgrade: {
    1: ([ruleType, tagName, tagAttributes, tagIndex, tagDepth]) => [2, [ruleType, tagName, tagAttributes, tagIndex, tagDepth, false, stringMatch()]],
    2: (info) => [3, info],
  },
  normalise: ([ruleType, tagName, tagAttributes, tagIndex, tagDepth, shouldTestTagString, tagStringMatch], ctx) => [
    ruleType,
    tagName,
    tagAttributes,
    tagIndex,
    tagDepth,
    shouldTestTagString,
    load(tagStringMatch, ctx),
  ],
});

// ---- ParseFormulaHTML ----

register({
  type: T.PARSE_FORMULA_HTML,
  version: 8,
  upgrade: {
    1: ([tagRules, attributeToFetch]) => [2, [tagRules, attributeToFetch, [0, 0, "", ""]]],
    2: ([tagRules, attributeToFetch, [cullFront, cullBack, prepend, append]]) => {
      const conversions = [];
      if (cullFront > 0) conversions.push([STRING_CONVERSION_CLIP_TEXT_FROM_BEGINNING, cullFront]);
      else if (cullFront < 0) conversions.push([STRING_CONVERSION_REMOVE_TEXT_FROM_END, cullFront]);
      if (cullBack > 0) conversions.push([STRING_CONVERSION_CLIP_TEXT_FROM_END, cullBack]);
      else if (cullBack < 0) conversions.push([STRING_CONVERSION_REMOVE_TEXT_FROM_BEGINNING, cullBack]);
      if (prepend !== "") conversions.push([STRING_CONVERSION_PREPEND_TEXT, prepend]);
      if (append !== "") conversions.push([STRING_CONVERSION_APPEND_TEXT, append]);
      return [3, [tagRules, attributeToFetch, stringConverter(conversions, "parsed information")]];
    },
    3: ([tagRules, attributeToFetch, converter]) => [4, [tagRules, attributeToFetch, stringMatch(), converter]],
    4: ([tagRules, attributeToFetch, match, converter]) =>
      attributeToFetch === null
        ? [5, [tagRules, HTML_CONTENT_STRING, "", match, converter]]
        : [5, [tagRules, HTML_CONTENT_ATTRIBUTE, attributeToFetch, match, converter]],
    5: ([tagRules, contentToFetch, attributeToFetch, match, converter]) => {
      // 旧格式的 tag rule 是 (name, attrs, index) 三元组
      const rules = tagRules.map(([tagName, tagAttributes, tagIndex]) => parseRuleHTML({ ruleType: HTML_RULE_TYPE_DESCENDING, tagName, tagAttributes, tagIndex }));
      return [6, [serialisableList(rules), contentToFetch, attributeToFetch, match, converter]];
    },
    6: ([tagRules, contentToFetch, attributeToFetch, match, converter], ctx) => {
      const steps = [load(match, ctx), load(converter, ctx)].filter(makesChanges);
      return [7, [tagRules, contentToFetch, attributeToFetch, stringProcessor(steps)]];
    },
    7: ([tagRules, contentToFetch, attributeToFetch, processor]) => [8, [tagRules, contentToFetch, attributeToFetch, "", processor]],
  },
  normalise: ([tagRules, contentToFetch, attributeToFetch, name, processor], ctx) => [load(tagRules, ctx), contentToFetch, attributeToFetch, name, load(processor, ctx)],
});

// ---- ParseFormulaJSON ----

export const JSON_CONTENT_STRING = 0;
export const JSON_CONTENT_JSON = 1;
export const JSON_CONTENT_DICT_KEYS = 2;

export const JSON_PARSE_RULE_TYPE_DICT_KEY = 0;
export const JSON_PARSE_RULE_TYPE_ALL_ITEMS = 1;
export const JSON_PARSE_RULE_TYPE_INDEXED_ITEM = 2;
export const JSON_PARSE_RULE_TYPE_DEMINIFY_JSON = 3;
export const JSON_PARSE_RULE_TYPE_ASCEND = 4;
export const JSON_PARSE_RULE_TYPE_TEST_STRING_ITEMS = 5;

/** 旧格式的「match + converter」两步，升级成只含会改变结果的步骤的 StringProcessor。 */
function processorFromMatchAndConverter(match, converter, ctx) {
  return stringProcessor([load(match, ctx), load(converter, ctx)].filter(makesChanges));
}

const jsonRuleHasStringMatch = (ruleType) => ruleType === JSON_PARSE_RULE_TYPE_DICT_KEY || ruleType === JSON_PARSE_RULE_TYPE_TEST_STRING_ITEMS;

register({
  type: T.PARSE_FORMULA_JSON,
  version: 4,
  upgrade: {
    1: ([parseRules, contentToFetch, match, converter]) => {
      // 旧规则：None = 全部、int = 下标、str = 固定 key
      const rules = parseRules.map((rule) => {
        if (rule === null) return [JSON_PARSE_RULE_TYPE_ALL_ITEMS, null];
        if (typeof rule === "number") return [JSON_PARSE_RULE_TYPE_INDEXED_ITEM, rule];
        return [JSON_PARSE_RULE_TYPE_DICT_KEY, stringMatch({ matchType: STRING_MATCH_FIXED, matchValue: rule, exampleString: rule })];
      });
      return [2, [rules, contentToFetch, match, converter]];
    },
    2: ([parseRules, contentToFetch, match, converter], ctx) => [3, [parseRules, contentToFetch, processorFromMatchAndConverter(match, converter, ctx)]],
    3: ([parseRules, contentToFetch, processor]) => [4, [parseRules, contentToFetch, "", processor]],
  },
  normalise: ([parseRules, contentToFetch, name, processor], ctx) => [
    parseRules.map(([ruleType, rule]) => [ruleType, jsonRuleHasStringMatch(ruleType) ? load(rule, ctx) : rule]),
    contentToFetch,
    name,
    load(processor, ctx),
  ],
});

// ---- ParseFormulaZipper（界面里叫 COMPOUND）----

register({
  type: T.PARSE_FORMULA_ZIPPER,
  version: 3,
  upgrade: {
    1: ([formulae, subPhrase, match, converter], ctx) => [2, [formulae, subPhrase, processorFromMatchAndConverter(match, converter, ctx)]],
    2: ([formulae, subPhrase, processor]) => [3, [formulae, subPhrase, "", processor]],
  },
  normalise: ([formulae, subPhrase, name, processor], ctx) => [load(formulae, ctx), subPhrase, name, load(processor, ctx)],
});

// ---- ParseFormulaContextVariable ----

register({
  type: T.PARSE_FORMULA_CONTEXT_VARIABLE,
  version: 3,
  upgrade: {
    1: ([variableName, match, converter], ctx) => [2, [variableName, processorFromMatchAndConverter(match, converter, ctx)]],
    2: ([variableName, processor]) => [3, [variableName, "", processor]],
  },
  normalise: ([variableName, name, processor], ctx) => [variableName, name, load(processor, ctx)],
});

// ---- ParseFormulaNested ----

register({
  type: T.PARSE_FORMULA_NESTED,
  version: 2,
  upgrade: {
    1: ([mainFormula, subFormula, processor]) => [2, [mainFormula, subFormula, "", processor]],
  },
  normalise: ([mainFormula, subFormula, name, processor], ctx) => [load(mainFormula, ctx), load(subFormula, ctx), name, load(processor, ctx)],
});

// ---- ParseFormulaStatic ----

register({
  type: T.PARSE_FORMULA_STATIC,
  version: 1,
  normalise: ([staticText, numToDo, name, processor], ctx) => [staticText, numToDo, name, load(processor, ctx)],
});

/** formula.GetStringProcessor() 在各公式类型 info 中的位置 */
const FORMULA_STRING_PROCESSOR_INDEX = {
  [T.PARSE_FORMULA_HTML]: 4,
  [T.PARSE_FORMULA_JSON]: 3,
  [T.PARSE_FORMULA_ZIPPER]: 3,
  [T.PARSE_FORMULA_CONTEXT_VARIABLE]: 2,
  [T.PARSE_FORMULA_NESTED]: 3,
  [T.PARSE_FORMULA_STATIC]: 3,
};

function appendToFormulaStringProcessor(formula, step) {
  const index = FORMULA_STRING_PROCESSOR_INDEX[formula[0]];
  if (index === undefined) throw new HydrusUnsupportedError(`未实现 ${typeName(formula[0])}.GetStringProcessor`);
  const info = [...infoOf(formula)];
  const processor = info[index];
  const steps = infoOf(infoOf(processor)).map(([, s]) => s);
  info[index] = stringProcessor([...steps, step]);
  return withInfo(formula, info);
}

// ---- ContentParser ----

register({
  type: T.CONTENT_PARSER,
  version: 7,
  upgrade: {
    1: ([name, contentType, formula, additionalInfo]) => {
      if (contentType === CONTENT_TYPE_VETO) {
        const [vetoIfMatchesFound, matchIfTextPresent, searchText] = additionalInfo;
        const sm = matchIfTextPresent ? stringMatch({ matchType: STRING_MATCH_REGEX, matchValue: searchText, exampleString: searchText }) : stringMatch();
        additionalInfo = [vetoIfMatchesFound, sm];
      }
      return [2, [name, contentType, formula, additionalInfo]];
    },
    2: ([name, contentType, formula, additionalInfo]) => {
      if (contentType === CONTENT_TYPE_URLS) {
        let [urlType, priority] = additionalInfo;
        if (urlType === URL_TYPE_FILE) urlType = URL_TYPE_DESIRED;
        else if (urlType === URL_TYPE_POST) urlType = URL_TYPE_SOURCE;
        else urlType = URL_TYPE_NEXT;
        additionalInfo = [urlType, priority];
      }
      return [3, [name, contentType, formula, additionalInfo]];
    },
    3: ([name, contentType, formula, additionalInfo]) => [4, [name, contentType, formula, CONTENT_PARSER_SORT_TYPE_NONE, false, additionalInfo]],
    4: ([name, contentType, formula, sortType, sortAsc, additionalInfo]) => {
      if (contentType === CONTENT_TYPE_HASH && !Array.isArray(additionalInfo)) {
        // hydrus 原文就是在序列化串里找 "base64"
        const hashEncoding = JSON.stringify(formula).includes('"base64"') ? "base64" : "hex";
        additionalInfo = [additionalInfo, hashEncoding];
      }
      return [5, [name, contentType, formula, sortType, sortAsc, additionalInfo]];
    },
    5: ([name, contentType, formula, sortType, sortAsc, additionalInfo], ctx) => {
      if (sortType !== CONTENT_PARSER_SORT_TYPE_NONE) {
        formula = appendToFormulaStringProcessor(load(formula, ctx), stringSorter({ sortType, asc: sortAsc }));
      }
      return [6, [name, contentType, formula, additionalInfo]];
    },
    6: ([name, contentType, formula, additionalInfo]) => {
      if (contentType === CONTENT_TYPE_MAPPINGS && additionalInfo === "") additionalInfo = null;
      return [7, [name, contentType, formula, additionalInfo]];
    },
  },
  normalise: ([name, contentType, formula, additionalInfo], ctx) => {
    if (contentType === CONTENT_TYPE_VETO) {
      const [vetoIfMatchesFound, sm] = additionalInfo;
      additionalInfo = [vetoIfMatchesFound, load(sm, ctx)];
    } else if (Array.isArray(additionalInfo)) {
      // hydrus 修复早年版本号错乱造成的 ( [ 'md5', 'hex' ], 'hex' )
      const fixed = [];
      for (const item of additionalInfo) {
        if (Array.isArray(item)) {
          fixed.length = 0;
          fixed.push(...item);
          break;
        }
        fixed.push(item);
      }
      additionalInfo = fixed;
    }
    return [name, contentType, load(formula, ctx), additionalInfo];
  },
});

// ---- SubsidiaryPageParser ----

register({
  type: T.SUBSIDIARY_PAGE_PARSER,
  version: 2,
  upgrade: {
    1: ([formula, pageParser]) => [2, [formula, false, pageParser]],
  },
  normalise: ([formula, sortPostsBySourceTime, pageParser], ctx) => [load(formula, ctx), sortPostsBySourceTime, load(pageParser, ctx)],
});

// ---- PageParser ----

register({
  type: T.PAGE_PARSER,
  version: 3,
  named: true,
  // PageParser 在 info 里也存了名字，导出时以它为准
  nameFromInfo: (info) => info[0],
  upgrade: {
    1: ([name, key, converter, subsidiary, contentParsers, exampleUrls]) => [
      2,
      [name, key, converter, subsidiary, contentParsers, exampleUrls, { url: "https://example.com/posts/index.php?id=123456" }],
    ],
    2: ([name, key, converter, subsidiary, contentParsers, exampleUrls, exampleContext]) => {
      // 旧格式是普通 list 的 (formula, page_parser)
      const spps = subsidiary.map(([formula, pageParser]) => [T.SUBSIDIARY_PAGE_PARSER, 2, [formula, false, pageParser]]);
      return [3, [name, key, converter, serialisableList(spps), contentParsers, exampleUrls, exampleContext]];
    },
  },
  normalise: ([name, key, converter, subsidiary, contentParsers, exampleUrls, exampleContext], ctx) => {
    const sortList = (listTuple, keyFn) => {
      const loaded = load(listTuple, ctx);
      return withInfo(loaded, sortedBy(infoOf(loaded), ([, obj]) => casefold(keyFn(obj))));
    };
    return [
      name,
      normaliseHex(key),
      load(converter, ctx),
      // 按子页面解析器的 PageParser 名排序
      sortList(subsidiary, (spp) => infoOf(infoOf(spp)[2])[0]),
      // 按 ContentParser 名排序
      sortList(contentParsers, (cp) => infoOf(cp)[0]),
      exampleUrls,
      exampleContext,
    ];
  },
});

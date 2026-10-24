// hydrus/client/ClientStrings.py 中序列化相关的部分。
import { HydrusUnsupportedError, infoOf, load, register, serialisableList, T, typeName } from "./core.js";

export const STRING_MATCH_FIXED = 0;
export const STRING_MATCH_FLEXIBLE = 1;
export const STRING_MATCH_REGEX = 2;
export const STRING_MATCH_ANY = 3;

export const STRING_CONVERSION_REMOVE_TEXT_FROM_BEGINNING = 0;
export const STRING_CONVERSION_REMOVE_TEXT_FROM_END = 1;
export const STRING_CONVERSION_PREPEND_TEXT = 2;
export const STRING_CONVERSION_APPEND_TEXT = 3;
export const STRING_CONVERSION_ENCODE = 4;
export const STRING_CONVERSION_DECODE = 5;
export const STRING_CONVERSION_CLIP_TEXT_FROM_BEGINNING = 6;
export const STRING_CONVERSION_CLIP_TEXT_FROM_END = 7;

export const CONTENT_PARSER_SORT_TYPE_NONE = 0;
export const CONTENT_PARSER_SORT_TYPE_HUMAN_SORT = 2;

export const DEFAULT_EXAMPLE_STRING = "example string";

const ENCODING_TYPE_LEGACY_TO_ENUM = {
  "url percent encoding": 0,
  "unicode escape characters": 1,
  "html entities": 2,
  hex: 3,
  base64: 4,
};

/** StringMatch(...).GetSerialisableTuple() */
export function stringMatch({
  matchType = STRING_MATCH_ANY,
  matchValue = "",
  minChars = null,
  maxChars = null,
  exampleString = DEFAULT_EXAMPLE_STRING,
} = {}) {
  return [T.STRING_MATCH, 1, [matchType, matchValue, minChars, maxChars, exampleString]];
}

/** StringConverter(conversions, example_string).GetSerialisableTuple() */
export function stringConverter(conversions = [], exampleString = DEFAULT_EXAMPLE_STRING) {
  return [T.STRING_CONVERTER, 2, [conversions, exampleString]];
}

/** StringProcessor() 并 SetProcessingSteps(steps) */
export function stringProcessor(steps = []) {
  return [T.STRING_PROCESSOR, 1, serialisableList(steps)];
}

/** StringSorter(...).GetSerialisableTuple() */
export function stringSorter({ sortType = CONTENT_PARSER_SORT_TYPE_HUMAN_SORT, asc = false, regex = null } = {}) {
  return [T.STRING_SORTER, 1, [sortType, asc, regex]];
}

/** StringProcessor 的步骤列表（已加载的元组）。 */
export function processingSteps(processorTuple) {
  return infoOf(infoOf(processorTuple)).map(([, step]) => step);
}

/** 各 StringProcessingStep 的 MakesChanges()，参数为当前版本元组。 */
export function makesChanges(tuple) {
  const info = infoOf(tuple);
  switch (tuple[0]) {
    case T.STRING_MATCH: {
      const [matchType, , minChars, maxChars] = info;
      return minChars !== null || maxChars !== null || matchType !== STRING_MATCH_ANY;
    }
    case T.STRING_CONVERTER:
      return info[0].length > 0;
    case T.STRING_PROCESSOR:
      return processingSteps(tuple).some(makesChanges);
    case T.STRING_SPLITTER:
      return true;
    case T.STRING_SLICER:
      return info[0] !== null || info[1] !== null;
    default:
      throw new HydrusUnsupportedError(`未实现 ${typeName(tuple[0])}.MakesChanges`);
  }
}

register({
  type: T.STRING_MATCH,
  version: 1,
  normalise: ([matchType, matchValue, minChars, maxChars, exampleString]) => [matchType, matchValue, minChars, maxChars, exampleString],
});

/** StringConverter 的 conversions 解析，带 hydrus 那个「出错就停在出错前」的 try。 */
function readConversions(serialisableConversions, mapEach) {
  const out = [];
  try {
    for (const entry of serialisableConversions) {
      if (!Array.isArray(entry) || entry.length !== 2) throw new Error("bad conversion");
      const r = mapEach(entry[0], entry[1]);
      if (r) out.push(r);
    }
  } catch {
    // 与 hydrus 一致：吞掉异常，保留已解析的部分
  }
  return out;
}

register({
  type: T.STRING_CONVERTER,
  version: 2,
  upgrade: {
    1: ([serialisableConversions, exampleString]) => {
      const conversions = readConversions(serialisableConversions, (conversionType, data) => {
        if (conversionType === STRING_CONVERSION_ENCODE || conversionType === STRING_CONVERSION_DECODE) {
          // 这类 decode 曾被废弃成 no-op，后来复用了同名字符串标识，直接删掉
          if (conversionType === STRING_CONVERSION_DECODE && (data === "hex" || data === "base64")) return null;
          if (!(data in ENCODING_TYPE_LEGACY_TO_ENUM)) throw new Error(`unknown encoding ${data}`);
          return [conversionType, ENCODING_TYPE_LEGACY_TO_ENUM[data]];
        }
        return [conversionType, data];
      });
      return [2, [conversions, exampleString]];
    },
  },
  normalise: ([serialisableConversions, exampleString]) => [
    readConversions(serialisableConversions, (conversionType, data) => [conversionType, data]),
    exampleString,
  ],
});

register({
  type: T.STRING_PROCESSOR,
  version: 1,
  // info 本身是一个 SerialisableList 元组
  normalise: (stepsList, ctx) => load(stepsList, ctx),
});

register({
  type: T.STRING_SPLITTER,
  version: 2,
  upgrade: {
    // v2 起分隔符按 unicode-escape 解释，旧值里的反斜杠要先转义
    1: ([separator, maxSplits]) => [2, [separator.replaceAll("\\", "\\\\"), maxSplits]],
  },
  normalise: ([separator, maxSplits]) => [separator, maxSplits],
});

register({
  type: T.STRING_SLICER,
  version: 1,
  normalise: ([indexStart, indexEnd]) => [indexStart, indexEnd],
});

register({
  type: T.STRING_SORTER,
  version: 1,
  normalise: ([sortType, asc, regex]) => [sortType, asc, regex],
});

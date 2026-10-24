// hydrus 序列化对象的 JS 移植核心。
//
// hydrus 的一个对象序列化后是 [type, version, info]，具名对象是 [type, name, version, info]。
// hydrus 读取时做两件事：
//   1. InitialiseFromSerialisableInfo：循环调用 _UpdateSerialisableInfo，把 info 升级到当前版本，
//      再 _InitialiseFromSerialisableInfo 构造对象（子对象在这里递归创建并升级）；
//   2. 之后导出时 _GetSerialisableInfo 再序列化，这一步本身也有规范化（排序、去重、强制类型）。
// 这里不建对象，`load()` 直接把元组升级并规范化成「hydrus 读进来再导出」会得到的元组，
// 每个类型的 `upgrade[v]` 对应 Python 的 `_UpdateSerialisableInfo` 中 `version == v` 分支，
// `normalise` 对应 `_InitialiseFromSerialisableInfo` + `_GetSerialisableInfo` 的往返。
// load() 对当前版本的元组是幂等的，所以升级步骤里「CreateFromSerialisableTuple 再 GetSerialisableTuple」
// 一律写成 load(child)。

export const META_JSON_OK = 0;
export const META_JSON_BYTES = 1;
export const META_HYDRUS = 2;

// HydrusSerialisable.SERIALISABLE_TYPE_*
export const T = {
  DICTIONARY: 21,
  LIST: 26,
  PARSE_FORMULA_HTML: 27,
  CONTENT_PARSER: 30,
  PARSE_FORMULA_JSON: 31,
  BANDWIDTH_RULES: 38,
  URL_CLASS: 50,
  NETWORK_DOMAIN_MANAGER: 53,
  STRING_MATCH: 51,
  STRING_CONVERTER: 55,
  PAGE_PARSER: 58,
  PARSE_FORMULA_ZIPPER: 59,
  PARSE_FORMULA_CONTEXT_VARIABLE: 60,
  PARSE_RULE_HTML: 62,
  GALLERY_URL_GENERATOR: 69,
  NESTED_GALLERY_URL_GENERATOR: 70,
  DOMAIN_METADATA_PACKAGE: 71,
  STRING_SPLITTER: 83,
  STRING_PROCESSOR: 84,
  STRING_SORTER: 99,
  STRING_SLICER: 100,
  STRING_TAG_FILTER: 112,
  STRING_JOINER: 125,
  URL_CLASS_PARAMETER_FIXED_NAME: 127,
  PARSE_FORMULA_NESTED: 133,
  SUBSIDIARY_PAGE_PARSER: 135,
  PARSE_FORMULA_STATIC: 136,
  URL_DOMAIN_MASK: 139,
};

const TYPE_NAMES = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]));

export function typeName(type) {
  return TYPE_NAMES[type] ?? `#${type}`;
}

/** 升级或初始化失败。对应 hydrus 的 SerialisationException；列表/字典里的这类失败会丢弃该项。 */
export class HydrusSerialisationError extends Error {
  name = "HydrusSerialisationError";
}

/** 本移植还没实现的类型。不会被列表吞掉，总是向上抛出，避免静默丢配置。 */
export class HydrusUnsupportedError extends Error {
  name = "HydrusUnsupportedError";
}

/**
 * @typedef {object} TypeDef
 * @property {number} type
 * @property {number} version  当前（hydrus v690）版本
 * @property {boolean} [named]
 * @property {Record<number, (info: any, ctx: LoadContext) => [number, any]>} [upgrade]
 * @property {(info: any, ctx: LoadContext) => any} [normalise]
 * @property {(info: any) => string} [nameFromInfo]  对象名在 info 里也存了一份时，导出用 info 里的
 */

/**
 * @typedef {object} LoadContext
 * @property {(message: string) => void} warn
 * @property {() => string} generateKey  HydrusData.GenerateKey().hex()，32 字节随机
 */

/** @type {Map<number, TypeDef>} */
const registry = new Map();

/** @param {TypeDef} def */
export function register(def) {
  registry.set(def.type, def);
}

export function currentVersion(type) {
  const def = registry.get(type);
  if (!def) throw new HydrusUnsupportedError(`不支持的 hydrus 类型 ${typeName(type)}`);
  return def.version;
}

/** @returns {LoadContext} */
export function defaultContext() {
  return {
    warn: (message) => console.warn(message),
    generateKey: () => {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
}

/**
 * CreateFromSerialisableTuple(t).GetSerialisableTuple()
 * @param {any[]} tuple
 * @param {LoadContext} [ctx]
 */
export function load(tuple, ctx = defaultContext()) {
  if (!Array.isArray(tuple) || (tuple.length !== 3 && tuple.length !== 4)) {
    throw new HydrusSerialisationError(`不是 hydrus 序列化元组: ${JSON.stringify(tuple)?.slice(0, 80)}`);
  }
  const named = tuple.length === 4;
  const [type, name, version, info] = named ? tuple : [tuple[0], undefined, tuple[1], tuple[2]];
  const def = registry.get(type);
  if (!def) throw new HydrusUnsupportedError(`不支持的 hydrus 类型 ${typeName(type)}`);
  const label = `${typeName(type)}${named ? ` "${name}"` : ""}`;

  if (version > def.version) {
    // hydrus 在 raise_error_on_future_version=False 时只提示并继续尝试
    ctx.warn(`${label} 的版本 ${version} 比支持的 ${def.version} 新，尝试按当前格式读取`);
  }

  let v = version;
  let data = info;
  try {
    while (v < def.version) {
      const step = def.upgrade?.[v];
      if (!step) throw new Error(`缺少 v${v} 的升级步骤`);
      [v, data] = step(data, ctx);
    }
  } catch (e) {
    if (e instanceof HydrusUnsupportedError) throw e;
    throw new HydrusSerialisationError(`${label} 无法从 v${version} 升级到 v${def.version}: ${e.message}`, { cause: e });
  }

  let out;
  try {
    out = def.normalise ? def.normalise(data, ctx) : data;
  } catch (e) {
    if (e instanceof HydrusUnsupportedError) throw e;
    throw new HydrusSerialisationError(`${label} 初始化失败: ${e.message}`, { cause: e });
  }

  if (!named) return [type, def.version, out];
  return [type, def.nameFromInfo ? def.nameFromInfo(out) : name, def.version, out];
}

// ---- 元组小工具 ----

export function infoOf(tuple) {
  return tuple.length === 4 ? tuple[3] : tuple[2];
}

export function withInfo(tuple, info) {
  return tuple.length === 4 ? [tuple[0], tuple[1], tuple[2], info] : [tuple[0], tuple[1], info];
}

/** 有序 key→value 表，模拟 Python dict 的「后写覆盖、位置保留在首次出现处」。 */
export function pyDictItems(pairs) {
  const map = new Map();
  for (const [k, v] of pairs) map.set(JSON.stringify(k), [k, v]);
  return [...map.values()];
}

/** Python bool() 的真值规则。 */
export function pyBool(x) {
  if (Array.isArray(x)) return x.length > 0;
  if (x && typeof x === "object") return Object.keys(x).length > 0;
  return Boolean(x);
}

/** bytes.fromhex(s).hex()：去掉空白并转小写。 */
export function normaliseHex(s) {
  return String(s).replace(/\s+/g, "").toLowerCase();
}

/**
 * Python str.casefold() 的近似：先大写再小写，覆盖 ß→ss、ﬁ→fi、ς→σ 等常见折叠。
 * 仅用于排序 key。
 */
export function casefold(s) {
  return String(s).toUpperCase().toLowerCase();
}

/** Python 的字符串比较按码点，而 JS 的 < 按 UTF-16 码元，两者在补充平面字符上不同。 */
export function compareCodePoints(a, b) {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done || y.done) return (x.done ? 0 : 1) - (y.done ? 0 : 1);
    const d = x.value.codePointAt(0) - y.value.codePointAt(0);
    if (d !== 0) return d;
  }
}

/** sorted(items, key=keyFn)：稳定排序，key 是字符串。 */
export function sortedBy(items, keyFn) {
  return items
    .map((item, i) => ({ item, key: keyFn(item), i }))
    .sort((p, q) => compareCodePoints(p.key, q.key) || p.i - q.i)
    .map((p) => p.item);
}

// ---- meta tuple：SerialisableList / SerialisableDictionary 的元素 ----

/**
 * ConvertMetaSerialisableTupleToObject 再 ConvertObjectToMetaSerialisableTuple 的往返，
 * 含 hydrus 导出时把普通 list/dict 强制包成 SerialisableList/Dictionary 的规则。
 */
export function normaliseMeta(meta, ctx) {
  const [metatype, value] = meta;
  if (metatype === META_HYDRUS) return [META_HYDRUS, load(value, ctx)];
  if (metatype === META_JSON_BYTES) return [META_JSON_BYTES, normaliseHex(value)];
  return plainToMeta(value);
}

function plainToMeta(value) {
  if (Array.isArray(value)) return [META_HYDRUS, [T.LIST, currentVersion(T.LIST), value.map(plainToMeta)]];
  if (value !== null && typeof value === "object") {
    return [META_HYDRUS, [T.DICTIONARY, currentVersion(T.DICTIONARY), Object.entries(value).map(([k, v]) => [[META_JSON_OK, k], plainToMeta(v)])]];
  }
  return [META_JSON_OK, value];
}

/** 列表/字典元素加载失败时，hydrus 只丢弃 SerialisationException 那一项。 */
function tryNormaliseMeta(meta, ctx, where) {
  try {
    return { ok: true, meta: normaliseMeta(meta, ctx) };
  } catch (e) {
    if (e instanceof HydrusSerialisationError) {
      ctx.warn(`${where} 中有一项无法加载，已丢弃: ${e.message}`);
      return { ok: false };
    }
    throw e;
  }
}

/** 构造当前版本的 SerialisableList 元组，元素是 hydrus 元组。 */
export function serialisableList(tuples) {
  return [T.LIST, currentVersion(T.LIST), tuples.map((t) => [META_HYDRUS, t])];
}

/** CreateFromSerialisableTuple(list_tuple) 得到的 Python list，元素为已加载的元组或 JSON 值。 */
export function listObjects(listTuple, ctx) {
  const loaded = load(listTuple, ctx);
  return infoOf(loaded).map(([, value]) => value);
}

/** CreateFromSerialisableTuple(dict_tuple).items() */
export function dictObjectItems(dictTuple, ctx) {
  const loaded = load(dictTuple, ctx);
  return infoOf(loaded).map(([[, k], [, v]]) => [k, v]);
}

register({
  type: T.LIST,
  version: 3,
  upgrade: {
    1: (objs) => [2, objs.map((o) => [true, o])],
    2: (pairs) => [3, pairs.map(([isSerialised, o]) => [isSerialised ? META_HYDRUS : META_JSON_OK, o])],
  },
  normalise: (metas, ctx) => {
    const out = [];
    for (const meta of metas) {
      const r = tryNormaliseMeta(meta, ctx, "列表");
      if (r.ok) out.push(r.meta);
    }
    return out;
  },
});

register({
  type: T.DICTIONARY,
  version: 2,
  upgrade: {
    1: ([simpleSimple, simpleSer, serSimple, serSer]) => [
      2,
      [
        ...simpleSimple.map(([k, v]) => [[META_JSON_OK, k], [META_JSON_OK, v]]),
        ...simpleSer.map(([k, v]) => [[META_JSON_OK, k], [META_HYDRUS, v]]),
        ...serSimple.map(([k, v]) => [[META_HYDRUS, k], [META_JSON_OK, v]]),
        ...serSer.map(([k, v]) => [[META_HYDRUS, k], [META_HYDRUS, v]]),
      ],
    ],
  },
  normalise: (pairs, ctx) => {
    const entries = [];
    for (const [metaKey, metaValue] of pairs) {
      const k = tryNormaliseMeta(metaKey, ctx, "字典");
      if (!k.ok) continue;
      const v = tryNormaliseMeta(metaValue, ctx, "字典");
      if (!v.ok) continue;
      // key 是 JSON_OK 的 list 时 hydrus 转成 tuple，导出仍是 JSON 数组，不包成 SerialisableList
      const key = metaKey[0] === META_JSON_OK && Array.isArray(metaKey[1]) ? [META_JSON_OK, metaKey[1]] : k.meta;
      entries.push([key, v.meta]);
    }
    // hydrus 对象作 key 时按对象身份比较，永不去重；JSON key 按值去重
    const map = new Map();
    entries.forEach(([key, value], i) => map.set(key[0] === META_JSON_OK ? JSON.stringify(key[1]) : `#${i}`, [key, value]));
    return [...map.values()];
  },
});

/**
 * 加载 downloader 导出包。顶层是 SerialisableList 时逐项加载，本移植不支持的类型
 * （如 domain metadata、login script）跳过并记入 skipped，不影响其余对象。
 * @returns {{ objects: any[], skipped: string[] }}
 */
export function loadDownloaderObjects(tuple, ctx = defaultContext()) {
  if (!Array.isArray(tuple) || tuple[0] !== T.LIST) {
    return { objects: [load(tuple, ctx)], skipped: [] };
  }
  const def = registry.get(T.LIST);
  let [, v, data] = tuple;
  while (v < def.version) [v, data] = def.upgrade[v](data, ctx);
  const objects = [];
  const skipped = [];
  for (const [metatype, value] of data) {
    if (metatype !== META_HYDRUS) continue;
    try {
      objects.push(load(value, ctx));
    } catch (e) {
      if (!(e instanceof HydrusUnsupportedError || e instanceof HydrusSerialisationError)) throw e;
      skipped.push(`${typeName(value[0])}${value.length === 4 ? ` "${value[1]}"` : ""}: ${e.message}`);
    }
  }
  return { objects, skipped };
}

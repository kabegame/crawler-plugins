// Python json.loads / str() / json.dumps 的 JS 版本，供 JSON 公式使用。
// JSON.parse 不够用：大整数（如推文 id）会丢精度，1.0 与 1 也分不开，而 hydrus 输出的是 Python 的 str(node)。
// 解析结果：对象是 PyDict（保留插入顺序，重复 key 后写覆盖），数组是 JS 数组，
// 数字是 PyInt / PyFloat，字符串、true / false / null 原样。
import { compareCodePoints } from "../serialisable/core.js";

export class PyInt {
  /** @param {bigint} value */
  constructor(value) {
    this.value = value;
  }
}

export class PyFloat {
  /** @param {number} value */
  constructor(value) {
    this.value = value;
  }
}

export class PyDict {
  constructor() {
    /** @type {Map<string, any>} */
    this.map = new Map();
  }

  /** sorted(d.items())：key 互不相同，只按 key 的码点顺序比较 */
  sortedItems() {
    return [...this.map.entries()].sort(([a], [b]) => compareCodePoints(a, b));
  }
}

export const isContainer = (node) => Array.isArray(node) || node instanceof PyDict;

const WS = /[ \t\n\r]*/y;
const NUMBER = /(-?(?:0|[1-9]\d*))(\.\d+)?([eE][-+]?\d+)?/y;
const STRING_CHUNK = /[^"\\\x00-\x1f]*/y;
const ESCAPES = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/** json.loads(text)；出错抛 SyntaxError。 */
export function pyJsonLoads(text) {
  let pos = 0;
  const fail = (msg) => {
    throw new SyntaxError(`${msg}: line ${text.slice(0, pos).split("\n").length} (char ${pos})`);
  };
  const skipWs = () => {
    WS.lastIndex = pos;
    WS.exec(text);
    pos = WS.lastIndex;
  };
  const parseString = () => {
    pos++; // 开头的 "
    let out = "";
    for (;;) {
      STRING_CHUNK.lastIndex = pos;
      out += STRING_CHUNK.exec(text)[0];
      pos = STRING_CHUNK.lastIndex;
      const c = text[pos];
      if (c === '"') {
        pos++;
        return out;
      }
      if (c === undefined) fail("Unterminated string starting at");
      if (c !== "\\") fail("Invalid control character at");
      const e = text[pos + 1];
      if (e === "u") {
        const hex = text.slice(pos + 2, pos + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("Invalid \\uXXXX escape");
        out += String.fromCharCode(parseInt(hex, 16));
        pos += 6;
      } else if (e in ESCAPES) {
        out += ESCAPES[e];
        pos += 2;
      } else {
        fail("Invalid \\escape");
      }
    }
  };
  const parseValue = () => {
    skipWs();
    const c = text[pos];
    if (c === '"') return parseString();
    if (c === "{") {
      pos++;
      const d = new PyDict();
      skipWs();
      if (text[pos] === "}") {
        pos++;
        return d;
      }
      for (;;) {
        skipWs();
        if (text[pos] !== '"') fail("Expecting property name enclosed in double quotes");
        const key = parseString();
        skipWs();
        if (text[pos] !== ":") fail("Expecting ':' delimiter");
        pos++;
        d.map.set(key, parseValue());
        skipWs();
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "}") {
          pos++;
          return d;
        }
        fail("Expecting ',' delimiter");
      }
    }
    if (c === "[") {
      pos++;
      const arr = [];
      skipWs();
      if (text[pos] === "]") {
        pos++;
        return arr;
      }
      for (;;) {
        arr.push(parseValue());
        skipWs();
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "]") {
          pos++;
          return arr;
        }
        fail("Expecting ',' delimiter");
      }
    }
    for (const [word, value] of [
      ["null", null],
      ["true", true],
      ["false", false],
      ["NaN", new PyFloat(NaN)],
      ["Infinity", new PyFloat(Infinity)],
      ["-Infinity", new PyFloat(-Infinity)],
    ]) {
      if (text.startsWith(word, pos)) {
        pos += word.length;
        return value;
      }
    }
    NUMBER.lastIndex = pos;
    const m = NUMBER.exec(text);
    if (!m) fail("Expecting value");
    pos = NUMBER.lastIndex;
    return m[2] || m[3] ? new PyFloat(Number(m[0])) : new PyInt(BigInt(m[1]));
  };
  // json.loads 接受 str 开头的 BOM 时会报错；hydrus 拿到的是解码后的文本，这里与之一致不做特殊处理
  const value = parseValue();
  skipWs();
  if (pos !== text.length) fail("Extra data");
  return value;
}

/** repr(float)：最短往返表示，指数在 [-4, 16) 内用定点，否则科学计数。 */
export function pyFloatRepr(x) {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mantissa, expText] = x.toExponential().split("e");
  const exp = Number(expText);
  const negative = mantissa.startsWith("-");
  const digits = mantissa.replace(/^-/, "").replace(".", "");
  const sign = negative ? "-" : "";
  if (exp < -4 || exp >= 16) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  if (exp < 0) return `${sign}0.${"0".repeat(-exp - 1)}${digits}`;
  const intPart = digits.slice(0, exp + 1).padEnd(exp + 1, "0");
  const frac = digits.slice(exp + 1);
  return `${sign}${intPart}.${frac || "0"}`;
}

/** str(node)，只用于标量 */
export function pyStr(node) {
  if (node === true) return "True";
  if (node === false) return "False";
  if (node === null) return "None";
  if (node instanceof PyInt) return node.value.toString();
  if (node instanceof PyFloat) return pyFloatRepr(node.value);
  return node;
}

const DUMP_ESCAPES = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };

function dumpString(s) {
  return `"${s.replace(/[\x00-\x1f\\"]/g, (c) => DUMP_ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
}

/** json.dumps(node, ensure_ascii=False)，默认分隔符 ", " / ": " */
export function pyJsonDumps(node) {
  if (node === null) return "null";
  if (node === true) return "true";
  if (node === false) return "false";
  if (node instanceof PyInt) return node.value.toString();
  if (node instanceof PyFloat) {
    const v = node.value;
    if (Number.isNaN(v)) return "NaN";
    if (v === Infinity) return "Infinity";
    if (v === -Infinity) return "-Infinity";
    return pyFloatRepr(v);
  }
  if (typeof node === "string") return dumpString(node);
  if (Array.isArray(node)) return `[${node.map(pyJsonDumps).join(", ")}]`;
  if (node instanceof PyDict) return `{${[...node.map].map(([k, v]) => `${dumpString(k)}: ${pyJsonDumps(v)}`).join(", ")}}`;
  throw new TypeError(`无法序列化 ${typeof node}`);
}

// Python datetime.datetime.strptime 的 JS 版本（C/英文区域），供 STRING_CONVERSION_DATE_DECODE 使用。
// 正则与取值规则照搬 CPython 3.14 的 _strptime：格式串里的空白匹配 \s+，整体忽略大小写，
// 必须从头匹配到尾（否则 "unconverted data remains"）。

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** __seqToRE：长的在前，避免短名抢先匹配 */
function seqToRe(values, name) {
  const sorted = [...values].sort((a, b) => b.length - a.length);
  return `(?<${name}>${sorted.map(reEscape).join("|")})`;
}

const DIRECTIVES = {
  d: "(?<d>3[0-1]|[1-2]\\d|0[1-9]|[1-9]| [1-9])",
  f: "(?<f>[0-9]{1,6})",
  H: "(?<H>2[0-3]|[0-1]\\d|\\d| \\d)",
  I: "(?<I>1[0-2]|0[1-9]|[1-9]| [1-9])",
  j: "(?<j>36[0-6]|3[0-5]\\d|[1-2]\\d\\d|0[1-9]\\d|00[1-9]|[1-9]\\d|0[1-9]|[1-9])",
  m: "(?<m>1[0-2]|0[1-9]|[1-9])",
  M: "(?<M>[0-5]\\d|\\d)",
  S: "(?<S>6[0-1]|[0-5]\\d|\\d)",
  w: "(?<w>[0-6])",
  u: "(?<u>[1-7])",
  y: "(?<y>\\d\\d)",
  Y: "(?<Y>\\d\\d\\d\\d)",
  // Python 的 (?-i:Z) 在 JS 里没有，大小写在取值时检查
  z: "(?<z>[+-]\\d\\d:?[0-5]\\d(?::?[0-5]\\d(?:\\.\\d{1,6})?)?|Z)",
  A: seqToRe(WEEKDAYS, "A"),
  a: seqToRe(WEEKDAYS.map((d) => d.slice(0, 3)), "a"),
  B: seqToRe(MONTHS, "B"),
  b: seqToRe(MONTHS.map((m) => m.slice(0, 3)), "b"),
  p: seqToRe(["am", "pm"], "p"),
  // LocaleTime.timezone：utc、gmt 加本机时区名；本机时区名在 V8 里拿不到，只认前两个
  Z: seqToRe(["utc", "gmt"], "Z"),
  "%": "%",
};
DIRECTIVES.e = DIRECTIVES.d;
DIRECTIVES.k = DIRECTIVES.H;
DIRECTIVES.l = DIRECTIVES.I;
DIRECTIVES.P = DIRECTIVES.p;
DIRECTIVES.h = DIRECTIVES.b;

// C 区域的复合指令
const COMPOSITE = { T: "%H:%M:%S", R: "%H:%M", X: "%H:%M:%S", x: "%m/%d/%y", c: "%a %b %d %H:%M:%S %Y", r: "%I:%M:%S %p", D: "%m/%d/%y", F: "%Y-%m-%d" };

/** TimeRE.pattern：格式串 → 正则源码。同名组只保留第一个（Python 会报 redefinition 错误）。 */
function pattern(format, used) {
  let f = format.replace(/([\\.^$*+?(){}[\]|])/g, "\\$1");
  f = f.replace(/\s+/g, "\\s+");
  f = f.replace(/'/g, "['ʼ]");
  return f.replace(/%[-_0^#]*[0-9]*([OE]?\\?.?)/g, (_, spec) => {
    const ch = spec.replace(/^[OE]/, "").replace(/^\\/, "");
    if (ch in COMPOSITE) return pattern(COMPOSITE[ch], used);
    const re = DIRECTIVES[ch];
    if (re === undefined) throw new Error(`'${ch}' is a bad directive in format '${format}'`);
    const group = /^\(\?<(\w+)>/.exec(re)?.[1];
    if (group) {
      if (used.has(group)) throw new Error(`redefinition of group name '${group}'`);
      used.add(group);
    }
    return re;
  });
}

const regexCache = new Map();

function compile(format) {
  let re = regexCache.get(format);
  if (!re) {
    re = new RegExp(`^(?:${pattern(format, new Set())})`, "i");
    regexCache.set(format, re);
  }
  return re;
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/**
 * datetime.strptime(s, format) 的字段。
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number, microsecond: number, utcOffset: number | null }}
 *   utcOffset 为秒；null 表示 naive datetime
 */
export function strptime(s, format) {
  const m = compile(format).exec(s);
  if (!m) throw new Error(`time data '${s}' does not match format '${format}'`);
  if (m[0].length !== s.length) throw new Error(`unconverted data remains: ${s.slice(m[0].length)}`);
  const g = m.groups ?? {};
  let year = 1900;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let microsecond = 0;
  let utcOffset = null;
  let julian = null;
  if (g.y !== undefined) {
    year = parseInt(g.y, 10);
    year += year <= 68 ? 2000 : 1900;
  } else if (g.Y !== undefined) {
    year = parseInt(g.Y, 10);
  }
  if (g.m !== undefined) month = parseInt(g.m, 10);
  else if (g.B !== undefined) month = MONTHS.indexOf(g.B.toLowerCase()) + 1;
  else if (g.b !== undefined) month = MONTHS.findIndex((x) => x.startsWith(g.b.toLowerCase())) + 1;
  if (g.d !== undefined) day = parseInt(g.d, 10);
  if (g.H !== undefined) hour = parseInt(g.H, 10);
  else if (g.I !== undefined) {
    hour = parseInt(g.I, 10);
    const ampm = (g.p ?? "").toLowerCase();
    if (ampm === "" || ampm === "am") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
  }
  if (g.M !== undefined) minute = parseInt(g.M, 10);
  if (g.S !== undefined) second = parseInt(g.S, 10);
  if (g.f !== undefined) microsecond = parseInt(g.f.padEnd(6, "0"), 10);
  if (g.j !== undefined) julian = parseInt(g.j, 10);
  if (g.z !== undefined) {
    const z = g.z;
    if (z === "Z") utcOffset = 0;
    else if (z === "z") throw new Error(`time data '${s}' does not match format '${format}'`);
    else {
      const zm = /^([+-])(\d\d):?(\d\d)(?::?(\d\d)(?:\.(\d{1,6}))?)?$/.exec(z);
      if (!zm) throw new Error(`Inconsistent use of : in ${z}`);
      const secs = parseInt(zm[2], 10) * 3600 + parseInt(zm[3], 10) * 60 + parseInt(zm[4] ?? "0", 10);
      utcOffset = (zm[1] === "-" ? -1 : 1) * secs;
    }
  }
  if (second === 61 || second === 60) {
    // datetime 不接受闰秒
    throw new Error("second must be in 0..59");
  }
  if (julian === null) {
    if (day > daysInMonth(year, month)) throw new Error("day is out of range for month");
  } else {
    // 给了 %j 时以它为准，覆盖月日
    const date = new Date(Date.UTC(2000, 0, 1));
    date.setUTCFullYear(year, 0, julian);
    year = date.getUTCFullYear();
    month = date.getUTCMonth() + 1;
    day = date.getUTCDate();
  }
  return { year, month, day, hour, minute, second, microsecond, utcOffset };
}

/** dt.timestamp()：naive 按本机时区，aware 按自带偏移。返回浮点秒。 */
export function datetimeTimestamp({ year, month, day, hour, minute, second, microsecond, utcOffset }) {
  if (utcOffset === null) {
    const d = new Date(2000, 0, 1, hour, minute, second);
    d.setFullYear(year, month - 1, day);
    return d.getTime() / 1000 + microsecond / 1e6;
  }
  const d = new Date(Date.UTC(2000, 0, 1, hour, minute, second));
  d.setUTCFullYear(year, month - 1, day);
  return d.getTime() / 1000 + microsecond / 1e6 - utcOffset;
}

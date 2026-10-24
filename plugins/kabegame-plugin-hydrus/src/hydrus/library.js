// 插件自己的下载器库：相当于 hydrus 的 NetworkDomainManager 里与下载有关的部分
// （GUG / NGUG、URL class、解析器、URL class → 解析器关联、按域名的自定义请求头与带宽规则）。
//
// 导入沿用 hydrus「导入下载器」面板（ClientGUISerialisableImport._ImportPayloads）不经用户挑选时的流程：
//   完全相同的对象跳过（解析器顺带合并示例 URL）；新对象重新生成 key、重名时加 " (1)" 后缀；
//   旧 URL class 与新 URL class 互相能认出对方的示例 URL 时，旧的改名为 "zzz - renamed due to auto-import - …" 保留；
//   再按 AutoAddURLClassesAndParsers 重算关联：新导入的解析器顶替旧关联，其余空缺按自动关联补上。
// 合并用户 hydrus 数据库里的下载器时也走同一套，只是一次导入很多对象。
import { withInfo } from "./serialisable/core.js";
import { infoOf, load, T } from "./serialisable/index.js";
import { apiPairs, DomainManager, linkUrlClassesAndParsers, readUrlClass, sortByDescendingComplexity, urlClassMatches } from "./runtime/url.js";

export const LIBRARY_FORMAT = 1;

const RENAME_PREFIX = "zzz - renamed due to auto-import - ";

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortByName = (tuples) => [...tuples].sort((a, b) => byCodePoint(a[1], b[1]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 各类型元组里 key、名字、示例的位置 ----

const keyOf = (t) => (t[0] === T.PAGE_PARSER ? infoOf(t)[1] : infoOf(t)[0]);

function withKey(t, key) {
  const info = [...infoOf(t)];
  info[t[0] === T.PAGE_PARSER ? 1 : 0] = key;
  return withInfo(t, info);
}

/** 改名；PageParser 的 info 里也存了一份名字 */
function withName(t, name) {
  const out = [t[0], name, t[2], infoOf(t)];
  if (t[0] === T.PAGE_PARSER) out[3] = [name, ...infoOf(t).slice(1)];
  return out;
}

/** HydrusData.GetNonDupeName */
function nonDupeName(name, disallowed) {
  let out = name;
  for (let i = 1; disallowed.has(out); i++) out = `${name} (${i})`;
  return out;
}

const isGug = (t) => t[0] === T.GALLERY_URL_GENERATOR || t[0] === T.NESTED_GALLERY_URL_GENERATOR;

/** NestedGalleryURLGenerator.RegenerateGUGKey 连子 GUG 的 key 也换成随机值，之后只能按名字找回 */
function regenerateGugKey(t, ctx) {
  const info = [...infoOf(t)];
  info[0] = ctx.generateKey();
  if (t[0] === T.NESTED_GALLERY_URL_GENERATOR) info[2] = info[2].map(([, name]) => [ctx.generateKey(), name]);
  return withInfo(t, info);
}

export class DownloaderLibrary {
  /**
   * @param {{ gugs?: any[], urlClasses?: any[], parsers?: any[], links?: [string, string][], domainPackages?: any[] }} [data]
   *   元组须已是当前版本（fromJSON 会先升级）
   */
  constructor(data = {}) {
    this.gugs = [...(data.gugs ?? [])];
    this.urlClasses = sortByName(data.urlClasses ?? []);
    this.parsers = sortByName(data.parsers ?? []);
    /** @type {Map<string, string>} URL class key → 解析器 key */
    this.links = new Map(data.links ?? []);
    /** @type {Map<string, { headers: [string, string, string][] | null, bandwidthRules: any | null }>} */
    this.domains = new Map();
    for (const pkg of data.domainPackages ?? []) {
      const [domain, headers, bandwidthRules] = infoOf(pkg);
      this.domains.set(domain, { headers, bandwidthRules });
    }
    /** @type {WeakMap<any[], any>} */
    this.readCache = new WeakMap();
  }

  /** 读库文件；元组按需升级到当前版本，单个对象读不出来时丢弃并提示 */
  static fromJSON(json, ctx) {
    if (json?.format !== LIBRARY_FORMAT) throw new Error(`下载器库格式 ${json?.format} 不认识`);
    const loadAll = (tuples) => {
      const out = [];
      for (const t of tuples ?? []) {
        try {
          out.push(load(t, ctx));
        } catch (e) {
          ctx.warn(`下载器库里的 "${t[1]}" 读取失败，已跳过：${e?.message ?? e}`);
        }
      }
      return out;
    };
    return new DownloaderLibrary({
      gugs: loadAll(json.gugs),
      urlClasses: loadAll(json.urlClasses),
      parsers: loadAll(json.parsers),
      links: json.links,
      domainPackages: loadAll(json.domainPackages),
    });
  }

  toJSON() {
    return {
      format: LIBRARY_FORMAT,
      gugs: this.gugs,
      urlClasses: this.urlClasses,
      parsers: this.parsers,
      links: [...this.links],
      domainPackages: this.domainPackages(),
    };
  }

  get isEmpty() {
    return this.gugs.length + this.urlClasses.length + this.parsers.length === 0;
  }

  /** DOMAIN_METADATA_PACKAGE 元组，供 NetworkRules 使用 */
  domainPackages() {
    return [...this.domains].sort(([a], [b]) => byCodePoint(a, b)).map(([domain, { headers, bandwidthRules }]) => [T.DOMAIN_METADATA_PACKAGE, 1, [domain, headers, bandwidthRules]]);
  }

  domainManager(paramOverrides) {
    return new DomainManager({ urlClasses: this.urlClasses, parsers: this.parsers, links: this.links }, paramOverrides);
  }

  read(t) {
    let uc = this.readCache.get(t);
    if (!uc) {
      uc = readUrlClass(t);
      this.readCache.set(t, uc);
    }
    return uc;
  }

  /** _GetURLClass：最具体的那个能认出 url 的 URL class 元组 */
  urlClassTupleFor(url) {
    const ucs = sortByDescendingComplexity(this.urlClasses.map((t) => this.read(t)));
    const uc = ucs.find((c) => urlClassMatches(c, url));
    return uc ? this.urlClasses.find((t) => keyOf(t) === uc.key) : null;
  }

  // ---- GUG ----

  /** _GetGUG：先按 key，再按名字 */
  getGug([key, name]) {
    if (name === "") return null;
    return this.gugs.find((g) => keyOf(g) === key) ?? this.gugs.find((g) => g[1] === name) ?? null;
  }

  /** 按名字选 GUG（含 NGUG），大小写不敏感作为后备 */
  findGug(name) {
    // 有的 png 里 GUG 名带首尾空格，表单输入又会被去掉空格，所以两边都去掉再比；原名完全相同的优先
    const wanted = name.trim();
    return (
      this.gugs.find((g) => g[1] === name) ??
      this.gugs.find((g) => g[1].trim() === wanted) ??
      this.gugs.find((g) => g[1].trim().toLowerCase() === wanted.toLowerCase()) ??
      null
    );
  }

  /** NGUG 展开成它引用的 GUG（NestedGalleryURLGenerator.GenerateGalleryURLs），找不到的子 GUG 跳过 */
  expandGug(gug, warn = () => {}) {
    if (gug[0] === T.GALLERY_URL_GENERATOR) return [gug];
    const out = [];
    for (const [key, name] of infoOf(gug)[2]) {
      const sub = this.getGug([key, name]);
      if (sub?.[0] === T.GALLERY_URL_GENERATOR) out.push(sub);
      else warn(`NGUG "${gug[1]}" 引用的 "${name}" 不在下载器库里，已跳过`);
    }
    return out;
  }

  // ---- 导入 ----

  /** AlreadyHaveExactlyThisURLClass：名字、key、示例 URL 之外完全相同 */
  hasExactUrlClass(t) {
    const exampleUrl = infoOf(t)[16];
    return this.urlClasses.some((u) => {
      const info = [...infoOf(u)];
      info[0] = keyOf(t);
      info[16] = exampleUrl;
      return same([u[0], t[1], u[2], info], t);
    });
  }

  /** AlreadyHaveExactlyThisParser：名字、key、示例 URL、示例上下文之外完全相同；相同时把示例 URL 合并进已有的解析器 */
  mergeExactParser(t) {
    const [, , , , , exampleUrls, exampleContext] = infoOf(t);
    for (let i = 0; i < this.parsers.length; i++) {
      const p = this.parsers[i];
      const info = [t[1], keyOf(t), ...infoOf(p).slice(2)];
      info[5] = exampleUrls;
      info[6] = exampleContext;
      if (!same([p[0], t[1], p[2], info], t)) continue;
      const merged = [...new Set([...infoOf(p)[5], ...exampleUrls])];
      const pInfo = [...infoOf(p)];
      pInfo[5] = merged;
      this.parsers[i] = withInfo(p, pInfo);
      return true;
    }
    return false;
  }

  /**
   * 导入一批下载器对象。
   * @param {any[]} objects  升级后的元组
   * @param {{ ctx: import("./serialisable/core.js").LoadContext, links?: [string, string][] }} options
   *   links：对象来源自带的关联（旧 key），URL class 和解析器都是新导入的才沿用；来自 hydrus 数据库时传入
   */
  importObjects(objects, { ctx, links = [] }) {
    const report = { gugs: [], urlClasses: [], parsers: [], domains: [], renamed: [], duplicates: 0 };
    /** 本批 GUG 原名 → 库里对应的 GUG（新导入的或完全相同的已有对象） */
    const gugsByOriginalName = new Map();

    // url class
    const seenUrlClassNames = new Set();
    const dupeUrlClasses = [];
    let newUrlClasses = [];
    for (const t of objects.filter((o) => o[0] === T.URL_CLASS)) {
      if (seenUrlClassNames.has(t[1])) continue;
      if (this.hasExactUrlClass(t)) {
        dupeUrlClasses.push(t);
        report.duplicates++;
      } else {
        newUrlClasses.push(t);
        seenUrlClassNames.add(t[1]);
      }
    }

    // GUG
    const seenGugNames = new Set();
    let newGugs = [];
    for (const t of objects.filter(isGug)) {
      if (seenGugNames.has(t[1])) continue;
      // AlreadyHaveExactlyThisGUG：key 与名字之外完全相同
      const existing = this.gugs.find((g) => same(withName(withKey(g, keyOf(t)), t[1]), t));
      if (existing) {
        report.duplicates++;
        gugsByOriginalName.set(t[1], existing);
      } else {
        newGugs.push(t);
        seenGugNames.add(t[1]);
      }
    }

    // 解析器
    const seenParserNames = new Set();
    let newParsers = [];
    for (const t of objects.filter((o) => o[0] === T.PAGE_PARSER)) {
      if (seenParserNames.has(t[1])) continue;
      if (this.mergeExactParser(t)) report.duplicates++;
      else {
        newParsers.push(t);
        seenParserNames.add(t[1]);
      }
    }

    // 域名配置：只保留与库里不同的请求头 / 带宽规则
    const seenDomains = new Set();
    let newDomainMetadatas = [];
    for (const t of objects.filter((o) => o[0] === T.DOMAIN_METADATA_PACKAGE)) {
      const [domain, headersList, bandwidthRules] = infoOf(t);
      if (seenDomains.has(domain)) continue;
      const existing = this.domains.get(domain);
      let headers = headersList;
      if (headers !== null && existing?.headers && sameHeaders(existing.headers, headers)) headers = null;
      let rules = bandwidthRules;
      if (rules !== null && existing?.bandwidthRules && same(existing.bandwidthRules, rules)) rules = null;
      if (headers === null && rules === null) report.duplicates++;
      else {
        newDomainMetadatas.push([domain, headers, rules]);
        seenDomains.add(domain);
      }
    }

    newGugs = sortByName(newGugs);
    newUrlClasses = sortByName(newUrlClasses);
    newParsers = sortByName(newParsers);
    newDomainMetadatas.sort(([a], [b]) => byCodePoint(a, b));

    // AddGUGs
    for (const t of newGugs) {
      const added = withName(regenerateGugKey(t, ctx), nonDupeName(t[1], new Set(this.gugs.map((g) => g[1]))));
      this.gugs.push(added);
      gugsByOriginalName.set(t[1], added);
      report.gugs.push(added[1]);
    }

    this.autoAddUrlClassesAndParsers(newUrlClasses, dupeUrlClasses, newParsers, links, report, ctx);

    // BandwidthManager.AutoAddDomainMetadatas 遇到第一个没有带宽规则的包就 return，后面的规则都不加（hydrus 原样如此）
    let bandwidthStopped = false;
    for (const [domain, headers, rules] of newDomainMetadatas) {
      const entry = this.domains.get(domain) ?? { headers: null, bandwidthRules: null };
      if (rules === null) bandwidthStopped = true;
      if (!bandwidthStopped) entry.bandwidthRules = rules;
      if (headers !== null) entry.headers = headers;
      this.domains.set(domain, entry);
      report.domains.push(domain);
    }

    return { ...report, gugsByOriginalName };
  }

  /** NetworkDomainManager.AutoAddURLClassesAndParsers */
  autoAddUrlClassesAndParsers(newUrlClasses, dupeUrlClasses, newParsers, sourceLinks, report, ctx) {
    const ucKeyMap = new Map();
    const parserKeyMap = new Map();
    newUrlClasses = newUrlClasses.map((t) => {
      const key = ctx.generateKey();
      ucKeyMap.set(keyOf(t), key);
      return withKey(t, key);
    });
    newParsers = newParsers.map((t) => {
      const key = ctx.generateKey();
      parserKeyMap.set(keyOf(t), key);
      return withKey(t, key);
    });

    // 已有的、和新 URL class 做同一件事的 URL class 留着，但改名
    const renamees = new Set();
    for (const existing of this.urlClasses) {
      if (existing[1].startsWith(RENAME_PREFIX)) continue;
      const e = this.read(existing);
      if (newUrlClasses.some((n) => urlClassMatches(this.read(n), e.exampleUrl) && urlClassMatches(e, this.read(n).exampleUrl))) renamees.add(existing);
    }
    for (const t of renamees) {
      const i = this.urlClasses.indexOf(t);
      const others = new Set(this.urlClasses.filter((o) => o !== t).map((o) => o[1]));
      this.urlClasses[i] = withName(t, nonDupeName(RENAME_PREFIX + t[1], others));
      report.renamed.push(`${t[1]} → ${this.urlClasses[i][1]}`);
    }

    // AddURLClasses / AddParsers
    for (const t of newUrlClasses) {
      const added = withName(t, nonDupeName(t[1], new Set(this.urlClasses.map((u) => u[1]))));
      this.urlClasses.push(added);
      report.urlClasses.push(added[1]);
    }
    this.setUrlClasses(this.urlClasses);
    for (const t of newParsers) {
      const added = withName(t, nonDupeName(t[1], new Set(this.parsers.map((p) => p[1]))));
      this.parsers.push(added);
      report.parsers.push(added[1]);
    }
    this.setParsers(this.parsers);

    // 新 URL class 与新解析器关联；带了已有 URL class 但解析器更新了的，更新已有 URL class 的关联
    const keySet = new Set(newUrlClasses.map(keyOf));
    const toLink = this.urlClasses.filter((t) => keySet.has(keyOf(t)));
    for (const dupe of dupeUrlClasses) {
      const actual = this.urlClassTupleFor(infoOf(dupe)[16]);
      if (actual) toLink.push(actual);
    }
    const newParserKeys = new Set(newParsers.map(keyOf));
    const linked = linkUrlClassesAndParsers(
      toLink.map((t) => this.read(t)),
      this.parsers.filter((p) => newParserKeys.has(keyOf(p))),
      new Map(),
    );
    for (const [k, v] of linked) this.links.set(k, v);

    // 来源自带的关联（用户在 hydrus 里手动调整过的），两边都是这次新导入的才沿用
    for (const [oldUc, oldParser] of sourceLinks) {
      const uc = ucKeyMap.get(oldUc);
      const parser = parserKeyMap.get(oldParser);
      if (uc && parser) this.links.set(uc, parser);
    }
    this.cleanLinks();

    // TryToLinkURLClassesAndParsers：补上仍然空缺的关联
    for (const [k, v] of linkUrlClassesAndParsers(this.urlClasses.map((t) => this.read(t)), this.parsers, this.links)) this.links.set(k, v);
    this.cleanLinks();
  }

  /** SetURLClasses：按名排序，删掉指向不存在 URL class 的关联、会转 API 的 URL class 的关联 */
  setUrlClasses(urlClasses) {
    this.urlClasses = sortByName(urlClasses);
    const keys = new Set(this.urlClasses.map(keyOf));
    for (const k of [...this.links.keys()]) if (!keys.has(k)) this.links.delete(k);
    this.cleanLinks();
  }

  /** SetParsers：按名排序，删掉指向不存在解析器的关联 */
  setParsers(parsers) {
    this.parsers = sortByName(parsers);
    const keys = new Set(this.parsers.map(keyOf));
    for (const [k, v] of [...this.links]) if (!keys.has(v)) this.links.delete(k);
  }

  /** _CleanURLClassKeysToParserKeys：会转成 API 地址的 URL class 不能有自己的解析器 */
  cleanLinks() {
    for (const [a] of apiPairs(this.urlClasses.map((t) => this.read(t)))) this.links.delete(a.key);
  }
}

/** AlreadyHaveExactlyTheseHeaders：键集合相同、每个键的值相同 */
function sameHeaders(existing, incoming) {
  if (existing.length !== incoming.length) return false;
  const map = new Map(existing.map(([k, v]) => [k, v]));
  return incoming.every(([k, v]) => map.has(k) && map.get(k) === v);
}

// 下载流程，对应 hydrus 的 GallerySeed.WorkOnURL 与 FileSeed.WorkOnURL（URL 类型）：
// 搜索时 GUG（NGUG 展开成多个 GUG）生成第一页 → 列表页解析出文件种子（DESIRED）、子列表页（SUB_GALLERY）
// 与下一页（NEXT）→ 文件种子是帖子地址就抓详情页再解析，解析出一个文件地址就下载，否则把结果排成子文件种子。
// 直接给网址时照 hydrus 的网址导入（URLsImport.PendURLs）：文件、帖子和不认识的地址作文件种子，
// 列表页与 thread 作只抓一页的列表种子（不翻下一页，子列表页照常）。
// 解析出的标签、来源地址、备注等随种子一路继承，下载时作为 metadata。
import { URL_TYPE_FILE, URL_TYPE_POST, URL_TYPE_UNKNOWN } from "../serialisable/url.js";
import { NetworkRules } from "./network.js";
import { cleanTag, ParsingEnv, parsePage, sourceTimeOf, titleOf, URL_TYPE_DESIRED, URL_TYPE_NEXT, URL_TYPE_SOURCE, URL_TYPE_SUB_GALLERY, urlsOf, VetoError } from "./parsing.js";
import { canGenerateNextGalleryPage, generateGalleryUrl, nextGalleryPage } from "./url.js";

/**
 * @typedef {object} GallerySeed
 * @property {string} url
 * @property {string | null} referer
 * @property {string[]} tags
 * @property {boolean} canGenerateMorePages  false 时不翻下一页（网址导入的列表页）
 */

/**
 * @typedef {object} DownloaderIO
 * @property {(url: string, headers: Record<string, string>) => Promise<string>} fetchText
 * @property {(file: import("../api.js").DownloadRequest) => Promise<void>} download
 * @property {(message: string) => void} log
 * @property {(message: string) => void} warn
 * @property {(pct: number) => void} progress
 * @property {(ms: number) => Promise<void>} sleep
 */

/** ClientTime.TimestampIsSensible */
const timestampIsSensible = (t) => t !== null && t > 86400 * 7;

/** FileSeed 里与下载有关的那部分状态 */
class FileSeed {
  /** @param {string} url */
  constructor(url) {
    this.url = url;
    /** @type {string | null} */
    this.referralUrl = null;
    this.primaryUrls = new Set();
    this.sourceUrls = new Set();
    this.tags = new Set();
    /** @type {Map<string, string>} */
    this.notes = new Map();
    /** @type {Map<string, { type: string, encoding: string, value: string }>} */
    this.hashes = new Map();
    /** @type {Map<string, string>} */
    this.headers = new Map();
    /** @type {number | null} */
    this.sourceTime = null;
    /** @type {{ type: number, value: number }[]} */
    this.timestamps = [];
    /** @type {string | null} hydrus 不给文件种子记标题，这里用来给文件命名 */
    this.title = null;
  }

  setReferralUrlIfNotAlreadySet(url) {
    if (this.referralUrl === null && url !== null) this.referralUrl = url;
  }

  addPrimaryUrls(urls) {
    for (const u of urls) {
      if (u === this.url || u === this.referralUrl) continue;
      this.primaryUrls.add(u);
      this.sourceUrls.delete(u);
    }
  }

  addSourceUrls(urls) {
    for (const u of urls) {
      if (u === this.url || u === this.referralUrl || this.primaryUrls.has(u)) continue;
      this.sourceUrls.add(u);
    }
  }

  setSourceTimeIfSensible(t) {
    if (!timestampIsSensible(t)) return;
    t = Math.min(Math.floor(Date.now() / 1000) - 30, t);
    this.sourceTime = this.sourceTime === null ? t : Math.min(this.sourceTime, t);
  }

  /** FileSeed.AddParsedPost */
  addParsedPost(post) {
    for (const { name, value } of post.headers) this.headers.set(name, value);
    for (const h of post.hashes) if (!this.hashes.has(h.type)) this.hashes.set(h.type, h);
    this.addSourceUrls(urlsOf(post, [URL_TYPE_SOURCE]));
    for (const t of post.tags) this.tags.add(t);
    for (const { name, text } of post.notes) if (text !== "") this.notes.set(name, text);
    this.setSourceTimeIfSensible(sourceTimeOf(post));
    this.timestamps.push(...post.timestamps);
    this.title ??= titleOf([post]);
  }

  /** FileSeed._GiveChildFileSeedMyInfo */
  giveChildMyInfo(child, urlForChildReferral) {
    for (const [k, v] of this.headers) if (!child.headers.has(k)) child.headers.set(k, v);
    child.setReferralUrlIfNotAlreadySet(urlForChildReferral);
    if (this.referralUrl !== null) child.addSourceUrls([this.referralUrl]);
    child.addPrimaryUrls([this.url, ...this.primaryUrls]);
    child.addSourceUrls(this.sourceUrls);
    for (const t of this.tags) child.tags.add(t);
    for (const [k, v] of [...this.notes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) child.notes.set(k, v);
    child.title ??= this.title;
  }
}

/** ConvertParsedPostsToParsedPostsAndFileSeeds */
function postsToFileSeeds(posts, sourceUrl) {
  const seen = new Set();
  const out = [];
  for (const post of posts) {
    for (const url of urlsOf(post, [URL_TYPE_DESIRED], true)) {
      if (seen.has(url)) continue;
      seen.add(url);
      const seed = new FileSeed(url);
      seed.referralUrl = sourceUrl;
      seed.addParsedPost(post);
      out.push({ post, seed });
    }
  }
  return out;
}

/** ConvertParsedPostsToGallerySeeds */
function postsToGallerySeeds(posts, urlTypes, addFileMetadata) {
  const seen = new Set();
  const out = [];
  for (const post of posts) {
    for (const url of urlsOf(post, urlTypes, true)) {
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, referer: null, tags: addFileMetadata ? [...post.tags] : [], canGenerateMorePages: true });
    }
  }
  return out;
}

export class GalleryDownloader {
  /**
   * @param {{ domains: import("./url.js").DomainManager, domainPackages?: any[] }} downloader  domains 来自下载器库
   * @param {{ maxPages: number, maxFiles: number }} limits
   *   maxFiles 与 hydrus 的 file limit 一样，只数列表页产生的文件种子
   * @param {DownloaderIO} io
   */
  constructor(downloader, limits, io) {
    this.domains = downloader.domains;
    this.network = new NetworkRules({ domainPackages: downloader.domainPackages ?? [], urlClassFor: (u) => this.domains.urlClassFor(u) });
    for (const d of this.network.describeIgnoredDataRules()) io.warn(`[hydrus] 数据量带宽规则暂不执行：${d}`);
    this.limits = limits;
    this.io = io;
    this.seenFileSeeds = new Set();
    this.filesHandled = 0;
  }

  /** 一次请求：等带宽规则放行，再按 hydrus 规则带上请求头；extraHeaders 是解析出的 http headers，最后覆盖。 */
  async fetchPage(url, referralUrl, extraHeaders = new Map()) {
    await this.network.waitForBandwidth(url, this.io.sleep);
    return await this.io.fetchText(url, { ...this.network.headersFor(url, referralUrl), ...Object.fromEntries(extraHeaders) });
  }

  /**
   * 搜索：每个 GUG 生成一个起始列表页（NGUG 已展开成多个 GUG），共用文件数上限。
   * @param {any[]} gugs  GALLERY_URL_GENERATOR 元组
   * @param {string} query
   */
  async run(gugs, query) {
    const seeds = gugs.map((gug) => {
      const url = generateGalleryUrl(gug, query);
      this.io.log(`[hydrus] GUG "${gug[1]}" → ${url}`);
      return { url, referer: null, tags: [], canGenerateMorePages: true };
    });
    await this.runGallerySeeds(seeds);
  }

  /** 网址导入（URLsImport.PendURLs） */
  async runUrls(urls) {
    const fileSeeds = [];
    const gallerySeeds = [];
    for (const url of urls) {
      const uc = this.domains.urlClassFor(url);
      if (!uc || uc.urlType === URL_TYPE_FILE || uc.urlType === URL_TYPE_POST) {
        if (this.seenFileSeeds.has(url)) continue;
        this.seenFileSeeds.add(url);
        fileSeeds.push(new FileSeed(url));
      } else {
        gallerySeeds.push({ url, referer: null, tags: [], canGenerateMorePages: false });
      }
      this.io.log(`[hydrus] ${url}：${uc ? `${uc.name}` : "没有匹配的 URL class，按文件地址下载"}`);
    }
    for (const seed of fileSeeds) {
      await this.workOnFileSeedTree(seed);
      this.io.progress(100 / urls.length);
    }
    if (gallerySeeds.length > 0) await this.runGallerySeeds(gallerySeeds);
  }

  /**
   * 列表页上限按「列表起点」分别计：每个起始列表页（NGUG 的每个子 GUG）、每个子列表页各自从 1 开始，
   * 只有翻下一页才消耗同一份额度；文件数上限共用。
   * hydrus 没有列表页上限，子列表页总会处理；「先查 ID、再进列表」的下载器第一页只产出子列表页，
   * 让子列表页另起额度，默认 1 页时这类下载器才拿得到文件。
   * @param {GallerySeed[]} initialSeeds
   */
  async runGallerySeeds(initialSeeds) {
    const queue = initialSeeds.map((s, origin) => ({ ...s, origin }));
    let nextOrigin = queue.length;
    const seenGallery = new Set(queue.map((s) => s.url));
    const pagesByOrigin = new Map();
    let pages = 0;

    while (queue.length > 0 && this.filesHandled < this.limits.maxFiles) {
      const gallerySeed = queue.shift();
      const originPages = pagesByOrigin.get(gallerySeed.origin) ?? 0;
      if (originPages >= this.limits.maxPages) continue;
      pagesByOrigin.set(gallerySeed.origin, originPages + 1);
      pages++;
      let result;
      try {
        result = await this.workOnGallerySeed(gallerySeed, pages);
      } catch (e) {
        // 与 hydrus 一样，这个列表页记为出错，继续处理其余的（NGUG 的其它子 GUG、子列表页）
        if (e instanceof VetoError) this.io.warn(`[hydrus] 列表页 ${gallerySeed.url} 被否决：${e.message}`);
        else this.io.warn(`[hydrus] 列表页 ${gallerySeed.url} 失败：${e?.message ?? e}`);
        continue;
      }
      const { subGalleries, nextPages } = result;
      // 子列表页排在当前页之后、下一页之前
      const fresh = (seeds) => seeds.filter((s) => !seenGallery.has(s.url));
      const subs = fresh(subGalleries).map((s) => ({ ...s, origin: nextOrigin++ }));
      const nexts = fresh(nextPages);
      for (const s of [...subs, ...nexts]) seenGallery.add(s.url);
      queue.unshift(...subs);
      queue.push(...nexts);
    }
    this.io.log(`[hydrus] 结束：${pages} 个列表页，处理 ${this.filesHandled} 个地址`);
  }

  /** GallerySeed.WorkOnURL */
  async workOnGallerySeed(gallerySeed, pageNumber) {
    const target = this.domains.fetchTarget(gallerySeed.url);
    if (!target) throw new Error(`列表页 ${gallerySeed.url} 没有匹配的 URL class`);
    if (!target.parser) throw new Error(`URL class "${target.urlClass.name}" 没有关联的解析器`);
    this.io.log(`[hydrus] 列表页 ${pageNumber}: ${target.url}（${target.urlClass.name} → ${target.parser[1]}）`);

    const text = await this.fetchPage(target.url, gallerySeed.referer);
    const parsingContext = { gallery_url: gallerySeed.url, url: target.url, post_index: "0" };
    const posts = parsePage(target.parser, text, parsingContext, new ParsingEnv());
    if (posts.length === 0) throw new VetoError("解析器在列表页里什么都没找到");

    const fileSeeds = [];
    for (const { seed } of postsToFileSeeds(posts, target.url)) {
      // GallerySeed._GiveChildFileSeedMyInfo
      seed.setReferralUrlIfNotAlreadySet(target.url);
      seed.addPrimaryUrls([gallerySeed.url]);
      for (const t of gallerySeed.tags) seed.tags.add(t);
      if (this.seenFileSeeds.has(seed.url)) continue;
      this.seenFileSeeds.add(seed.url);
      fileSeeds.push(seed);
    }
    this.io.log(`[hydrus]   找到 ${fileSeeds.length} 个新地址`);

    let added = 0;
    for (const seed of fileSeeds) {
      if (this.filesHandled >= this.limits.maxFiles) break;
      this.filesHandled++;
      added++;
      await this.workOnFileSeedTree(seed);
      this.io.progress(100 / this.limits.maxFiles);
    }

    const withReferer = (seeds) =>
      seeds.map((s) => ({
        ...s,
        referer: target.url,
        tags: [...gallerySeed.tags, ...s.tags],
        canGenerateMorePages: gallerySeed.canGenerateMorePages,
        origin: gallerySeed.origin,
      }));
    const subGalleries = withReferer(postsToGallerySeeds(posts, [URL_TYPE_SUB_GALLERY], true));
    // 没找到新文件时不继续翻页，避免空结果页无限翻下去
    let nextPages = [];
    if (added > 0 && gallerySeed.canGenerateMorePages) {
      nextPages = withReferer(postsToGallerySeeds(posts, [URL_TYPE_NEXT], false));
      if (nextPages.length === 0 && canGenerateNextGalleryPage(target.urlClass)) {
        try {
          const generated = nextGalleryPage(target.urlClass, target.url);
          this.io.log(`[hydrus]   解析器没给出下一页，按 URL class 递增页码：${generated}`);
          nextPages = withReferer([{ url: generated, referer: null, tags: [], canGenerateMorePages: true }]);
        } catch (e) {
          this.io.warn(`[hydrus] 无法生成下一页: ${e?.message ?? e}`);
        }
      }
    }
    return { subGalleries, nextPages };
  }

  /** 处理一个文件种子及其展开出的全部子种子（hydrus 把子种子插在父种子后面，这里深度优先依次处理） */
  async workOnFileSeedTree(root) {
    const stack = [root];
    while (stack.length > 0) {
      const seed = stack.shift();
      try {
        const children = await this.workOnFileSeed(seed);
        stack.unshift(...children);
      } catch (e) {
        if (e instanceof VetoError) this.io.log(`[hydrus]   ${seed.url} 被否决：${e.message}`);
        else this.io.warn(`[hydrus] ${seed.url} 失败: ${e?.message ?? e}`);
      }
    }
  }

  /**
   * FileSeed.WorkOnURL：返回需要继续处理的子种子
   * @param {FileSeed} seed
   * @returns {Promise<FileSeed[]>}
   */
  async workOnFileSeed(seed) {
    const uc = this.domains.urlClassFor(seed.url);
    if (!uc || uc.urlType !== URL_TYPE_POST) {
      await this.downloadFile(seed, seed.url, seed.referralUrl);
      return [];
    }

    const target = this.domains.fetchTarget(seed.url);
    if (!target.parser) throw new Error(`URL class "${target.urlClass.name}" 没有关联的解析器`);
    const text = await this.fetchPage(target.url, seed.referralUrl, seed.headers);
    const parsingContext = { post_url: seed.url, url: target.url };
    const posts = parsePage(target.parser, text, parsingContext, new ParsingEnv());
    if (posts.length === 0) throw new VetoError(`解析器 "${target.parser[1]}" 在页面里什么都没找到`);

    // 子种子的 referer 是实际请求的地址（可能是 API 地址）
    const urlForChildReferral = target.url;
    const pairs = postsToFileSeeds(posts, urlForChildReferral);
    if (pairs.length === 0) throw new VetoError("解析器找到了内容，但没有可下载的文件或帖子地址");

    if (pairs.length === 1) {
      const { post, seed: only } = pairs[0];
      const childClass = this.domains.urlClassFor(only.url);
      const childType = childClass ? childClass.urlType : URL_TYPE_UNKNOWN;
      if (childType === URL_TYPE_FILE || childType === URL_TYPE_UNKNOWN) {
        seed.addParsedPost(post);
        this.io.log(`[hydrus]   ${target.url}：1 个文件，${seed.tags.size} 个标签`);
        await this.downloadFile(seed, only.url, urlForChildReferral);
        return [];
      }
    }

    const children = pairs.map(({ seed: child }) => child).filter((child) => !this.seenFileSeeds.has(child.url));
    for (const child of children) {
      this.seenFileSeeds.add(child.url);
      seed.giveChildMyInfo(child, urlForChildReferral);
    }
    this.io.log(`[hydrus]   ${target.url}：展开出 ${children.length} 个子地址`);
    return children;
  }

  /** FileSeed.DownloadAndImportRawFile：文件请求同样受带宽规则约束 */
  async downloadFile(seed, fileUrl, referralUrl) {
    await this.network.waitForBandwidth(fileUrl, this.io.sleep);
    const headers = { ...this.network.headersFor(fileUrl, referralUrl), ...Object.fromEntries(seed.headers) };
    const primaryUrls = [...seed.primaryUrls];
    if (seed.url !== fileUrl) primaryUrls.unshift(seed.url);
    // 详情页地址：主地址里第一个属于帖子类 URL class 的
    const postUrl = primaryUrls.find((u) => this.domains.urlClassFor(u)?.urlType === URL_TYPE_POST) ?? null;
    await this.io.download({
      fileUrl,
      postUrl,
      primaryUrls,
      title: seed.title,
      tags: [...new Set([...seed.tags].map(cleanTag).filter((t) => t !== ""))],
      sourceUrls: [...seed.sourceUrls],
      notes: [...seed.notes].map(([name, text]) => ({ name, text })),
      hashes: [...seed.hashes.values()],
      sourceTime: seed.sourceTime,
      timestamps: seed.timestamps,
      headers,
    });
  }
}

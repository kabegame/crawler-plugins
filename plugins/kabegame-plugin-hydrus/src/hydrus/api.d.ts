// hydrus 引擎（JS 实现）对插件入口暴露的类型边界。

/** hydrus 序列化元组：[type, version, info] 或具名的 [type, name, version, info]。 */
export type HydrusTuple = [number, number, unknown] | [number, string, number, unknown];

export interface LoadContext {
  warn(message: string): void;
  /** HydrusData.GenerateKey().hex() */
  generateKey(): string;
}

export function defaultContext(): LoadContext;

/** 读取 downloader png 并升级到 hydrus 当前格式；不支持的对象跳过并在 skipped 里说明。 */
export function loadHydrusPng(
  pngBytes: Uint8Array,
  options: { inflate: (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>; ctx?: LoadContext },
): Promise<{ objects: HydrusTuple[]; skipped: string[] }>;

/** HydrusSerialisable.SERIALISABLE_TYPE_* 中插件入口用到的 */
export const T: { GALLERY_URL_GENERATOR: number; NESTED_GALLERY_URL_GENERATOR: number; URL_CLASS: number; PAGE_PARSER: number };

export interface ImportReport {
  /** 本次新增的对象（导入后的名字，重名时带 " (1)" 后缀） */
  gugs: string[];
  urlClasses: string[];
  parsers: string[];
  domains: string[];
  /** 因新导入的 URL class 做同一件事而改名保留的旧 URL class：「旧名 → 新名」 */
  renamed: string[];
  /** 与库里完全相同而跳过的对象数 */
  duplicates: number;
  /** 本批 GUG 原名 → 库里对应的 GUG（新导入的或完全相同的已有对象） */
  gugsByOriginalName: Map<string, HydrusTuple>;
}

/** 插件自己的下载器库，导入规则与 hydrus 的「导入下载器」一致 */
export class DownloaderLibrary {
  constructor();
  static fromJSON(json: unknown, ctx: LoadContext): DownloaderLibrary;
  toJSON(): unknown;
  readonly isEmpty: boolean;
  readonly gugs: HydrusTuple[];
  importObjects(objects: HydrusTuple[], options: { ctx: LoadContext; links?: [string, string][] }): ImportReport;
  /** 按名字选 GUG 或 NGUG */
  findGug(name: string): HydrusTuple | null;
  /** NGUG 展开成它引用的 GUG；普通 GUG 原样返回 */
  expandGug(gug: HydrusTuple, warn?: (message: string) => void): HydrusTuple[];
  domainManager(paramOverrides?: Map<string, string>): DomainManager;
  domainPackages(): HydrusTuple[];
}

export interface DomainManager {
  urlClassFor(url: string): { name: string; urlType: number } | null;
}

/** Kabegame.fs / Deno 的同步文件接口子集 */
export interface SyncFs {
  openSync(path: string): { seekSync(offset: number, whence: 0): number; readSync(buf: Uint8Array): number | null; statSync(): { size: number }; close(): void };
  statSync(path: string): { size: number; mtime: Date | null };
}

export interface HydrusFileRecord {
  /** sha256 十六进制 */
  hash: string;
  mime: number;
  /** hydrus 存盘用的扩展名；不是图片、动图、视频时为 null */
  ext: string | null;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  numFrames: number | null;
  modifiedMs: number | null;
  archivedMs: number | null;
  inbox: boolean;
  /** 各来源站点上的修改时间 */
  domainModified: { domain: string; ms: number }[];
  tags: string[];
  urls: string[];
  notes: { name: string; text: string }[];
}

/** 只读打开 hydrus 的 db 目录 */
export class HydrusDatabase {
  constructor(dir: string, fs: SyncFs);
  close(): void;
  /** 在一致的快照上执行只读的 fn；hydrus 正在写入时重开再试 */
  consistent<R>(fn: () => R): R;
  readDownloaders(ctx: LoadContext): { objects: HydrusTuple[]; skipped: string[]; links: [string, string][]; skippedHeaders: string[] };
  listFiles(options: { includeTrash: boolean }): { hashId: number; importedMs: number | null; trashed: boolean }[];
  tagServices(): { id: number; type: number; name: string }[];
  /** hash 前缀（不含 f）→ 位置；inMount 为 false 表示位置不在 db 目录下 */
  fileLocations(): { prefixes: Map<string, { location: string; inMount: boolean }> };
  readFile(hashId: number, tagServices: { id: number }[]): HydrusFileRecord | null;
}

export interface DownloadRequest {
  fileUrl: string;
  /** 解析出这个文件的详情页（主地址里第一个帖子类地址）；直接来自列表页的文件为 null */
  postUrl: string | null;
  /** hydrus 的 primary urls：帖子地址、父帖子地址、列表页地址等 */
  primaryUrls: string[];
  title: string | null;
  tags: string[];
  sourceUrls: string[];
  notes: { name: string; text: string }[];
  hashes: { type: string; encoding: string; value: string }[];
  /** hydrus 的来源时间（unix 秒），取各处解析出的最早的 modified domain 时间 */
  sourceTime: number | null;
  /** type 为 hydrus 的 TIMESTAMP_TYPE_*，value 为 unix 秒 */
  timestamps: { type: number; value: number }[];
  /** 按 hydrus 规则算出的完整请求头 */
  headers: Record<string, string>;
}

export interface DownloaderIO {
  fetchText(url: string, headers: Record<string, string>): Promise<string>;
  download(file: DownloadRequest): Promise<void>;
  log(message: string): void;
  warn(message: string): void;
  progress(pct: number): void;
  sleep(ms: number): Promise<void>;
}

export class GalleryDownloader {
  constructor(
    downloader: { domains: DomainManager; domainPackages?: HydrusTuple[] },
    limits: { maxPages: number; maxFiles: number },
    io: DownloaderIO,
  );
  /** 搜索：gugs 是展开后的 GUG，共用文件数上限 */
  run(gugs: HydrusTuple[], query: string): Promise<void>;
  /** 网址导入：文件与帖子地址直接处理，列表页只抓一页 */
  runUrls(urls: string[]): Promise<void>;
}

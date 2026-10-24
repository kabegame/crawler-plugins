// 读取用户现有的 hydrus 数据库（db 目录下的 client*.db 与 client_files），只读、不经 SQL 引擎。
//
// 用到的表（hydrus v690 的 schema）：
//   client.db          services、current_files_<文件服务>、files_info、file_modified_timestamps、
//                      file_domain_modified_timestamps、archive_timestamps、file_inbox、url_map、file_notes、
//                      client_files_subfolders、current_client_files_locations、json_dumps（53 = domain manager）
//   client.master.db   hashes、tags、namespaces、subtags、urls、url_domains、labels（备注名）、notes
//   client.mappings.db current_mappings_<标签服务>（WITHOUT ROWID）及其 (hash_id, tag_id) 索引
// 文件在 <位置>/f<hash 前两位>/<hash><扩展名>，位置是相对 db 目录的路径或绝对路径。
import { infoOf, loadDownloaderObjects, T } from "./serialisable/index.js";
import { openDatabase, SqliteSnapshotChanged } from "../sqlite/reader.js";

// HydrusConstants 的服务类型
const LOCAL_FILE_TRASH_DOMAIN = 14;
const COMBINED_LOCAL_FILE_DOMAINS = 21;
const LOCAL_TAG = 5;
const NETWORK_CONTEXT_DOMAIN = 2;
const VALID_APPROVED = 1;
const DOMAIN_MANAGER_VERSION = 7;

/** HydrusConstants.mime_ext_lookup 里图片、动图、视频的部分（ugoira 的 zip 不算） */
const MIME_EXT = {
  1: ".jpg",
  2: ".png",
  3: ".gif",
  4: ".bmp",
  7: ".ico",
  9: ".flv",
  14: ".mp4",
  18: ".wmv",
  20: ".mkv",
  21: ".webm",
  23: ".png",
  25: ".mpeg",
  26: ".mov",
  27: ".avi",
  33: ".webp",
  34: ".tiff",
  37: ".rm",
  47: ".ogv",
  61: ".heif",
  62: ".heifs",
  63: ".heic",
  64: ".heics",
  65: ".avif",
  66: ".avifs",
  68: ".gif",
  70: ".qoi",
  83: ".webp",
  85: ".jxl",
  88: ".jxl",
};

/** 不写进插件下载器库的请求头：凭据只用于 hydrus 自己，不复制出来 */
const CREDENTIAL_HEADERS = new Set(["cookie", "authorization", "proxy-authorization"]);

const MAX_SNAPSHOT_RETRIES = 5;

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * @typedef {object} SyncFs  Kabegame.fs / Deno 的同步文件接口子集
 * @property {(path: string) => { seekSync(offset: number, whence: number): number, readSync(buf: Uint8Array): number | null, statSync(): { size: number }, close(): void }} openSync
 * @property {(path: string) => { size: number, mtime: Date | null, isDirectory: boolean }} statSync
 */

/** 打开一个文件供 SQLite 读取器按偏移读；不存在时返回 null */
function openFile(fs, path, versionFromHeader = false) {
  let f;
  try {
    f = fs.openSync(path);
  } catch {
    return null;
  }
  const readAt = (offset, length) => {
    const buf = new Uint8Array(length);
    f.seekSync(offset, 0);
    let got = 0;
    while (got < length) {
      const n = f.readSync(buf.subarray(got));
      if (!n) break;
      got += n;
    }
    return buf.subarray(0, got);
  };
  return {
    size: f.statSync().size,
    readAt,
    // WAL 只会在末尾追加帧，这不影响已取的快照；只有重置（salt 变化）才算变化
    version: versionFromHeader
      ? () => hex(readAt(0, 32))
      : () => {
          const s = fs.statSync(path);
          return [s.size, s.mtime?.getTime() ?? null];
        },
    close: () => f.close(),
  };
}

export class HydrusDatabase {
  /**
   * @param {string} dir  hydrus 的 db 目录（含 client.db）
   * @param {SyncFs} fs
   */
  constructor(dir, fs) {
    this.dir = dir.replace(/\/+$/, "");
    this.fs = fs;
    this.handles = [];
    this.open();
  }

  open() {
    this.close();
    const openOne = (name) => {
      const db = openFile(this.fs, `${this.dir}/${name}`);
      if (!db) throw new Error(`没有找到 ${name}，请选择 hydrus 的 db 目录（里面有 client.db）`);
      const wal = openFile(this.fs, `${this.dir}/${name}-wal`, true);
      this.handles.push(db, ...(wal ? [wal] : []));
      return openDatabase({ db, wal: wal && wal.size > 0 ? wal : null });
    };
    this.roots = new WeakMap();
    this.client = openOne("client.db");
    this.master = openOne("client.master.db");
    this.mappings = openOne("client.mappings.db");
  }

  close() {
    for (const h of this.handles) h.close();
    this.handles = [];
  }

  /** 三个库自打开以来都没有被改写 */
  checkUnchanged() {
    for (const db of [this.client, this.master, this.mappings]) db.checkUnchanged();
  }

  /**
   * 在一致的快照上执行 fn：hydrus 正在写入导致快照失效时重开再执行，最多 MAX_SNAPSHOT_RETRIES 次。
   * fn 只能读，不能有副作用。
   */
  consistent(fn) {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = fn();
        this.checkUnchanged();
        return result;
      } catch (e) {
        if (!(e instanceof SqliteSnapshotChanged) || attempt >= MAX_SNAPSHOT_RETRIES) {
          if (e instanceof SqliteSnapshotChanged) throw new Error(`hydrus 正在写入数据库，读不到一致的数据，请先关闭 hydrus 再试（${e.message}）`);
          throw e;
        }
        this.open();
      }
    }
  }

  /** 表或索引的根页（按库缓存，读文件时会反复用到） */
  root(db, name) {
    let roots = this.roots.get(db);
    if (!roots) this.roots.set(db, (roots = new Map()));
    let root = roots.get(name);
    if (root === undefined) {
      root = db.rootOf(name);
      if (root === null) throw new Error(`hydrus 数据库里没有 ${name}，可能是不支持的 hydrus 版本`);
      roots.set(name, root);
    }
    return root;
  }

  /** services 表：[{ id, type, name }] */
  services() {
    return [...this.client.rows(this.root(this.client, "services"))].map(([id, v]) => ({ id, type: v[2], name: v[3] }));
  }

  // ---- 下载器 ----

  /**
   * 读出 domain manager 里的下载器对象，供合并进插件的下载器库。
   * @returns {{ objects: any[], skipped: string[], links: [string, string][], skippedHeaders: string[] }}
   */
  readDownloaders(ctx) {
    const row = this.consistent(() => this.client.get(this.root(this.client, "json_dumps"), T.NETWORK_DOMAIN_MANAGER));
    if (!row) throw new Error("hydrus 数据库里没有下载器设置（domain manager）");
    const [, version, dump] = row;
    if (version !== DOMAIN_MANAGER_VERSION) throw new Error(`hydrus 下载器设置的版本 ${version} 不支持，只支持 ${DOMAIN_MANAGER_VERSION}（hydrus v4xx 起）`);
    const info = JSON.parse(typeof dump === "string" ? dump : new TextDecoder().decode(dump));
    const [gugs, , urlClasses, , links, , , parsers, customHeaders] = info;
    const objects = [];
    const skipped = [];
    for (const list of [gugs, urlClasses, parsers]) {
      const r = loadDownloaderObjects(list, ctx);
      objects.push(...r.objects);
      skipped.push(...r.skipped);
    }
    // 自定义请求头：只取按域名、已批准的，转成 domain metadata 包与 png 走同一条导入路径
    const skippedHeaders = [];
    for (const [networkContext, headerItems] of customHeaders) {
      const [contextType, domain] = infoOf(networkContext);
      if (contextType !== NETWORK_CONTEXT_DOMAIN || typeof domain !== "string") continue;
      const headers = [];
      for (const [key, [value, approved, reason]] of headerItems) {
        if (approved !== VALID_APPROVED) continue;
        if (CREDENTIAL_HEADERS.has(key.toLowerCase())) {
          skippedHeaders.push(`${domain} ${key}`);
          continue;
        }
        headers.push([key, value, reason]);
      }
      if (headers.length > 0) objects.push([T.DOMAIN_METADATA_PACKAGE, 1, [domain, headers, null]]);
    }
    return { objects, skipped, links: infoOf(links), skippedHeaders };
  }

  // ---- 文件 ----

  /**
   * 本地文件：「所有我的文件」（合并全部本地文件域），可选加上回收站。
   * @returns {{ hashId: number, importedMs: number | null, trashed: boolean }[]}
   */
  listFiles({ includeTrash }) {
    return this.consistent(() => {
      const services = this.services();
      const files = new Map();
      const scan = (type, trashed) => {
        for (const s of services.filter((x) => x.type === type)) {
          for (const [hashId, [, importedMs]] of this.client.rows(this.root(this.client, `current_files_${s.id}`))) {
            if (!files.has(hashId)) files.set(hashId, { hashId, importedMs, trashed });
          }
        }
      };
      scan(COMBINED_LOCAL_FILE_DOMAINS, false);
      if (includeTrash) scan(LOCAL_FILE_TRASH_DOMAIN, true);
      return [...files.values()];
    });
  }

  /** 本地标签服务（my tags、downloader tags 等），不含标签仓库（PTR） */
  tagServices() {
    return this.services().filter((s) => s.type === LOCAL_TAG);
  }

  /**
   * 文件所在目录：hash 前缀 → 目录（相对 db 目录的位置拼成 db 目录下的路径；绝对路径或跳出 db 目录的原样给出，
   * 由调用方决定能否访问）。
   * @returns {{ prefixes: Map<string, { location: string, inMount: boolean }> }}
   */
  fileLocations() {
    return this.consistent(() => {
      const locations = new Map();
      for (const [id, [, location]] of this.client.rows(this.root(this.client, "current_client_files_locations"))) locations.set(id, location);
      const prefixes = new Map();
      for (const [, [prefix, locationId]] of this.client.rows(this.root(this.client, "client_files_subfolders"))) {
        if (!prefix.startsWith("f")) continue;
        const location = locations.get(locationId) ?? "";
        const normalised = location.replace(/\\/g, "/");
        const inMount = normalised !== "" && !normalised.startsWith("/") && !/^[a-zA-Z]:/.test(normalised) && !normalised.split("/").includes("..");
        prefixes.set(prefix.slice(1), { location: normalised, inMount });
      }
      return { prefixes };
    });
  }

  /**
   * 一个文件的全部信息；files_info 里没有（文件记录不完整）时返回 null。
   * @param {number} hashId
   * @param {{ id: number }[]} tagServices
   */
  readFile(hashId, tagServices) {
    const c = this.client;
    const m = this.master;
    const hashRow = m.get(this.root(m, "hashes"), hashId);
    const info = c.get(this.root(c, "files_info"), hashId);
    if (!hashRow || !info) return null;
    const [, size, mime, width, height, duration, numFrames] = info;

    const tags = new Set();
    for (const s of tagServices) {
      const index = this.mappings.rootOf(`current_mappings_${s.id}_hash_id_tag_id_index`);
      if (index === null) continue;
      for (const [, tagId] of this.mappings.indexRange(index, hashId)) {
        const tag = m.get(this.root(m, "tags"), tagId);
        if (!tag) continue;
        const [, namespaceId, subtagId] = tag;
        const namespace = m.get(this.root(m, "namespaces"), namespaceId)?.[1] ?? "";
        const subtag = m.get(this.root(m, "subtags"), subtagId)?.[1];
        if (subtag === undefined) continue;
        tags.add(namespace === "" ? subtag : `${namespace}:${subtag}`);
      }
    }

    const urls = [];
    for (const [, urlId] of c.indexRange(this.root(c, "sqlite_autoindex_url_map_1"), hashId)) {
      const url = m.get(this.root(m, "urls"), urlId)?.[2];
      if (url) urls.push(url);
    }

    const notes = [];
    const notesTable = this.root(c, "file_notes");
    for (const [, , rowid] of c.indexRange(this.root(c, "sqlite_autoindex_file_notes_1"), hashId)) {
      const [, nameId, noteId] = c.get(notesTable, rowid) ?? [];
      const name = m.get(this.root(m, "labels"), nameId)?.[1];
      const text = m.get(this.root(m, "notes"), noteId)?.[1];
      if (name !== undefined && text !== undefined) notes.push({ name, text });
    }

    const domainModified = [];
    const dmTable = this.root(c, "file_domain_modified_timestamps");
    for (const [, domainId, rowid] of c.indexRange(this.root(c, "sqlite_autoindex_file_domain_modified_timestamps_1"), hashId)) {
      const ms = c.get(dmTable, rowid)?.[2];
      const domain = m.get(this.root(m, "url_domains"), domainId)?.[1];
      if (typeof ms === "number" && domain !== undefined) domainModified.push({ domain, ms });
    }

    return {
      hash: hex(hashRow[1]),
      mime,
      ext: MIME_EXT[mime] ?? null,
      size,
      width,
      height,
      duration,
      numFrames,
      modifiedMs: c.get(this.root(c, "file_modified_timestamps"), hashId)?.[1] ?? null,
      archivedMs: c.get(this.root(c, "archive_timestamps"), hashId)?.[1] ?? null,
      inbox: c.get(this.root(c, "file_inbox"), hashId) !== null,
      domainModified,
      tags: [...tags],
      urls,
      notes,
    };
  }
}

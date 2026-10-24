import { unzlibSync } from "fflate";
import {
  defaultContext,
  DownloaderLibrary,
  GalleryDownloader,
  type HydrusFileRecord,
  type HydrusTuple,
  HydrusDatabase,
  type ImportReport,
  type LoadContext,
  loadHydrusPng,
  type SyncFs,
  T,
} from "./hydrus/api.js";

const { addProgress, delHeader, downloadImage, setHeader, warn } = Kabegame;

const LABEL_KEY_MAX_BYTES = 64;

/** 标签 key 只允许 [a-zA-Z0-9_-]、英文括号和空格（不在首尾、不连续），≤64 字节。 */
function labelKey(s: string): string | null {
  const key = s
    .toLowerCase()
    .replace(/[^a-z0-9_\-() ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (key === "" || new TextEncoder().encode(key).length > LABEL_KEY_MAX_BYTES) return null;
  return key;
}

/** hydrus 的 "namespace:subtag" → 标签画册 hydrus/<namespace>/<subtag>；无 namespace 归入 general。 */
function labelsFromTags(tags: string[]): KabegameLabelInput[] {
  const labels: KabegameLabelInput[] = [];
  for (const tag of tags) {
    const i = tag.indexOf(":");
    const namespace = i > 0 ? tag.slice(0, i) : "general";
    const subtag = i >= 0 ? tag.slice(i + 1) : tag;
    const nsKey = labelKey(namespace);
    const key = labelKey(subtag);
    if (!nsKey || !key) continue;
    labels.push({ key, category: `hydrus/${nsKey}`, name: subtag });
  }
  return labels;
}

/**
 * 宿主的请求头是任务级的，且 downloadImage 不支持单次请求头：每次请求前把任务头换成这次要的那一套。
 * 只改有变化的键（setHeader 每次都会写库），上一次有、这次没有的键删掉，免得 Referer 等串到别的请求上。
 */
const taskHeaders = new Map<string, string>();
function applyTaskHeaders(headers: Record<string, string>) {
  const wanted = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), [k, v] as const]));
  for (const key of [...taskHeaders.keys()]) {
    if (!wanted.has(key.toLowerCase())) {
      delHeader(key);
      taskHeaders.delete(key);
    }
  }
  for (const [, [k, v]] of wanted) {
    const existing = [...taskHeaders.keys()].find((x) => x.toLowerCase() === k.toLowerCase());
    if (existing !== undefined && taskHeaders.get(existing) === v) continue;
    if (existing !== undefined) taskHeaders.delete(existing);
    setHeader(k, v);
    taskHeaders.set(k, v);
  }
}

function fileNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

// ---- 下载器库 ----

const LIBRARY_FILE = "data/hydrus-library.json";
const LIBRARY_LOCK = "data/hydrus-library.lock";

const libraryPath = (name: string) => `${Kabegame.fs.getRoot()}/${name}`;

async function loadLibrary(ctx: LoadContext): Promise<DownloaderLibrary> {
  let text: string;
  try {
    text = await Kabegame.fs.readTextFile(libraryPath(LIBRARY_FILE));
  } catch {
    return new DownloaderLibrary();
  }
  return DownloaderLibrary.fromJSON(JSON.parse(text), ctx);
}

/** 读库 → 修改 → 写回，用文件锁避免两个任务同时导入时互相覆盖；空跑时只在内存里改 */
async function updateLibrary(ctx: LoadContext, dryRun: boolean, update: (library: DownloaderLibrary) => void): Promise<DownloaderLibrary> {
  if (dryRun) {
    const library = await loadLibrary(ctx);
    update(library);
    console.log("[hydrus] 空跑：导入结果只用于本次任务，下载器库不保存");
    return library;
  }
  await Kabegame.fs.mkdir(libraryPath("data"), { recursive: true });
  const lock = await Kabegame.fs.open(libraryPath(LIBRARY_LOCK), { read: true, write: true, create: true });
  try {
    await lock.lock(true);
    const library = await loadLibrary(ctx);
    update(library);
    const tmp = libraryPath(`${LIBRARY_FILE}.tmp`);
    await Kabegame.fs.writeTextFile(tmp, JSON.stringify(library.toJSON()));
    await Kabegame.fs.rename(tmp, libraryPath(LIBRARY_FILE));
    return library;
  } finally {
    lock.close();
  }
}

function logImport(source: string, report: ImportReport) {
  const part = (label: string, names: string[]) => (names.length > 0 ? `${label} ${names.length} 个（${names.join("、")}）` : null);
  const parts = [
    part("GUG", report.gugs),
    part("URL class", report.urlClasses),
    part("解析器", report.parsers),
    part("域名配置", report.domains),
  ].filter((x) => x !== null);
  console.log(`[hydrus] 导入 ${source}：${parts.length > 0 ? `新增 ${parts.join("，")}` : "没有新对象"}；与库里相同而跳过 ${report.duplicates} 个`);
  for (const r of report.renamed) console.log(`[hydrus]   已有的 URL class 改名保留：${r}`);
}

function describeLibraryGugs(library: DownloaderLibrary): string {
  return library.gugs.map((g) => `"${g[1]}"`).join("、") || "（库里还没有 GUG）";
}

// ---- 下载 ----

function parseParamOverrides(value: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of Array.isArray(value) ? value : []) {
    const text = String(item).trim();
    const i = text.indexOf("=");
    if (i <= 0) throw new Error(`URL 参数默认值「${text}」不是 参数名=值 的形式`);
    out.set(text.slice(0, i).trim(), text.slice(i + 1).trim());
  }
  return out;
}

function makeDownloader(library: DownloaderLibrary, custom: Record<string, unknown>, describe: Record<string, unknown>) {
  const maxPages = Number(custom.max_pages ?? 1);
  const maxFiles = Number(custom.max_files ?? 20);
  const domains = library.domainManager(parseParamOverrides(custom.url_params));
  return new GalleryDownloader(
    { domains, domainPackages: library.domainPackages() },
    { maxPages, maxFiles },
    {
      fetchText: async (url, headers) => {
        applyTaskHeaders(headers);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}：${url}`);
        return await res.text();
      },
      download: async ({ fileUrl, postUrl, primaryUrls, title, tags, sourceUrls, notes, hashes, sourceTime, timestamps, headers }) => {
        // 逐个 await，保证下载入队时拿到的是这一次的任务头
        applyTaskHeaders(headers);
        await downloadImage(fileUrl, {
          name: title || fileNameOf(fileUrl),
          url: postUrl ?? fileUrl,
          metadata: {
            schema: 1,
            ...describe,
            postUrl,
            primaryUrls,
            fileUrl,
            title,
            tags,
            sourceUrls,
            notes,
            hashes,
            sourceTime,
            timestamps,
          } as KabegameJsonValue,
          searchTexts: tags,
          labels: labelsFromTags(tags),
        });
      },
      log: (m) => console.log(m),
      warn: (m) => warn(m),
      progress: (pct) => addProgress(pct),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
  );
}

/** png 模式：把 png 导入下载器库，再用 GUG 搜索；搜索内容为空时只导入 */
async function runPng(custom: Record<string, unknown>, ctx: LoadContext, dryRun: boolean) {
  const pngPath = String(custom.png ?? "");
  const query = String(custom.query ?? "").trim();
  const gugName = String(custom.gug ?? "").trim();
  if (!pngPath && !gugName) throw new Error("请选择下载器 png，或在「搜索入口（GUG）」填写下载器库里已有的 GUG");

  let pngGugs: HydrusTuple[] = [];
  let library: DownloaderLibrary;
  if (pngPath) {
    const { objects, skipped } = await loadHydrusPng(await Kabegame.fs.readFile(pngPath), { inflate: (b: Uint8Array) => unzlibSync(b), ctx });
    for (const s of skipped) warn(`[hydrus] 跳过暂不支持的对象：${s}`);
    let report: ImportReport | null = null;
    library = await updateLibrary(ctx, dryRun, (lib) => {
      report = lib.importObjects(objects, { ctx });
    });
    logImport(pngPath.split("/").pop()!, report!);
    // png 里的 GUG 在库里对应的那个（可能因重名带了后缀，或是库里本来就有的同一个）
    const fromPng = objects.filter((o) => o[0] === T.GALLERY_URL_GENERATOR || o[0] === T.NESTED_GALLERY_URL_GENERATOR).map((o) => String(o[1]));
    pngGugs = [...new Set(fromPng.map((name) => report!.gugsByOriginalName.get(name)).filter((g): g is HydrusTuple => g !== undefined))];
  } else {
    library = await loadLibrary(ctx);
  }

  if (!query) {
    console.log("[hydrus] 搜索内容为空，只导入下载器");
    return;
  }

  let gug: HydrusTuple | null;
  if (gugName) {
    gug = library.findGug(gugName);
    if (!gug) throw new Error(`下载器库里没有 GUG "${gugName}"，可选：${describeLibraryGugs(library)}`);
  } else if (pngGugs.length === 1) {
    gug = pngGugs[0];
  } else if (pngGugs.length === 0) {
    throw new Error(`这个 png 里没有 GUG，请在「搜索入口（GUG）」填写下载器库里的一个：${describeLibraryGugs(library)}`);
  } else {
    throw new Error(`这个 png 里有多个 GUG，请在「搜索入口（GUG）」填写其中一个：${pngGugs.map((g) => `"${g[1]}"`).join("、")}`);
  }
  const gugs = library.expandGug(gug, (m) => warn(`[hydrus] ${m}`));
  if (gugs.length === 0) throw new Error(`NGUG "${gug[1]}" 引用的 GUG 都不在下载器库里`);
  if (gug[0] === T.NESTED_GALLERY_URL_GENERATOR) console.log(`[hydrus] NGUG "${gug[1]}" 展开为 ${gugs.map((g) => `"${g[1]}"`).join("、")}`);

  await makeDownloader(library, custom, { downloader: String(gug[1]), query }).run(gugs, query);
}

/** 网址模式：用下载器库处理给定的网址，不导入 png */
async function runUrls(custom: Record<string, unknown>, ctx: LoadContext) {
  const urls = (Array.isArray(custom.urls) ? custom.urls : []).map((u) => String(u).trim()).filter((u) => u.length > 1);
  if (urls.length === 0) throw new Error("没有填写网址");
  const library = await loadLibrary(ctx);
  if (library.isEmpty) warn("[hydrus] 下载器库是空的，所有网址都会按文件地址直接下载。可以先用 png 模式导入下载器，或从 hydrus 数据库合并");
  await makeDownloader(library, custom, {}).runUrls(urls);
}

// ---- hydrus 数据库导入 ----

const BATCH_SIZE = 200;

// HydrusConstants.URL_TYPE_*
const URL_TYPE_POST = 0;
const URL_TYPE_FILE = 2;

/** hydrus 的文件夹布局：f + hash 前缀，每两位一层（f00 / f001 → f00/1） */
function subfolderOf(prefix: string): string {
  const parts = prefix.match(/.{1,2}/g) ?? [];
  return [`f${parts[0]}`, ...parts.slice(1)].join("/");
}

/** 标题取 title: 标签 */
function titleOf(tags: string[]): string | null {
  return tags.find((t) => t.startsWith("title:"))?.slice("title:".length) ?? null;
}

async function runHydrusDb(custom: Record<string, unknown>, ctx: LoadContext, dryRun: boolean) {
  const dbDir = String(custom.db_dir ?? "");
  if (!dbDir) throw new Error("请选择 hydrus 的 db 目录（里面有 client.db）");
  const filesDir = String(custom.files_dir ?? "");
  const includeTrash = custom.include_trash === true;
  const importFiles = custom.import_files !== false;
  const mergeDownloaders = custom.merge_downloaders === true;
  const fs = Kabegame.fs as unknown as SyncFs;
  const db = new HydrusDatabase(dbDir, fs);
  try {
    let library: DownloaderLibrary | null = null;
    if (mergeDownloaders) {
      const { objects, skipped, links, skippedHeaders } = db.readDownloaders(ctx);
      for (const s of skipped) warn(`[hydrus] 跳过暂不支持的对象：${s}`);
      for (const h of skippedHeaders) warn(`[hydrus] 凭据类请求头不复制到插件：${h}`);
      let report: ImportReport | null = null;
      library = await updateLibrary(ctx, dryRun, (lib) => {
        report = lib.importObjects(objects, { ctx, links });
      });
      logImport("hydrus 数据库里的下载器", report!);
    }
    if (!importFiles) return;
    library ??= await loadLibrary(ctx);
    const domains = library.isEmpty ? null : library.domainManager();
    await importHydrusFiles(db, { dbDir, filesDir, includeTrash, fs, domains });
  } finally {
    db.close();
  }
}

async function importHydrusFiles(
  db: HydrusDatabase,
  options: { dbDir: string; filesDir: string; includeTrash: boolean; fs: SyncFs; domains: { urlClassFor(url: string): { urlType: number } | null } | null },
) {
  const { dbDir, filesDir, includeTrash, fs, domains } = options;
  const files = db.listFiles({ includeTrash });
  const tagServices = db.tagServices();
  const { prefixes } = db.fileLocations();
  const outside = [...new Set([...prefixes.values()].filter((p) => !p.inMount).map((p) => p.location))];
  console.log(`[hydrus] ${files.length} 个文件，标签服务：${tagServices.map((s) => s.name).join("、") || "无"}`);
  if (outside.length > 0) {
    if (filesDir) console.log(`[hydrus] 文件位置 ${outside.join("、")} 不在 db 目录下，改从「文件目录」读取`);
    else warn(`[hydrus] 文件位置 ${outside.join("、")} 不在 db 目录下，请在「文件目录」选择它（里面是 f00、f01 等文件夹），否则这部分文件会找不到`);
  }

  // 每个前缀目录只检查一次是否可访问
  const dirOk = new Map<string, boolean>();
  const exists = (dir: string) => {
    let ok = dirOk.get(dir);
    if (ok === undefined) {
      try {
        fs.statSync(dir);
        ok = true;
      } catch {
        ok = false;
      }
      dirOk.set(dir, ok);
    }
    return ok;
  };
  const pathOf = (hash: string, ext: string): string | null => {
    const prefix = [...prefixes.keys()].filter((p) => hash.startsWith(p)).sort((a, b) => b.length - a.length)[0];
    if (prefix === undefined) return null;
    const { location, inMount } = prefixes.get(prefix)!;
    const sub = subfolderOf(prefix);
    const bases = [...(inMount ? [`${dbDir}/${location}`] : []), ...(filesDir ? [filesDir] : [])];
    const dir = bases.map((b) => `${b}/${sub}`).find(exists);
    return dir ? `${dir}/${hash}${ext}` : null;
  };

  let imported = 0;
  let unsupported = 0;
  let missing = 0;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    // 一批先在同一个快照里读完，再逐个入库
    const records = db.consistent(() => batch.map((f) => ({ file: f, record: db.readFile(f.hashId, tagServices) })));
    for (const { file, record } of records) {
      addProgress(100 / files.length);
      if (!record) continue;
      if (!record.ext) {
        unsupported++;
        continue;
      }
      const path = pathOf(record.hash, record.ext);
      if (!path) {
        if (missing++ < 5) warn(`[hydrus] 找不到文件 ${record.hash}${record.ext}`);
        continue;
      }
      await importOne(path, file, record, domains);
      imported++;
    }
  }
  console.log(`[hydrus] 完成：入库 ${imported} 个，不是图片或视频而跳过 ${unsupported} 个，找不到文件 ${missing} 个`);
}

async function importOne(
  path: string,
  file: { importedMs: number | null; trashed: boolean },
  r: HydrusFileRecord,
  domains: { urlClassFor(url: string): { urlType: number } | null } | null,
) {
  const sec = (ms: number | null) => (ms === null ? null : Math.floor(ms / 1000));
  const sourceTimes = r.domainModified.map((d) => d.ms);
  // 详情页、文件地址：先按下载器库的 URL class 认，认不出时按扩展名猜
  const looksLikeFile = (u: string) => /\.[a-z0-9]{2,5}$/i.test(fileNameOf(u));
  const urlType = (u: string) => domains?.urlClassFor(u)?.urlType ?? (looksLikeFile(u) ? URL_TYPE_FILE : URL_TYPE_POST);
  const postUrl = r.urls.find((u) => urlType(u) === URL_TYPE_POST) ?? null;
  const fileUrl = r.urls.find((u) => urlType(u) === URL_TYPE_FILE) ?? null;
  const title = titleOf(r.tags);
  await downloadImage(path, {
    name: title || (fileUrl && fileNameOf(fileUrl)) || null,
    url: postUrl,
    metadata: {
      schema: 1,
      source: "hydrus_db",
      hash: r.hash,
      postUrl,
      title,
      tags: r.tags,
      urls: r.urls,
      notes: r.notes,
      sourceTime: sourceTimes.length > 0 ? sec(Math.min(...sourceTimes)) : null,
      importedTime: sec(file.importedMs),
      modifiedTime: sec(r.modifiedMs),
      archivedTime: sec(r.archivedMs),
      inbox: r.inbox,
      trashed: file.trashed,
      domainModified: r.domainModified.map((d) => ({ domain: d.domain, time: sec(d.ms) })),
      width: r.width,
      height: r.height,
      duration: r.duration,
      size: r.size,
    } as KabegameJsonValue,
    searchTexts: r.tags,
    labels: labelsFromTags(r.tags),
  });
}

export async function crawl(common: { isDryRun?: boolean }, custom: Record<string, unknown>) {
  const ctx: LoadContext = { ...defaultContext(), warn: (m: string) => warn(`[hydrus] ${m}`) };
  const dryRun = common?.isDryRun === true;
  const mode = String(custom.mode ?? "png");
  if (mode === "png") await runPng(custom, ctx, dryRun);
  else if (mode === "url") await runUrls(custom, ctx);
  else if (mode === "hydrus_db") await runHydrusDb(custom, ctx, dryRun);
  else throw new Error(`未知的模式 ${mode}`);
}

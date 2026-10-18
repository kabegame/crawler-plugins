// Kabegame 服务器 V8 爬虫：经另一个 Kabegame 的 Web 服务（Web 版 / 桌面端 Web 服务器）的
// JSON-RPC `POST /rpc` 复制图片。两种模式都是「一条 images:// 路径 + 分页尾」：
//   - 全站：`gallery/[hide/]sort/<by-id | by-time/<倒序> | random-<种子>>`，种子每次运行生成；
//   - 过滤：用户粘贴「高级查询」弹窗的路径，剥掉末尾分页、保留排序。
// 服务器 4.5.1 起画廊续接段改名（`_kb_fc` / `_kb_desc` / `_kb_x<N>x`），旧写法不再识别；
// 运行前先探测服务器方言，路径一律按探测结果拼。
// 图片字节、元数据、标签、帖子地址都从服务器原样搬过来：
//   - 媒体：Web 版的 local_path 已是 CDN 直链；桌面 Web 服务器返回本地路径，经同端口 `/file/{*path}` 读取；
//   - 元数据：`get_image_metadata_full`，按服务器 metadata 行共用一行本地 metadata（多图帖子不重复存）；
//   - 标签：`albums://of_image_<id>/album_kind/label` 的 label_path 原样拆成 category + key；
//   - 帖子地址：服务器的 post_url，没有就留空，不填服务器自己的地址。
// 详情模板执行来源插件自己的 description.ejs：模板文本与该插件的 plugin_data 由这里抓下来存进
// 本插件的 plugin_data，templates/description.src.ejs 在 iframe 里读出后用同版本 ejs 渲染。

import { t } from "./i18n";

const { addProgress, downloadImage, createImageMetadata, warn, pluginData, setPluginData } = Kabegame;

const DEFAULT_SERVER = "https://demo.kabegame.com";
const MAX_PAGE_SIZE = 100;
// 一次运行最多翻的页数（与 konachan 的 100 页限制同理：超出直接拒绝，不静默截断）
const MAX_PAGES_PER_RUN = 10;
// 单张图的标签一次取完（标签画册不分页翻）
const LABEL_PAGE_SIZE = 1000;
// 逐图的元数据 / 标签 RPC 并发数：100 张一页时串行要几十秒。
const RPC_CONCURRENCY = 8;
const METADATA_SCHEMA = 1;

// ---- 类型 ----
// 服务器 JSON-RPC 返回的图片行：字段都可能缺失，只在真正依赖处收窄。
// 输出侧（plugin_data / metadata）必须保持 JSON 可序列化，所以全部用 type 而非 interface。
type ServerImage = {
  id?: number | string | null;
  local_path?: string | null;
  url?: string | null;
  display_name?: string | null;
  post_url?: string | null;
  plugin_id?: string | null;
  plugin_version?: number | string | null;
  surf_record_id?: number | string | null;
  metadata_id?: number | string | null;
};

// albums://…/album_kind/label 返回的画册行，只有标签画册带 label_path / label_key。
type ServerAlbum = {
  type?: string | null;
  label_path?: string | null;
  label_key?: string | null;
  name?: string | null;
};

type PluginDetail = {
  name?: string | null;
  version?: string | null;
  descriptionTemplate?: unknown;
};

type RpcErrorPayload = {
  code?: number | string | null;
  message?: string | null;
};

type RpcEnvelope<T> = {
  error?: RpcErrorPayload | null;
  result?: T;
};

type EntrypointResult = {
  total?: unknown;
};

type MetadataFullResult = {
  data?: KabegameJsonValue;
  pluginVersion?: unknown;
};

type ImageMetadataRow = {
  schema: number;
  server: string;
  source: {
    pluginId: string | null;
    pluginVersion: number | null;
    surfRecordId: number | string | null;
    metadataId: number | string | null;
  };
  metadata: KabegameJsonValue;
};

// 配置字段来自 GUI（可能有类型）或 CLI --var（一定是字符串），统一按 unknown 收窄
type ServerVars = {
  mode?: unknown;
  server_url?: unknown;
  pathql?: unknown;
  sort?: unknown;
  include_hidden?: unknown;
  page_size?: unknown;
  start_page?: unknown;
  end_page?: unknown;
};

// 服务器方言：labelKey 是 i18n 键（保留字面量，便于 t() 校验）
type Dialect = {
  labelKey: "dialectKb" | "dialectLegacy";
  fc: string;
  desc: string;
  page: (size: number, page: number) => string;
};

// [kabegame-server] 前缀写在 i18n 文案里，这里只做直通，不再拼接。
function log(message: string): void {
  console.log(message);
}

// 保持原来 `e?.message ?? String(e)` 的字符串回退语义
function errText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const message = (e as { message?: unknown }).message;
    if (message != null) return String(message);
  }
  return String(e);
}

// 允许带路径前缀（反向代理挂在子路径下）；缺协议时按 https 补全。
function normalizeServer(raw: unknown): string {
  let s = String(raw ?? "").trim() || DEFAULT_SERVER;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

// 服务器画廊续接段的两种方言：4.5.1 起全局化为 `_kb_*`，之前是裸段名。
const DIALECTS: { kb: Dialect; legacy: Dialect } = {
  kb: { labelKey: "dialectKb", fc: "_kb_fc", desc: "_kb_desc", page: (n, p) => `_kb_x${n}x/${p}` },
  legacy: { labelKey: "dialectLegacy", fc: "filter_comb", desc: "desc", page: (n, p) => `x${n}x/${p}` },
};

// 各取一张图试两种分页尾；先试新语法。两种都失败时把两条错误一起报出来。
async function detectDialect(server: string): Promise<Dialect> {
  const errors: string[] = [];
  for (const d of [DIALECTS.kb, DIALECTS.legacy]) {
    try {
      await rpc(server, "pathql_fetch", { path: `images://gallery/all/${d.page(1, 1)}` });
      return d;
    } catch (e) {
      errors.push(t("probeFailed", { dialect: t(d.labelKey), error: errText(e) }));
    }
  }
  throw new Error(t("dialectUnknown", { errors: errors.join("；") }));
}

// 全站模式的排序段。随机种子每次运行生成一次，同一次运行的各页共用同一个排列，翻页不重复；
// 服务器的 random-<seed> 只接受 1–18 位数字。
function siteSortSegment(sort: unknown, dialect: Dialect): string {
  if (sort === "time") return `sort/by-time/${dialect.desc}`;
  if (sort === "id") return "sort/by-id";
  // 默认随机
  return `sort/random-${1 + Math.floor(Math.random() * 1e15)}`;
}

// 过滤模式：接受「高级查询」弹窗里复制的路径（`images://gallery/…/sort/by-time/_kb_desc/_kb_x100x/2`，
// 旧版服务器是 `…/sort/by-time/desc/x100x/2`）。只剥末尾分页 `[(_kb_)x<N>x/]<页码>`，排序与倒序
// 原样保留；省略 scheme 时按画廊路径补全。
function normalizeFilterPath(raw: unknown): string {
  let s = String(raw ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!s) throw new Error(t("filterPathRequired"));
  if (!s.includes("://")) s = `images://gallery/${s.replace(/^\/+/, "")}`;
  if (!s.startsWith("images://")) throw new Error(t("filterPathInvalid", { path: s }));
  const segs = s.slice("images://".length).split("/").filter(Boolean);
  if (segs.length > 1 && /^[1-9][0-9]*$/.test(segs[segs.length - 1])) {
    segs.pop();
    if (segs.length > 1 && /^(_kb_)?x[1-9][0-9]*x$/.test(segs[segs.length - 1])) segs.pop();
  }
  // 只剩根节点时取全部，根节点本身不能分页
  if (segs.length === 1) segs.push("all");
  return `images://${segs.join("/")}`;
}

// 把另一方言的组合 / 倒序段改写成服务器方言：粘贴的路径可能来自另一版本的服务器。
// 只作为原样路径解析失败后的候选，避免把恰好叫 `desc` 的搜索词误改。
function translateFilterPath(path: string, dialect: Dialect): string {
  const other = dialect === DIALECTS.kb ? DIALECTS.legacy : DIALECTS.kb;
  const segs = path.slice("images://".length).split("/");
  const out = segs.map((seg) => (seg === other.fc ? dialect.fc : seg === other.desc ? dialect.desc : seg));
  return `images://${out.join("/")}`;
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  // 清空的数字字段收到 null；Number(null) === 0 会被夹到下限（如每页 1 张），先按未填写回落
  if (v == null || v === "") return def;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

let rpcSeq = 0;

async function rpc<T = unknown>(
  server: string,
  method: string,
  params: Record<string, KabegameJsonValue> = {},
): Promise<T | undefined> {
  const res = await fetch(`${server}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcSeq, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = (await res.json()) as RpcEnvelope<T>;
  if (body?.error) throw new Error(`${method}: ${body.error.message ?? "error"} (${body.error.code})`);
  return body?.result;
}

// 固定并发地依次处理 items，单项失败由 worker 自己兜住。
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void> | void,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

function mediaUrl(server: string, image: ServerImage): string {
  const p = String(image.local_path ?? "").trim();
  if (/^https?:\/\//i.test(p)) return p;
  if (p) {
    const encoded = p.split("/").map(encodeURIComponent).join("/").replace(/^\/+/, "");
    return `${server}/file/${encoded}`;
  }
  // 服务器没有本地文件（理论上不会出现）时退回原始下载地址
  return String(image.url ?? "").trim();
}

// label_path 形如 `konachan/character/hayase_yuuka`：末段是 key，其余是 category。
function labelsFromAlbums(rows: ServerAlbum[] | null | undefined): KabegameLabelInput[] {
  const labels: KabegameLabelInput[] = [];
  for (const a of rows || []) {
    if (a?.type !== "label") continue;
    const path = String(a.label_path ?? "").trim();
    const segs = path.split("/").filter(Boolean);
    const key = String(a.label_key ?? segs[segs.length - 1] ?? "").trim();
    if (!key) continue;
    const category = segs.length > 1 ? segs.slice(0, -1).join("/") : undefined;
    labels.push({ key, category, name: a.name || key });
  }
  return labels;
}

// ── 来源插件的模板与 plugin_data ────────────────────────────────────────────

// plugin_data 结构：{ schema, servers: { [server]: { plugins: { [pluginId]: Entry } } } }
// Entry = { name, version, template, data, updatedAt }；template 为 null 表示服务器上没有模板。
type SourceEntry = {
  name: string | null;
  version: string | null;
  template: string | null;
  data: KabegameJsonValue;
  updatedAt: number;
};

type SourceServerEntry = {
  plugins: Record<string, SourceEntry>;
};

type SourceStore = {
  schema?: number;
  servers?: Record<string, SourceServerEntry>;
};

function createSourceCache(server: string) {
  const store: SourceStore = pluginData<SourceStore>() || {};
  if (!store.servers || typeof store.servers !== "object") store.servers = {};
  const serverEntry = (store.servers[server] ||= { plugins: {} });
  serverEntry.plugins ||= {};
  store.schema = 1;
  const refreshed = new Map<string, Promise<void>>(); // 本次任务已刷新过的插件 → Promise

  async function fetchEntry(pluginId: string): Promise<void> {
    const entry: SourceEntry = {
      name: null,
      version: null,
      template: null,
      data: null,
      updatedAt: Date.now(),
    };
    try {
      const detail = await rpc<PluginDetail>(server, "get_plugin_detail", { pluginId });
      entry.name = detail?.name ?? null;
      entry.version = detail?.version ?? null;
      entry.template = typeof detail?.descriptionTemplate === "string" ? detail.descriptionTemplate : null;
    } catch (e) {
      // 内建插件（local-import / webpage）或服务器已卸载的插件没有详情，按无模板处理
      log(t("pluginDetailMissing", { plugin: pluginId, error: errText(e) }));
    }
    try {
      const data = await rpc<unknown>(server, "get_plugin_data", { pluginId });
      entry.data =
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as { [key: string]: KabegameJsonValue })
          : {};
    } catch (e) {
      warn(t("pluginDataReadFailed", { plugin: pluginId, error: errText(e) }));
      entry.data = serverEntry.plugins[pluginId]?.data ?? {};
    }
    serverEntry.plugins[pluginId] = entry;
    setPluginData(store);
    log(
      t("pluginCached", {
        plugin: pluginId,
        version: entry.version ?? "?",
        template: entry.template ? t("templateChars", { length: entry.template.length }) : t("templateNone"),
      }),
    );
  }

  return {
    ensure(pluginId: string | null | undefined): Promise<void> {
      if (!pluginId) return Promise.resolve();
      let pending = refreshed.get(pluginId);
      if (!pending) {
        pending = fetchEntry(pluginId);
        refreshed.set(pluginId, pending);
      }
      return pending;
    },
  };
}

// ── 元数据 ──────────────────────────────────────────────────────────────────

function createMetadataCache(server: string) {
  const byKey = new Map<string, Promise<number>>(); // 服务器 metadata 行 / 无元数据的插件 → Promise<本地 metadata id>

  async function build(image: ServerImage): Promise<number> {
    let data: KabegameJsonValue = null;
    let pluginVersion: number | null = typeof image.plugin_version === "number" ? image.plugin_version : null;
    if (image.metadata_id != null) {
      const full = await rpc<MetadataFullResult>(server, "get_image_metadata_full", { imageId: String(image.id) });
      data = full?.data ?? null;
      if (typeof full?.pluginVersion === "number") pluginVersion = full.pluginVersion;
    }
    const metadata: ImageMetadataRow = {
      schema: METADATA_SCHEMA,
      server,
      source: {
        pluginId: image.plugin_id ?? null,
        pluginVersion,
        surfRecordId: image.surf_record_id ?? null,
        metadataId: image.metadata_id ?? null,
      },
      metadata: data,
    };
    return Number(createImageMetadata(metadata));
  }

  return {
    get(image: ServerImage): Promise<number> {
      const key =
        image.metadata_id != null
          ? `m:${image.metadata_id}`
          : `p:${image.plugin_id ?? ""}:${image.surf_record_id ?? ""}:${image.plugin_version ?? ""}`;
      let pending = byKey.get(key);
      if (!pending) {
        pending = build(image);
        // 失败不缓存，下一张同 metadata 的图会重试
        pending.catch(() => byKey.delete(key));
        byKey.set(key, pending);
      }
      return pending;
    },
  };
}

// ── 入口 ────────────────────────────────────────────────────────────────────

export async function crawl(
  common: unknown,
  custom: Record<string, unknown> | null | undefined,
): Promise<void> {
  const vars = (custom || {}) as ServerVars;
  const cfg = (common || {}) as { baseUrl?: unknown };
  const serverInput = vars.server_url ? vars.server_url : cfg.baseUrl;
  const server = normalizeServer(serverInput);
  const pageSize = clampInt(vars.page_size, 20, 1, MAX_PAGE_SIZE);
  const startPage = clampInt(vars.start_page, 1, 1, Number.MAX_SAFE_INTEGER);
  const endPage = Math.max(startPage, clampInt(vars.end_page, startPage, 1, Number.MAX_SAFE_INTEGER));
  if (endPage - startPage + 1 > MAX_PAGES_PER_RUN) {
    throw new Error(t("tooManyPages", { max: MAX_PAGES_PER_RUN, startPage, endPage }));
  }
  // 先连通性检查，再探测语法、取总数：分开做，过滤路径写错时不会被误报成连不上服务器
  try {
    await rpc(server, "pathql_entry", { path: "images://gallery" });
  } catch (e) {
    throw new Error(t("serverUnreachable", { server, error: errText(e) }));
  }
  const dialect = await detectDialect(server);

  const filterMode = vars.mode === "filter";
  let candidates: string[];
  if (filterMode) {
    const raw = normalizeFilterPath(vars.pathql);
    candidates = [...new Set([raw, translateFilterPath(raw, dialect)])];
  } else {
    const includeHidden = vars.include_hidden === true;
    candidates = [`images://gallery/${includeHidden ? "" : "hide/"}${siteSortSegment(vars.sort, dialect)}`];
  }

  let basePath: string | null = null;
  let total: number | null = null;
  let firstError: unknown = null;
  for (const path of candidates) {
    try {
      const entry = await rpc<EntrypointResult>(server, "pathql_entry", { path });
      basePath = path;
      total = typeof entry?.total === "number" ? entry.total : null;
      break;
    } catch (e) {
      firstError ??= e;
    }
  }
  if (basePath == null) {
    throw new Error(t("queryNotResolved", { path: candidates[0], error: errText(firstError) }));
  }
  log(
    t("crawlStart", {
      server,
      dialect: t(dialect.labelKey),
      scope: t(filterMode ? "scopeFilter" : "scopeAll"),
      path: basePath,
      pageSize,
      startPage,
      endPage,
      hidden: filterMode ? "" : t(vars.include_hidden === true ? "hiddenIncluded" : "hiddenSkipped"),
    }),
  );
  const lastPage = total == null ? endPage : Math.max(1, Math.ceil(total / pageSize));
  const finalPage = Math.min(endPage, lastPage);
  log(t("serverTotal", { total: total ?? "?", lastPage }));
  if (startPage > finalPage) {
    warn(t("startPageBeyond", { startPage, lastPage }));
    addProgress(100);
    return;
  }

  const sources = createSourceCache(server);
  const metadataCache = createMetadataCache(server);
  const perPage = 100 / (finalPage - startPage + 1);

  for (let page = startPage; page <= finalPage; page++) {
    let raw: ServerImage[] | undefined;
    try {
      raw = await rpc<ServerImage[]>(server, "pathql_fetch", { path: `${basePath}/${dialect.page(pageSize, page)}` });
    } catch (e) {
      warn(t("pageReadFailed", { page, error: errText(e) }));
      addProgress(perPage);
      continue;
    }
    const rows = Array.isArray(raw) ? raw : [];
    log(
      t("pageFetched", {
        page,
        count: rows.length,
        first: rows[0]?.id ?? "-",
        last: rows[rows.length - 1]?.id ?? "-",
      }),
    );
    if (rows.length === 0) {
      addProgress(perPage * (finalPage - page + 1));
      break;
    }

    const perImage = perPage / rows.length;
    let ok = 0;
    await runPool(rows, RPC_CONCURRENCY, async (image) => {
      try {
        const [metadataId, albums] = await Promise.all([
          metadataCache.get(image),
          rpc<ServerAlbum[]>(server, "pathql_fetch", {
            path: `albums://of_image_${encodeURIComponent(String(image.id))}/album_kind/label/x${LABEL_PAGE_SIZE}x/1`,
          }),
          sources.ensure(image.plugin_id),
        ]);
        const url = mediaUrl(server, image);
        if (!url) throw new Error(t("noDownloadUrl"));
        const postUrl = String(image.post_url ?? "").trim();
        const opts: KabegameDownloadImageOptions = {
          name: image.display_name || null,
          url: postUrl || null,
          metadata_id: metadataId,
          labels: labelsFromAlbums(albums),
        };
        await downloadImage(url, opts);
        ok++;
      } catch (e) {
        warn(t("imageFailed", { id: image.id, error: errText(e) }));
      }
      addProgress(perImage);
    });
    log(t("pageDone", { page, ok, count: rows.length }));
  }
}

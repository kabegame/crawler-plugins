// 跨模块共享的类型：配置、WBI 键、列表条目、DASH 流与 metadata 片段。
//
// 站点 JSON 与 metadata 一律用 type 而非 interface：这些对象最终要赋给
// `KabegameJsonValue`，interface 没有隐式索引签名会报 TS2322。

/** 插件配置。GUI 可能带类型，CLI `--var` 一定是字符串，统一按 unknown 收窄。 */
export type BilibiliVars = {
  mode?: unknown;
  video?: unknown;
  interval?: unknown;
  retries?: unknown;
  list_url?: unknown;
  mid?: unknown;
  order?: unknown;
  start_page?: unknown;
  end_page?: unknown;
  max_videos?: unknown;
  keyword?: unknown;
  search_order?: unknown;
  duration?: unknown;
  bangumi_url?: unknown;
  ep_start?: unknown;
  page_index?: unknown;
  max_quality?: unknown;
  prefer_avc?: unknown;
};

/** WBI 签名键（img / sub）与登录态；index.ts 把 getWbiKeys 的结果并成这一层。 */
export type WbiKeysState = {
  img: string;
  sub: string;
  isLoggedIn: boolean;
};

/** 列表 / 搜索 / 投稿模式产出的待下载条目。 */
export type ListEntry = {
  bvid: string;
  title: string;
};

/** 单视频的 BV / av 标识（两者可能只有其一；列表条目只带 bvid）。 */
export type VideoRef = {
  bvid: string;
  aid?: string;
};

/** 带 noRetry / skipEpisode 标记的错误（运行时给 Error 实例追加字段）。 */
export type TaggedError = Error & {
  noRetry?: boolean;
  skipEpisode?: boolean;
};

/** DASH 单条流；字段名同时兼容接口的驼峰与下划线两种形态。 */
export type DashStream = {
  id?: number | null;
  baseUrl?: string | null;
  base_url?: string | null;
  backupUrl?: string[] | null;
  backup_url?: string[] | null;
  bandwidth?: number | null;
  codecs?: string | null;
  width?: number | null;
  height?: number | null;
  frameRate?: string | number | null;
  frame_rate?: string | number | null;
  size?: number | null;
  mimeType?: string | null;
  mime_type?: string | null;
};

/** playurl 返回的 dash 对象。 */
export type Dash = {
  video?: DashStream[] | null;
  audio?: DashStream[] | null;
};

/** support_formats 条目（质量 id → 可读名）。 */
export type SupportFormat = {
  quality?: number | null;
  new_description?: string | null;
  display_desc?: string | null;
};

/** 含 support_formats 的对象：UGC 是 play.data，番剧是 video_info。 */
export type PlayDataWithFormats = {
  support_formats?: SupportFormat[] | null;
};

/** metadata 的 format 段（UGC 与番剧共用）。 */
export type FormatMetadata = {
  quality: number;
  quality_label: string;
  codecs: string;
  width: number;
  height: number;
  frame_rate: string;
  audio_codecs: string;
};

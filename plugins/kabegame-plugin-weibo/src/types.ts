// 微博站点 JSON 与 metadata 的结构模型。
// 全部用 type 别名：interface 没有隐式索引签名，最终赋给 KabegameJsonValue 时会报 TS2322。
// 字段都是可选的——站点各接口（statuses/show、mymblog、超话 feed、评论）返回的是同一 mblog 的不同子集。

export type WeiboJsonValue =
  | string
  | number
  | boolean
  | null
  | WeiboJsonValue[]
  | { [key: string]: WeiboJsonValue };

export type WeiboJsonObject = { [key: string]: WeiboJsonValue };

export type WeiboUser = {
  id?: number | string | null;
  idstr?: string | null;
  screen_name?: string | null;
  avatar_hd?: string | null;
  avatar_large?: string | null;
  profile_image_url?: string | null;
  verified?: boolean | null;
  verified_type?: number | null;
  statuses_count?: number | null;
};

/** 图片尺寸/地址的三种形态（largest / original / mw2000）。 */
export type WeiboPicSize = {
  url?: string | null;
  width?: number | string | null;
  height?: number | string | null;
};

export type WeiboPicInfo = {
  pic_id?: string | null;
  type?: string | null;
  video?: string | null;
  largest?: WeiboPicSize | null;
  original?: WeiboPicSize | null;
  mw2000?: WeiboPicSize | null;
};

export type WeiboMixMediaItem = {
  id?: number | string | null;
  type?: string | null;
  data?: WeiboPicInfo | null;
};

export type WeiboUrlStructItem = {
  page_id?: string | number | null;
  url_title?: string | null;
};

export type WeiboTopicStructItem = {
  topic_title?: string | null;
};

export type WeiboCommentPicInfo = {
  woriginal?: WeiboPicSize | null;
  large?: WeiboPicSize | null;
};

export type WeiboCommentUrlStructItem = {
  pic_ids?: string[] | null;
  pic_infos?: Record<string, WeiboCommentPicInfo> | null;
};

export type WeiboComment = {
  id?: number | string | null;
  idstr?: string | null;
  floor_number?: number | null;
  user?: WeiboUser | null;
  text_raw?: string | null;
  created_at?: string | null;
  source?: string | null;
  like_counts?: number | null;
  like_count?: number | null;
  pic_num?: number | null;
  url_struct?: WeiboCommentUrlStructItem[] | null;
  total_number?: number | null;
  comments?: WeiboComment[] | null;
};

export type WeiboMblog = {
  ok?: number | null;
  message?: string | null;
  msg?: string | null;
  id?: number | string | null;
  idstr?: string | null;
  mblogid?: string | null;
  user?: WeiboUser | null;
  retweeted_status?: WeiboMblog | null;
  pic_infos?: Record<string, WeiboPicInfo> | null;
  pic_ids?: string[] | null;
  mix_media_info?: { items?: WeiboMixMediaItem[] | null } | null;
  text?: string | null;
  text_raw?: string | null;
  isLongText?: boolean | null;
  created_at?: string | null;
  region_name?: string | null;
  source?: string | null;
  reposts_count?: number | null;
  comments_count?: number | null;
  attitudes_count?: number | null;
  url_struct?: WeiboUrlStructItem[] | null;
  topic_struct?: WeiboTopicStructItem[] | null;
};

export type WeiboProfileResponse = {
  ok?: number | null;
  msg?: string | null;
  data?: { user?: WeiboUser | null } | null;
};

export type WeiboImageWallItem = {
  mid?: number | string | null;
};

export type WeiboImageWallResponse = {
  ok?: number | null;
  msg?: string | null;
  data?: {
    list?: WeiboImageWallItem[] | null;
    since_id?: number | string | null;
  } | null;
};

export type WeiboTimelineResponse = {
  ok?: number | null;
  msg?: string | null;
  data?: { list?: WeiboMblog[] | null } | null;
};

export type WeiboSupertopicItem = {
  category?: string | null;
  data?: WeiboMblog | null;
};

export type WeiboSupertopicChannel = {
  title?: string | null;
  flowId?: number | string | null;
};

export type WeiboSupertopicResponse = {
  items?: WeiboSupertopicItem[] | null;
  channelInfo?: { channels?: WeiboSupertopicChannel[] | null } | null;
  header?: { data?: { nick?: string | null } | null } | null;
  moreInfo?: { params?: Record<string, unknown> | null } | null;
  msg?: string | null;
};

export type WeiboLongTextResponse = {
  data?: { longTextContent?: string | null } | null;
};

export type WeiboCommentsResponse = {
  data?: WeiboComment[] | null;
  max_id?: number | string | null;
};

/** 用户输入解析结果；三类输入的键互斥。 */
export type WeiboUserInput = { uid: string } | { custom: string } | { screenName: string };

export type WeiboSlimUser = {
  id: string;
  name: string;
  avatar: string;
  verified?: boolean;
  verified_type?: number;
};

export type WeiboPic = {
  pid: string;
  type: string;
  url: string;
  width: number;
  height: number;
  liveUrl: string;
};

export type WeiboCommentPic = {
  pid: string;
  url: string;
  width: number;
  height: number;
};

export type WeiboMetadataPic = {
  pid: string;
  type: string;
  width: number;
  height: number;
};

export type WeiboSuperTopic = {
  id: string;
  name: string;
};

export type WeiboCommentBase = {
  id: string;
  floor: number;
  user: WeiboSlimUser;
  text: string;
  created_at: string;
  region: string;
  likes: number;
  pics: WeiboCommentPic[];
};

export type WeiboCommentSummary = WeiboCommentBase & {
  reply_count: number;
  // 楼中楼预览只保留基础字段（与运行时拼装一致，不再递归带回复）
  replies: WeiboCommentBase[];
};

export type WeiboMetadata = {
  schema: number;
  source: string;
  mid: string;
  mblogid: string;
  url: string;
  created_at: string;
  text: string;
  region: string;
  app_source: string;
  user: WeiboSlimUser;
  counts: {
    reposts: number;
    comments: number;
    likes: number;
  };
  topics: string[];
  super_topics: WeiboSuperTopic[];
  pics: WeiboMetadataPic[];
  comments: WeiboCommentSummary[];
  retweeted_by?: WeiboSlimUser;
};

/** 各模式产出的单条微博；转发模式额外带上转发者。 */
export type WeiboSourceItem = {
  mblog: WeiboMblog | null | undefined;
  retweetedBy?: WeiboUser | null;
};

export type WeiboSource = AsyncGenerator<WeiboSourceItem, void, unknown>;

/** processPost 的运行时选项（由入口从配置归一而来）。 */
export type WeiboPostOptions = {
  livePhoto: boolean;
  maxComments: number;
  commentImages: boolean;
};

// PixAI 站点 JSON 与配置的最小结构。
//
// 这些对象最终要么作为 metadata 交给 Kabegame.createImageMetadata / downloadImage，
// 要么写进 plugin_data，两者都要求 KabegameJsonValue，所以一律用 type 而不是 interface：
// interface 没有隐式索引签名，赋给 KabegameJsonValue 会报 TS2322。
// 字段全部可选：GraphQL 返回哪些字段取决于查询与站点版本，只在确实依赖处收窄。

/** 作品 media.urls 的一项（variant 为 PUBLIC 时可用于直接下载）。 */
export type PixaiUrlVariant = {
  variant?: string | null;
  url?: string | null;
};

/** 作品的媒体对象（列表与详情共用的子集）。 */
export type PixaiMedia = {
  id?: string | null;
  type?: string | null;
  width?: number | null;
  height?: number | null;
  imageType?: string | null;
  urls?: PixaiUrlVariant[] | null;
};

/** tack（站点标签）的多语言词条。 */
export type PixaiTackTerm = {
  id?: string | null;
  tackId?: string | null;
  category?: string | null;
  name?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

/** getTack 返回的标签对象；也用于 plugin_data 里的 id / codeName 双索引缓存。 */
export type PixaiTack = {
  id?: string | null;
  parentId?: string | null;
  codeName?: string | null;
  category?: string | null;
  defaultName?: string | null;
  displayName?: string | null;
  weight?: number | null;
  mediaId?: string | null;
  safetyScore?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  tackTerms?: PixaiTackTerm[] | null;
};

/** 作者与评论者共用的用户对象。 */
export type PixaiAuthor = {
  id?: string | null;
  username?: string | null;
  displayName?: string | null;
  avatarMediaId?: string | null;
  avatarSmallThumbnailMediaUrl?: string | null;
  accountType?: string | null;
};

/** 作品详情的 extra（站点里是 JSON 标量），搜索片段只用其中三个提示词字段。 */
export type PixaiExtra = {
  description?: string | null;
  naturalPrompts?: string | null;
  referenceImagePrompts?: string | null;
};

/** listMessages 的评论节点。 */
export type PixaiComment = {
  id?: string | null;
  type?: string | null;
  content?: string | null;
  createdAt?: string | null;
  author?: PixaiAuthor | null;
};

/** listArtworks 的列表节点：只有标题与媒体 id，其余信息要另查详情。 */
export type PixaiArtworkNode = {
  id?: string | null;
  title?: string | null;
  mediaId?: string | null;
  videoMediaId?: string | null;
  media?: PixaiMedia | null;
};

/**
 * getArtworkWithTaskDetail 的详情对象。
 * download.ts 会在补齐阶段写回 comments 与 title，所以这两个字段是可写的可选项。
 */
export type PixaiArtworkDetail = {
  id?: string | null;
  title?: string | null;
  authorId?: string | null;
  prompts?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  mediaId?: string | null;
  videoMediaId?: string | null;
  likedCount?: number | null;
  commentCount?: number | null;
  extra?: PixaiExtra | null;
  media?: PixaiMedia | null;
  author?: PixaiAuthor | null;
  tacks?: PixaiTack[] | null;
  comments?: PixaiComment[] | null;
};

/** createImageMetadata 的入参：整份作品详情挂在 v2 下（metadata_migrations 依赖该形状）。 */
export type PixaiMetadataV2 = {
  v2: PixaiArtworkDetail;
};

/** listGenerationModels 的模型节点。 */
export type PixaiModelNode = {
  id?: string | null;
  title?: string | null;
};

/** GraphQL 游标分页信息。 */
export type PixaiPageInfo = {
  hasNextPage?: boolean | null;
  hasPreviousPage?: boolean | null;
  endCursor?: string | null;
  startCursor?: string | null;
};

export type PixaiArtworkEdge = {
  node?: PixaiArtworkNode | null;
};

export type PixaiModelEdge = {
  node?: PixaiModelNode | null;
};

export type PixaiMessageEdge = {
  node?: PixaiComment | null;
};

export type ListArtworksResponse = {
  data?: {
    artworks?: {
      edges?: PixaiArtworkEdge[] | null;
      pageInfo?: PixaiPageInfo | null;
    } | null;
  } | null;
};

export type ListGenerationModelsResponse = {
  data?: {
    generationModels?: {
      edges?: PixaiModelEdge[] | null;
      pageInfo?: PixaiPageInfo | null;
    } | null;
  } | null;
};

export type GetTackResponse = {
  data?: {
    tack?: PixaiTack | null;
  } | null;
};

export type GetArtworkDetailResponse = {
  data?: {
    artwork?: PixaiArtworkDetail | null;
  } | null;
};

export type ListMessagesResponse = {
  data?: {
    messages?: {
      edges?: PixaiMessageEdge[] | null;
    } | null;
  } | null;
};

/** listArtworks 的 id 过滤键：标签用 tackId，模型（LoRA）用 loraId。 */
export type PixaiArtworkQueryKey = "tackId" | "loraId";

/** listArtworks 的 GraphQL 变量。 */
export type PixaiArtworkVariables = {
  isSafeSearch?: boolean;
  tackId?: string;
  loraId?: string;
  authorId?: string;
  types?: string[];
  rankMediaType?: string;
  isNsfw?: boolean;
  feed?: string;
  orderBy?: string;
  first?: number;
  last?: number;
  before?: string;
  after?: string;
};

/** listGenerationModels 的 GraphQL 变量。 */
export type PixaiModelVariables = {
  type?: string;
  feed?: string;
  orderBy?: string;
  first?: number;
  last?: number;
  before?: string;
  after?: string;
};

/** 配置字段来自 GUI（可能带类型）或 CLI --var（一定是字符串），统一按 unknown 收窄。 */
export type PixaiVars = {
  crawl_type?: unknown;
  artwork_sort?: unknown;
  model_sort?: unknown;
  start_page?: unknown;
  end_page?: unknown;
  max_model_pages?: unknown;
  skip_model_pages?: unknown;
  max_artwork_pages?: unknown;
  max_artwork_pages_ranking?: unknown;
  tag_code_names?: unknown;
  max_tag_artwork_pages?: unknown;
  author_id?: unknown;
  author_artwork_type?: unknown;
  max_author_artwork_pages?: unknown;
  rank_type?: unknown;
  rank_period?: unknown;
};

// @ts-nocheck
// 端点、GraphQL 查询文本与固定请求头。改接口参数时只动这里。

export const API_URL = "https://api.pixai.art/graphql";
export const MEDIA_API_BASE = "https://api.pixai.art/v1/media/";

export const OPERATION_MODELS = "listGenerationModels";
export const OPERATION_ARTWORKS = "listArtworks";
export const OPERATION_GET_TACK = "getTack";
export const OPERATION_GET_ARTWORK_DETAIL = "getArtworkWithTaskDetail";
export const OPERATION_MESSAGES = "listMessages";

// PixAI supports Apollo persisted queries, but hashes rotate with site releases.
// Full query text avoids PersistedQueryNotFound failures.
export const MODELS_QUERY =
  "query listGenerationModels($feed: String, $first: Int, $last: Int, $orderBy: String, $before: String, $after: String, $type: GenerationModelType) { generationModels(feed: $feed, first: $first, last: $last, orderBy: $orderBy, before: $before, after: $after, type: $type) { edges { node { id title } } pageInfo { hasNextPage hasPreviousPage endCursor startCursor } } }";

export const ARTWORKS_QUERY =
  "query listArtworks($isSafeSearch: Boolean, $first: Int, $last: Int, $feed: String, $orderBy: String, $before: String, $after: String, $tackId: String, $loraId: ID, $authorId: ID, $types: [ArtworkType], $rankMediaType: RankMediaType, $isNsfw: Boolean) { artworks(isSafeSearch: $isSafeSearch, first: $first, last: $last, feed: $feed, orderBy: $orderBy, before: $before, after: $after, tackId: $tackId, loraId: $loraId, authorId: $authorId, types: $types, rankMediaType: $rankMediaType, isNsfw: $isNsfw) { edges { node { id title mediaId videoMediaId media { urls { variant url } } } } pageInfo { hasNextPage hasPreviousPage endCursor startCursor } } }";

export const GET_TACK_QUERY =
  "query getTack($id: ID, $defaultName: String, $codeName: String) { tack(id: $id, defaultName: $defaultName, codeName: $codeName) { id parentId codeName category defaultName weight mediaId safetyScore createdAt updatedAt tackTerms { id tackId category name createdAt updatedAt } } }";

export const ARTWORK_DETAIL_QUERY =
  "query getArtworkWithTaskDetail($id: ID!) { artwork(id: $id) { id title authorId prompts createdAt updatedAt mediaId videoMediaId likedCount commentCount extra media { id type width height imageType urls { variant url } } author { id username displayName avatarMediaId avatarSmallThumbnailMediaUrl accountType activeDecorations { id decorationId isEnabled decoration { id code type data } } } tacks { id codeName category defaultName displayName tackTerms { category name } } } }";

export const MESSAGES_QUERY =
  "query listMessages($topicId: ID!, $last: Int) { messages(topicId: $topicId, last: $last) { edges { node { id type content createdAt author { id username displayName avatarSmallThumbnailMediaUrl } } } } }";

export const REQUEST_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Origin: "https://pixai.art",
  Referer: "https://pixai.art/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
};

// plugin_data 里的标签缓存键，见 tacks.ts
export const TAG_CACHE_BY_ID = "pixai_tacks_by_id";
export const TAG_CACHE_BY_CODE_NAME = "pixai_tacks_by_code_name";

// 配置项缺省值（与 package.json kbConfig 的 default 保持一致）
export const DEFAULT_START_PAGE = 1;
export const DEFAULT_END_PAGE = 5;
export const DEFAULT_MODEL_PAGES = 3;
export const DEFAULT_SKIP_MODEL_PAGES = 0;
export const DEFAULT_ARTWORK_PAGES = 1;
export const DEFAULT_TAG_ARTWORK_PAGES = 3;
export const DEFAULT_AUTHOR_ARTWORK_PAGES = 5;
export const DEFAULT_RANKING_ARTWORK_PAGES = 1;

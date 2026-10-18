import { t } from "./i18n";
const {
  addProgress,
  createImageMetadata,
  downloadImage,
  pluginData,
  setHeader,
  setPluginData,
  warn,
} = Kabegame;

const API_SEARCH = "https://bbs-api.miyoushe.com/painter/wapi/searchPosts";
const API_USER_POSTS = "https://bbs-api.miyoushe.com/painter/wapi/userPostList";
const API_POST_FULL = "https://bbs-api.miyoushe.com/post/wapi/getPostFull";
const API_REPLIES = "https://bbs-api.miyoushe.com/post/wapi/getPostReplies";
const API_EMOTICONS = "https://bbs-api-static.miyoushe.com/misc/api/emoticon_set";

const EMOTICON_CACHE_KEY = "miyoushe_emoticon_map";
const EMOTICON_UPDATED_AT_KEY = "miyoushe_emoticon_updated_at";

// 站点 JSON 的最小结构：字段都可能缺失，只在确实依赖处收窄。
// 输出侧（createImageMetadata / downloadImage 的选项）必须保持 JSON 可序列化，
// 所以全部用 type 而非 interface（interface 不满足 KabegameJsonValue 的索引签名）。
type MiyousheLevelExp = {
  level?: number | string | null;
};

type MiyousheCertification = {
  type?: number | string | null;
  label?: string | null;
};

type MiyousheUser = {
  uid?: number | string | null;
  nickname?: string | null;
  avatar_url?: string | null;
  level_exp?: MiyousheLevelExp | null;
  certification?: MiyousheCertification | null;
  pendant?: string | null;
  ip_region?: string | null;
  is_super_fan?: boolean | null;
};

type MiyousheStat = {
  view_num?: number | string | null;
  reply_num?: number | string | null;
  like_num?: number | string | null;
  bookmark_num?: number | string | null;
  forward_num?: number | string | null;
};

// 图片既可能是 { url } 对象，也可能是裸 URL 字符串（评论里的老数据）
type MiyousheImageItem = {
  url?: string | null;
};

type MiyoushePost = {
  post_id?: number | string | null;
  subject?: string | null;
  content?: string | null;
  structured_content?: string | null;
  game_id?: number | string | null;
  created_at?: number | string | null;
  images?: Array<MiyousheImageItem | string> | null;
};

type MiyousheReplyContent = {
  floor_id?: number | string | null;
  created_at?: number | string | null;
  struct_content?: string | null;
};

type MiyousheReplyItem = {
  reply?: MiyousheReplyContent | null;
  user?: MiyousheUser | null;
  images?: Array<MiyousheImageItem | string> | null;
  stat?: MiyousheStat | null;
  sub_replies?: MiyousheReplyItem[] | null;
};

// 搜索结果 / 用户帖子列表的条目，以及详情接口的 data.post，三者同构：post 本体挂在 post 上，
// 作者与统计信息在条目这一层。
type MiyoushePostItem = {
  post?: MiyoushePost | null;
  user?: MiyousheUser | null;
  stat?: MiyousheStat | null;
};

type MiyousheResponse<T> = {
  retcode?: number | null;
  message?: string | null;
  data?: T | null;
};

type MiyousheListData = {
  list?: MiyoushePostItem[] | null;
  last_id?: string | number | null;
  next_offset?: string | null;
  is_last?: boolean | null;
};

type MiyousheReplyListData = {
  list?: MiyousheReplyItem[] | null;
  last_id?: string | number | null;
  is_last?: boolean | null;
};

type MiyoushePostFullData = {
  post?: MiyoushePostItem | null;
};

type MiyousheEmoticonItem = {
  name?: string | null;
  icon?: string | null;
  is_available?: boolean | null;
};

type MiyousheEmoticonGroup = {
  is_available?: boolean | null;
  list?: MiyousheEmoticonItem[] | null;
};

type MiyousheEmoticonData = {
  list?: MiyousheEmoticonGroup[] | null;
};

// 输出侧结构：字段齐全，保证可直接作为 JSON 元数据
type MiyousheUserSummary = {
  uid: string;
  nickname: string;
  avatar_url: string;
  level: number;
  certification_label: string;
  pendant: string;
  ip_region: string;
  is_super_fan: boolean;
};

type MiyousheReplySummary = {
  uid: string;
  nickname: string;
  avatar_url: string;
  level: number;
  certification_label: string;
  pendant: string;
  ip_region: string;
  is_super_fan: boolean;
  floor_id: number;
  created_at: number;
  struct_content: string;
  like_num: number;
  images: string[];
  is_sub?: boolean;
};

// 配置字段来自 GUI（可能有类型）或 CLI --var（一定是字符串），统一按 unknown 收窄
type MiyousheVars = {
  crawl_mode?: unknown;
  post_url?: unknown;
  user_uid?: unknown;
  search_keyword?: unknown;
  gids?: unknown;
  start_page?: unknown;
  end_page?: unknown;
  page_size?: unknown;
  max_comments?: unknown;
  fetch_comment_images?: unknown;
};

function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

function setRequestHeaders(): void {
  setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36");
  setHeader("Referer", "https://www.miyoushe.com/");
}

// 站点接口全部返回 { retcode, message, data }，泛型由调用处按接口补齐
async function fetchJson<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return (await response.json()) as T;
}

function readPluginDataOrEmpty(): Record<string, KabegameJsonValue> {
  try {
    const data = pluginData();
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function trySetPluginData(data: Record<string, KabegameJsonValue>): void {
  try {
    setPluginData(data);
  } catch {
    // Cache is optional.
  }
}

function readCachedEmoticonMap(): Record<string, string> | null {
  const map = readPluginDataOrEmpty()[EMOTICON_CACHE_KEY];
  if (!map || typeof map !== "object" || Array.isArray(map) || Object.keys(map).length === 0) {
    return null;
  }
  // 缓存是本插件自己写入的 Record<string, string>，从 pluginData 取出时只剩 JSON 值类型
  return map as Record<string, string>;
}

function writeCachedEmoticonMap(map: Record<string, string>): void {
  if (!map || typeof map !== "object") return;
  const data = readPluginDataOrEmpty();
  data[EMOTICON_CACHE_KEY] = map;
  data[EMOTICON_UPDATED_AT_KEY] = Date.now();
  trySetPluginData(data);
}

function buildSearchUrl(keyword: string, size: number, lastId: string, gids: string): string {
  const params = new URLSearchParams();
  params.set("keyword", keyword);
  params.set("size", String(size));
  if (lastId) params.set("last_id", lastId);
  if (gids) params.set("gids", gids);
  return `${API_SEARCH}?${params.toString()}`;
}

function buildUserPostsUrl(uid: string, size: number, offset: string): string {
  const params = new URLSearchParams();
  params.set("uid", uid);
  params.set("size", String(size));
  if (offset) params.set("offset", offset);
  return `${API_USER_POSTS}?${params.toString()}`;
}

function buildRepliesUrl(postId: string, size: number, lastId: string): string {
  const params = new URLSearchParams();
  params.set("post_id", postId);
  params.set("size", String(size));
  params.set("order_type", "1");
  params.set("is_hot", "false");
  if (lastId) params.set("last_id", lastId);
  return `${API_REPLIES}?${params.toString()}`;
}

function collectEmoticonNamesFromText(text: unknown): Record<string, true> {
  const names: Record<string, true> = {};
  const input = coerceStr(text);
  const re = /_\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    const name = match[1].trim();
    if (name) names[name] = true;
  }
  return names;
}

function userInfo(user: MiyousheUser | null | undefined): MiyousheUserSummary {
  const levelExp = user?.level_exp ?? {};
  const cert = user?.certification ?? {};
  return {
    uid: coerceStr(user?.uid),
    nickname: coerceStr(user?.nickname),
    avatar_url: coerceStr(user?.avatar_url),
    level: Number(levelExp?.level ?? 0),
    certification_label: cert?.type ? coerceStr(cert?.label) : "",
    pendant: coerceStr(user?.pendant),
    ip_region: coerceStr(user?.ip_region),
    is_super_fan: user?.is_super_fan === true,
  };
}

async function buildEmoticonMap(): Promise<Record<string, string>> {
  const cached = readCachedEmoticonMap();
  if (cached) return cached;
  const map: Record<string, string> = {};
  try {
    const resp = await fetchJson<MiyousheResponse<MiyousheEmoticonData>>(API_EMOTICONS);
    if (resp?.retcode !== 0) {
      warn(t("emoticonSetFailed", { retcode: coerceStr(resp?.retcode) }));
      return map;
    }
    const groups = resp?.data?.list;
    for (const group of Array.isArray(groups) ? groups : []) {
      if (group?.is_available !== true) continue;
      const items = group?.list;
      for (const item of Array.isArray(items) ? items : []) {
        if (item?.is_available !== true) continue;
        const name = coerceStr(item?.name);
        const icon = coerceStr(item?.icon);
        if (name && icon) map[name] = icon;
      }
    }
    if (Object.keys(map).length > 0) writeCachedEmoticonMap(map);
  } catch {
    warn(t("emoticonSetNetworkError"));
  }
  return map;
}

function pickRequiredEmoticons(
  allEmoticonMap: Record<string, string>,
  subject: unknown,
  content: unknown,
  replies: MiyousheReplySummary[],
): Record<string, string> {
  const used: Record<string, true> = {
    ...collectEmoticonNamesFromText(subject),
    ...collectEmoticonNamesFromText(content),
  };
  for (const reply of Array.isArray(replies) ? replies : []) {
    Object.assign(used, collectEmoticonNamesFromText(reply?.struct_content));
  }
  const picked: Record<string, string> = {};
  for (const name of Object.keys(used)) {
    const icon = allEmoticonMap[name];
    if (icon) picked[name] = icon;
  }
  return picked;
}

function imageUrlsFromList(value: Array<MiyousheImageItem | string> | null | undefined): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => typeof item === "object" && item ? coerceStr(item.url) : coerceStr(item))
    .filter((url) => /^https?:\/\//i.test(url));
}

function simplifyReply(item: MiyousheReplyItem | null | undefined, isSub = false): MiyousheReplySummary {
  const reply = item?.reply ?? {};
  const info = userInfo(item?.user);
  const images = imageUrlsFromList(item?.images);
  const stat = item?.stat ?? {};
  return {
    ...info,
    floor_id: Number(reply?.floor_id ?? 0),
    created_at: Number(reply?.created_at ?? 0),
    struct_content: coerceStr(reply?.struct_content),
    like_num: Number(stat?.like_num ?? 0),
    images,
    ...(isSub ? { is_sub: true } : {}),
  };
}

async function collectRepliesUntilLimit(
  postId: string,
  replyLimit: number,
): Promise<{ replies: MiyousheReplySummary[]; images: string[] }> {
  const replies: MiyousheReplySummary[] = [];
  const images: string[] = [];
  let lastId = "";
  let total = 0;
  const pageSize = 20;

  while (total < replyLimit) {
    const size = Math.min(pageSize, replyLimit - total);
    if (size <= 0) break;
    let resp: MiyousheResponse<MiyousheReplyListData>;
    try {
      resp = await fetchJson<MiyousheResponse<MiyousheReplyListData>>(buildRepliesUrl(postId, size, lastId));
    } catch {
      warn(t("repliesNetworkError", { postId }));
      break;
    }
    if (resp?.retcode !== 0) {
      warn(t("repliesFailed", { postId, retcode: coerceStr(resp?.retcode) }));
      break;
    }
    const list = resp?.data?.list;
    if (!Array.isArray(list) || list.length === 0) break;

    for (const item of list) {
      if (total >= replyLimit) break;
      const simplified = simplifyReply(item);
      replies.push(simplified);
      images.push(...simplified.images);
      total += 1;

      const subReplies = item?.sub_replies;
      for (const sub of Array.isArray(subReplies) ? subReplies : []) {
        if (total >= replyLimit) break;
        const subReply = simplifyReply(sub, true);
        replies.push(subReply);
        images.push(...subReply.images);
        total += 1;
      }
    }

    const newLastId = coerceStr(resp?.data?.last_id);
    if (resp?.data?.is_last === true || !newLastId || newLastId === lastId) break;
    lastId = newLastId;
  }
  return { replies, images };
}

function extractPostId(url: unknown): string {
  const clean = coerceStr(url).split(/[?#]/, 1)[0].replace(/\/+$/, "");
  return clean.match(/\/article\/([^/]+)$/)?.[1]?.trim() || "";
}

function postPageUrl(postId: string, fallback: unknown): string {
  return coerceStr(fallback) || `https://www.miyoushe.com/ys/article/${postId}`;
}

async function createPostMetadata(
  item: MiyoushePostItem | null | undefined,
  post: MiyoushePost | null | undefined,
  postId: string,
  emoticonMap: Record<string, string>,
  replyLimit: number,
): Promise<{ metadataId: number; subject: string; postImages: string[]; replyImages: string[] }> {
  const repliesData = await collectRepliesUntilLimit(postId, replyLimit);
  const stat = item?.stat ?? {};
  const info = userInfo(item?.user);
  const subject = coerceStr(post?.subject) || `mys_${postId}`;
  const postContent = coerceStr(post?.content);
  const postImages = imageUrlsFromList(post?.images);
  const replyImages = repliesData.images;
  const postEmoticons = pickRequiredEmoticons(
    emoticonMap,
    subject,
    postContent,
    repliesData.replies,
  );
  const metadataId = Number(createImageMetadata({
    post_id: postId,
    title: subject,
    game_id: Number(post?.game_id ?? 0),
    created_at: Number(post?.created_at ?? 0),
    uid: info.uid,
    nickname: info.nickname,
    avatar_url: info.avatar_url,
    level: info.level,
    certification_label: info.certification_label,
    pendant: info.pendant,
    ip_region: info.ip_region,
    is_super_fan: info.is_super_fan,
    post_image_total: postImages.length,
    comment_image_total: replyImages.length,
    total_image_count: postImages.length + replyImages.length,
    post_content: postContent,
    post_structured_content: coerceStr(post?.structured_content),
    view_num: Number(stat?.view_num ?? 0),
    reply_num: Number(stat?.reply_num ?? 0),
    like_num: Number(stat?.like_num ?? 0),
    bookmark_num: Number(stat?.bookmark_num ?? 0),
    forward_num: Number(stat?.forward_num ?? 0),
    // post 在两个调用点都已被保证存在（无 post 时更早就抛错），这里只为满足 JSON 值类型
    post_snapshot: post ?? null,
    emoticon_map: postEmoticons,
    replies: repliesData.replies,
  }, null));
  return { metadataId, subject, postImages, replyImages };
}

async function downloadPostImages(
  item: MiyoushePostItem | null | undefined,
  post: MiyoushePost | null | undefined,
  postId: string,
  postWeight: number,
  emoticonMap: Record<string, string>,
  vars: MiyousheVars,
  pageUrl: unknown,
): Promise<void> {
  const { metadataId, subject, postImages, replyImages } = await createPostMetadata(
    item,
    post,
    postId,
    emoticonMap,
    Number(vars.max_comments ?? 200),
  );
  const includeComments = vars.fetch_comment_images === true;
  const totalImages = postImages.length + (includeComments ? replyImages.length : 0);
  if (totalImages === 0) {
    addProgress(postWeight);
    return;
  }
  const imageWeight = postWeight / totalImages;
  const url = postPageUrl(postId, pageUrl);

  for (let index = 0; index < postImages.length; index += 1) {
    const name = postImages.length > 1 ? `${subject}(${index + 1})` : subject;
    const opts: KabegameDownloadImageOptions = { name, metadata_id: metadataId, url };
    await downloadImage(postImages[index], opts);
    addProgress(imageWeight);
  }

  if (includeComments) {
    for (let index = 0; index < replyImages.length; index += 1) {
      const opts: KabegameDownloadImageOptions = {
        name: `${subject}[评论${index + 1}]`,
        metadata_id: metadataId,
        url,
      };
      await downloadImage(replyImages[index], opts);
      addProgress(imageWeight);
    }
  }
}

async function crawlSinglePost(vars: MiyousheVars, emoticonMap: Record<string, string>): Promise<void> {
  const inputUrl = coerceStr(vars.post_url).trim();
  if (!inputUrl) throw new Error(t("singlePostUrlRequired"));
  const postId = extractPostId(inputUrl);
  if (!postId) throw new Error(t("postIdExtractFailed"));

  const resp = await fetchJson<MiyousheResponse<MiyoushePostFullData>>(
    `${API_POST_FULL}?post_id=${encodeURIComponent(postId)}`,
  );
  if (resp?.retcode !== 0) {
    throw new Error(
      t("postFullFailed", {
        postId,
        retcode: coerceStr(resp?.retcode),
        message: coerceStr(resp?.message),
      }),
    );
  }
  const postWrap = resp?.data?.post;
  const post = postWrap?.post;
  if (!post) throw new Error(t("postFullNoPost", { postId }));
  if (imageUrlsFromList(post.images).length === 0) throw new Error(t("postNoImages", { postId }));
  await downloadPostImages(postWrap, post, postId, 100.0, emoticonMap, vars, inputUrl);
}

async function fastForwardUserOffset(uid: string, pageSize: number, startPage: number): Promise<string> {
  let offset = "";
  for (let page = 1; page < startPage; page += 1) {
    const resp = await fetchJson<MiyousheResponse<MiyousheListData>>(buildUserPostsUrl(uid, pageSize, offset));
    const newOffset = coerceStr(resp?.data?.next_offset);
    if (resp?.retcode !== 0 || !newOffset || resp?.data?.is_last === true) break;
    offset = newOffset;
  }
  return offset;
}

async function runUserPosts(vars: MiyousheVars, emoticonMap: Record<string, string>): Promise<void> {
  const uid = coerceStr(vars.user_uid).trim();
  if (!uid) throw new Error(t("userUidRequired"));
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  const pageSize = Number(vars.page_size ?? 20);
  if (endPage < startPage) throw new Error(t("endPageBeforeStart"));

  let offset = await fastForwardUserOffset(uid, pageSize, startPage);
  const totalPages = endPage - startPage + 1;
  const pageWeight = 100.0 / totalPages;
  let totalPosts = 0;

  for (let page = startPage; page <= endPage; page += 1) {
    const resp = await fetchJson<MiyousheResponse<MiyousheListData>>(buildUserPostsUrl(uid, pageSize, offset));
    if (resp?.retcode !== 0) {
      warn(
        t("userPostsFailed", {
          uid,
          retcode: coerceStr(resp?.retcode),
          message: coerceStr(resp?.message),
        }),
      );
      break;
    }
    const list = resp?.data?.list;
    if (!Array.isArray(list) || list.length === 0) {
      warn(t("pageNoResults", { page }));
      addProgress(pageWeight);
      break;
    }
    const validPosts = list.filter((item) => imageUrlsFromList(item?.post?.images).length > 0);
    if (validPosts.length === 0) {
      addProgress(pageWeight);
    } else {
      const postWeight = pageWeight / validPosts.length;
      for (const item of validPosts) {
        const post = item.post;
        const postId = coerceStr(post?.post_id);
        await downloadPostImages(item, post, postId, postWeight, emoticonMap, vars, "");
        totalPosts += 1;
      }
    }
    const newOffset = coerceStr(resp?.data?.next_offset);
    if (resp?.data?.is_last === true || !newOffset || newOffset === offset) break;
    offset = newOffset;
  }
  console.log(t("userPostsDone", { count: totalPosts }));
}

async function fastForwardSearchCursor(
  keyword: string,
  pageSize: number,
  startPage: number,
  gids: string,
): Promise<string> {
  let cursor = "";
  for (let page = 1; page < startPage; page += 1) {
    const resp = await fetchJson<MiyousheResponse<MiyousheListData>>(
      buildSearchUrl(keyword, pageSize, cursor, gids),
    );
    const newCursor = coerceStr(resp?.data?.last_id);
    if (resp?.retcode !== 0 || !newCursor || resp?.data?.is_last === true) break;
    cursor = newCursor;
  }
  return cursor;
}

async function runSearch(vars: MiyousheVars, emoticonMap: Record<string, string>): Promise<void> {
  const keyword = coerceStr(vars.search_keyword || "壁纸");
  const gids = coerceStr(vars.gids);
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  const pageSize = Number(vars.page_size ?? 20);
  if (endPage < startPage) throw new Error(t("endPageBeforeStart"));

  let cursor = await fastForwardSearchCursor(keyword, pageSize, startPage, gids);
  const totalPages = endPage - startPage + 1;
  const pageWeight = 100.0 / totalPages;
  for (let page = startPage; page <= endPage; page += 1) {
    const resp = await fetchJson<MiyousheResponse<MiyousheListData>>(
      buildSearchUrl(keyword, pageSize, cursor, gids),
    );
    if (resp?.retcode !== 0) {
      warn(
        t("searchFailed", {
          page,
          retcode: coerceStr(resp?.retcode),
          message: coerceStr(resp?.message),
        }),
      );
      break;
    }
    const list = resp?.data?.list;
    if (!Array.isArray(list) || list.length === 0) {
      warn(t("pageNoResults", { page }));
      addProgress(pageWeight);
      break;
    }
    const validPosts = list.filter((item) => imageUrlsFromList(item?.post?.images).length > 0);
    if (validPosts.length === 0) {
      addProgress(pageWeight);
    } else {
      const postWeight = pageWeight / validPosts.length;
      for (const item of validPosts) {
        const post = item.post;
        const postId = coerceStr(post?.post_id);
        await downloadPostImages(item, post, postId, postWeight, emoticonMap, vars, "");
      }
    }
    const newCursor = coerceStr(resp?.data?.last_id);
    if (resp?.data?.is_last === true || !newCursor) break;
    cursor = newCursor;
  }
}

export async function crawl(_common: unknown, custom: Record<string, unknown> | null | undefined): Promise<void> {
  const vars = (custom || {}) as MiyousheVars;
  setRequestHeaders();
  console.log(t("emoticonLoading"));
  const emoticonMap = await buildEmoticonMap();
  console.log(t("emoticonLoaded"));

  if (vars.crawl_mode === "single_post") {
    await crawlSinglePost(vars, emoticonMap);
  } else if (vars.crawl_mode === "user_posts") {
    await runUserPosts(vars, emoticonMap);
  } else {
    await runSearch(vars, emoticonMap);
  }
  console.log(t("taskFinished"));
}

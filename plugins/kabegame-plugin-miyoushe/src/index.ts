// @ts-nocheck
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

function coerceStr(value) {
  return value == null ? "" : String(value);
}

function setRequestHeaders() {
  setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36");
  setHeader("Referer", "https://www.miyoushe.com/");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

function readPluginDataOrEmpty() {
  try {
    const data = pluginData();
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function trySetPluginData(data) {
  try {
    setPluginData(data);
  } catch {
    // Cache is optional.
  }
}

function readCachedEmoticonMap() {
  const map = readPluginDataOrEmpty()[EMOTICON_CACHE_KEY];
  return map && typeof map === "object" && Object.keys(map).length > 0 ? map : null;
}

function writeCachedEmoticonMap(map) {
  if (!map || typeof map !== "object") return;
  const data = readPluginDataOrEmpty();
  data[EMOTICON_CACHE_KEY] = map;
  data[EMOTICON_UPDATED_AT_KEY] = Date.now();
  trySetPluginData(data);
}

function buildSearchUrl(keyword, size, lastId, gids) {
  const params = new URLSearchParams();
  params.set("keyword", keyword);
  params.set("size", String(size));
  if (lastId) params.set("last_id", lastId);
  if (gids) params.set("gids", gids);
  return `${API_SEARCH}?${params.toString()}`;
}

function buildUserPostsUrl(uid, size, offset) {
  const params = new URLSearchParams();
  params.set("uid", uid);
  params.set("size", String(size));
  if (offset) params.set("offset", offset);
  return `${API_USER_POSTS}?${params.toString()}`;
}

function buildRepliesUrl(postId, size, lastId) {
  const params = new URLSearchParams();
  params.set("post_id", postId);
  params.set("size", String(size));
  params.set("order_type", "1");
  params.set("is_hot", "false");
  if (lastId) params.set("last_id", lastId);
  return `${API_REPLIES}?${params.toString()}`;
}

function collectEmoticonNamesFromText(text) {
  const names = {};
  const input = coerceStr(text);
  const re = /_\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(input))) {
    const name = match[1].trim();
    if (name) names[name] = true;
  }
  return names;
}

function userInfo(user) {
  const levelExp = user?.level_exp || {};
  const cert = user?.certification || {};
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

async function buildEmoticonMap() {
  const cached = readCachedEmoticonMap();
  if (cached) return cached;
  const map = {};
  try {
    const resp = await fetchJson(API_EMOTICONS);
    if (resp?.retcode !== 0) {
      warn(t("emoticonSetFailed", { retcode: coerceStr(resp?.retcode) }));
      return map;
    }
    for (const group of Array.isArray(resp?.data?.list) ? resp.data.list : []) {
      if (group?.is_available !== true) continue;
      for (const item of Array.isArray(group?.list) ? group.list : []) {
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

function pickRequiredEmoticons(allEmoticonMap, subject, content, replies) {
  const used = {
    ...collectEmoticonNamesFromText(subject),
    ...collectEmoticonNamesFromText(content),
  };
  for (const reply of Array.isArray(replies) ? replies : []) {
    Object.assign(used, collectEmoticonNamesFromText(reply?.struct_content));
  }
  const picked = {};
  for (const name of Object.keys(used)) {
    if (allEmoticonMap[name]) picked[name] = allEmoticonMap[name];
  }
  return picked;
}

function imageUrlsFromList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => typeof item === "object" && item ? coerceStr(item.url) : coerceStr(item))
    .filter((url) => /^https?:\/\//i.test(url));
}

function simplifyReply(item, isSub = false) {
  const reply = item?.reply || {};
  const info = userInfo(item?.user);
  const images = imageUrlsFromList(item?.images);
  const stat = item?.stat || {};
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

async function collectRepliesUntilLimit(postId, replyLimit) {
  const replies = [];
  const images = [];
  let lastId = "";
  let total = 0;
  const pageSize = 20;

  while (total < replyLimit) {
    const size = Math.min(pageSize, replyLimit - total);
    if (size <= 0) break;
    let resp;
    try {
      resp = await fetchJson(buildRepliesUrl(postId, size, lastId));
    } catch {
      warn(t("repliesNetworkError", { postId }));
      break;
    }
    if (resp?.retcode !== 0) {
      warn(t("repliesFailed", { postId, retcode: coerceStr(resp?.retcode) }));
      break;
    }
    const list = Array.isArray(resp?.data?.list) ? resp.data.list : [];
    if (list.length === 0) break;

    for (const item of list) {
      if (total >= replyLimit) break;
      const simplified = simplifyReply(item);
      replies.push(simplified);
      images.push(...simplified.images);
      total += 1;

      for (const sub of Array.isArray(item?.sub_replies) ? item.sub_replies : []) {
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

function extractPostId(url) {
  const clean = coerceStr(url).split(/[?#]/, 1)[0].replace(/\/+$/, "");
  return clean.match(/\/article\/([^/]+)$/)?.[1]?.trim() || "";
}

function postPageUrl(postId, fallback) {
  return coerceStr(fallback) || `https://www.miyoushe.com/ys/article/${postId}`;
}

async function createPostMetadata(item, post, postId, emoticonMap, replyLimit) {
  const repliesData = await collectRepliesUntilLimit(postId, replyLimit);
  const stat = item?.stat || {};
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
    post_snapshot: post,
    emoticon_map: postEmoticons,
    replies: repliesData.replies,
  }, null));
  return { metadataId, subject, postImages, replyImages };
}

async function downloadPostImages(item, post, postId, postWeight, emoticonMap, vars, pageUrl) {
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
    await downloadImage(postImages[index], { name, metadata_id: metadataId, url });
    addProgress(imageWeight);
  }

  if (includeComments) {
    for (let index = 0; index < replyImages.length; index += 1) {
      await downloadImage(replyImages[index], {
        name: `${subject}[评论${index + 1}]`,
        metadata_id: metadataId,
        url,
      });
      addProgress(imageWeight);
    }
  }
}

async function crawlSinglePost(vars, emoticonMap) {
  const inputUrl = coerceStr(vars.post_url).trim();
  if (!inputUrl) throw new Error(t("singlePostUrlRequired"));
  const postId = extractPostId(inputUrl);
  if (!postId) throw new Error(t("postIdExtractFailed"));

  const resp = await fetchJson(`${API_POST_FULL}?post_id=${encodeURIComponent(postId)}`);
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

async function fastForwardUserOffset(uid, pageSize, startPage) {
  let offset = "";
  for (let page = 1; page < startPage; page += 1) {
    const resp = await fetchJson(buildUserPostsUrl(uid, pageSize, offset));
    const newOffset = coerceStr(resp?.data?.next_offset);
    if (resp?.retcode !== 0 || !newOffset || resp?.data?.is_last === true) break;
    offset = newOffset;
  }
  return offset;
}

async function runUserPosts(vars, emoticonMap) {
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
    const resp = await fetchJson(buildUserPostsUrl(uid, pageSize, offset));
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
    const list = Array.isArray(resp?.data?.list) ? resp.data.list : [];
    if (list.length === 0) {
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

async function fastForwardSearchCursor(keyword, pageSize, startPage, gids) {
  let cursor = "";
  for (let page = 1; page < startPage; page += 1) {
    const resp = await fetchJson(buildSearchUrl(keyword, pageSize, cursor, gids));
    const newCursor = coerceStr(resp?.data?.last_id);
    if (resp?.retcode !== 0 || !newCursor || resp?.data?.is_last === true) break;
    cursor = newCursor;
  }
  return cursor;
}

async function runSearch(vars, emoticonMap) {
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
    const resp = await fetchJson(buildSearchUrl(keyword, pageSize, cursor, gids));
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
    const list = Array.isArray(resp?.data?.list) ? resp.data.list : [];
    if (list.length === 0) {
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

export async function crawl(_common, custom) {
  const vars = custom || {};
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

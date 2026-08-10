// @ts-nocheck
// 小黑盒 (XHH) 综合搜索爬虫，V8 后端。
//
// 模块分工：
//   consts  端点与公共参数            sign     Web 端 hkey 签名（保留在插件内部）
//   util    取值/清洗/HTTP/宿主桥接    post     tree 响应结构解析
//   image   缩略图换原图              comment  自动评论
import { resolveAutoCommentText, runAutoInteract } from "./comment";
import {
  API_HOST,
  COMMENTS_MAX,
  COMMON_PARAMS_BASE,
  PATH_SEARCH,
  PATH_TREE,
  SEARCH_UNITS_PER_POST,
} from "./consts";
import { resolveOriginalUrl } from "./image";
import {
  authorFromLink,
  findCommentsRender,
  findPostRender,
  flattenComments,
  topicsToTags,
} from "./post";
import { signedUrl, xhhFakeDeviceId } from "./sign";
import {
  challengeError,
  coerceStr,
  createImageMetadata,
  extractLinkId,
  fetchJson,
  isChallenge,
  log,
  loginHint,
  setCookieAvailable,
  setRequestHeaders,
  stripEmojiBracketTokens,
  stripTags,
  validHttpUrl,
} from "./util";

const { addProgress, downloadImage, requireCookie, warn } = Kabegame;

async function crawlPost(linkId, itemWeight, commonParams, fetchCommentImages, autoCommentText) {
  const treeExtra = `link_id=${encodeURIComponent(linkId)}&is_first=1&page=1&index=1&limit=20&owner_only=0`;
  const treeUrl = signedUrl(API_HOST, PATH_TREE, commonParams, treeExtra);
  const tree = await fetchJson(treeUrl);

  if (isChallenge(tree?.status)) challengeError("帖子树接口", tree?.status);
  if (tree?.status !== "ok") {
    log(`tree 请求失败 link_id=${linkId} status=${coerceStr(tree?.status)}`, "warn");
    addProgress(itemWeight);
    return;
  }

  const treeResult = tree.result;
  const linkObj = treeResult?.link;
  if (!linkObj) {
    log(`tree 无 result.link link_id=${linkId}`, "warn");
    addProgress(itemWeight);
    return;
  }

  // 评论快照要在正文解析之前取：自动评论只要求「解析到帖子」，
  // 不受下面正文为空 / 无配图这些提前 return 的影响。
  const commentsSnapshot = flattenComments(treeResult, COMMENTS_MAX);
  if (autoCommentText) {
    // 点赞/评论只认数字 linkid：搜索结果 share_url 上挂的是 b61e71d37956 这类混淆 id，
    // tree 接口两种都吃，这两个写接口只回「非法的请求」。
    const interactLinkId = coerceStr(linkObj.linkid) || linkId;
    await runAutoInteract(interactLinkId, autoCommentText, commentsSnapshot, commonParams);
  }

  const textStr = coerceStr(linkObj.text);
  if (!textStr) {
    log(`帖子正文为空 link_id=${linkId}`, "warn");
    addProgress(itemWeight);
    return;
  }

  let blocks;
  try {
    blocks = JSON.parse(textStr);
  } catch {
    log(`解析帖子正文 JSON 失败 link_id=${linkId}`, "warn");
    addProgress(itemWeight);
    return;
  }
  if (!Array.isArray(blocks)) {
    log(`帖子正文 JSON 不是数组 link_id=${linkId}，跳过下载`, "warn");
    addProgress(itemWeight);
    return;
  }

  const titleHtml = coerceStr(linkObj.title);
  const titlePlain = stripTags(titleHtml).trim();
  let displayName = stripEmojiBracketTokens(titlePlain);
  if (!displayName) {
    const descHtml = coerceStr(linkObj.description) || coerceStr(linkObj.desc);
    displayName = stripEmojiBracketTokens(stripTags(descHtml).trim()) || `xhh_${linkId}`;
  }

  log(`[小黑盒] link_id=${linkId} display_name=${displayName}`);

  const author = authorFromLink(linkObj);
  const tags = topicsToTags(linkObj);
  const postRender = findPostRender(linkObj);
  const commentsRender = findCommentsRender(treeResult);
  const shareUrl = coerceStr(linkObj.share_url);
  const postCreateAt = Number(linkObj.create_at ?? 0);
  const postIp = coerceStr(linkObj.ip_location);

  let descriptionPlain = "";
  const thumbUrls = [];
  for (const block of blocks) {
    if (block?.type === "text" && !descriptionPlain) {
      descriptionPlain = stripEmojiBracketTokens(stripTags(block.text).trim());
    }
    if (block?.type !== "img") continue;
    const thumb = coerceStr(block.url);
    if (thumb) thumbUrls.push(thumb);
  }

  const imageTotal = thumbUrls.length;
  if (imageTotal === 0) {
    log(`已解析正文但未找到 type=img 配图缩略图 link_id=${linkId} display_name=${displayName}，跳过下载`, "warn");
    addProgress(itemWeight);
    return;
  }

  const metadata = {
    link_id: linkId,
    share_url: shareUrl,
    description: descriptionPlain,
    title_html: titleHtml,
    title_plain: titlePlain,
    link_title: coerceStr(linkObj.title),
    author,
    tags,
    comments_snapshot: commentsSnapshot,
    comments_max: COMMENTS_MAX,
    post_create_at: postCreateAt,
    post_ip: postIp,
    post_render_html: postRender?.html || "",
    post_render_css: postRender?.css || "",
    comments_render_html: commentsRender?.html || "",
    comments_render_css: commentsRender?.css || "",
    image_total: imageTotal,
  };
  const metadataId = createImageMetadata(metadata);

  const deltaPerImage = itemWeight / imageTotal;
  for (let index = 0; index < thumbUrls.length; index += 1) {
    const finalUrl = await resolveOriginalUrl(thumbUrls[index], commonParams, "原图接口");
    if (finalUrl) {
      const imageDisplayName = imageTotal > 1 ? `${displayName}(${index + 1})` : displayName;
      await downloadImage(finalUrl, {
        name: imageDisplayName,
        metadata_id: metadataId,
        url: shareUrl,
      });
    } else {
      log(`原图 URL 无效且无可用回退 link_id=${linkId} k=${index + 1}`, "warn");
    }
    addProgress(deltaPerImage);
  }

  if (!fetchCommentImages) return;

  for (const comment of commentsSnapshot) {
    const commentImages = Array.isArray(comment.imgs) ? comment.imgs : [];
    for (let index = 0; index < commentImages.length; index += 1) {
      const commentImage = commentImages[index];
      const inputUrl = commentImage.thumb || commentImage.url;
      if (!validHttpUrl(inputUrl)) continue;

      const finalUrl = await resolveOriginalUrl(inputUrl, commonParams, "原图接口(评论图)");
      if (!finalUrl) {
        log(`原图 URL 无效且无可用回退(评论图) link_id=${linkId} floor=${comment.floor_num}`, "warn");
        continue;
      }

      const baseName = `${displayName}[comment_${comment.floor_num}]`;
      const name = commentImages.length > 1 ? `${baseName}(${index + 1})` : baseName;
      await downloadImage(finalUrl, {
        name,
        metadata_id: metadataId,
        url: shareUrl,
      });
    }
  }
}

async function runSinglePost(commonParams, vars) {
  const inputUrl = coerceStr(vars?.post_share_url);
  if (!inputUrl) throw new Error("单帖子模式：请填写帖子分享 URL");

  const linkId = extractLinkId(inputUrl);
  if (!linkId) throw new Error("无法从 URL 中提取 link_id，请确认这是小黑盒帖子分享链接");

  log(`[小黑盒] 单帖子模式：link_id=${linkId}`);
  await crawlPost(
    linkId,
    100.0,
    commonParams,
    !!vars?.fetch_comment_images,
    resolveAutoCommentText(vars),
  );
}

async function runSearch(commonParams, vars) {
  const searchKeyword = coerceStr(vars?.search_keyword || "美图");
  const startPage = Number(vars?.start_page ?? 1);
  const endPage = Number(vars?.end_page ?? startPage);
  const pageSize = Number(vars?.page_size ?? 5);

  if (endPage < startPage) throw new Error("结束页须大于或等于起始页");
  if (startPage < 1) throw new Error("起始页须至少为 1");
  if (pageSize < 1) throw new Error("每页条数须至少为 1");

  const autoCommentText = resolveAutoCommentText(vars);
  const totalPages = endPage - startPage + 1;
  const pageWeight = 100.0 / totalPages;
  log(`[小黑盒] 开始：关键词「${searchKeyword}」，第 ${startPage}～${endPage} 页，每页 ${pageSize} 条`);

  for (let page = startPage; page <= endPage; page += 1) {
    // pageSize 是「帖子条数」，接口单位要乘 SEARCH_UNITS_PER_POST，见 consts.ts。
    const apiLimit = pageSize * SEARCH_UNITS_PER_POST;
    const offset = (page - 1) * apiLimit;
    const extra = `q=${encodeURIComponent(searchKeyword)}&search_type=general&offset=${offset}&limit=${apiLimit}`;
    const searchUrl = signedUrl(API_HOST, PATH_SEARCH, commonParams, extra);
    const response = await fetchJson(searchUrl);

    if (isChallenge(response?.status)) challengeError("搜索接口", response?.status);
    if (response?.status !== "ok") {
      log(`搜索请求失败: ${coerceStr(response?.status)}${loginHint()}`, "warn");
      break;
    }

    const items = Array.isArray(response?.result?.items) ? response.result.items : [];
    if (items.length === 0) {
      log(`第 ${page} 页无搜索结果`, "warn");
      addProgress(pageWeight);
      continue;
    }

    // items 里混着 type=space 的版块卡，只有 type=link 的才是帖子；
    // 再按 pageSize 收口，让「每页条数」始终是用户填的那个数。
    const validItems = items
      .filter((item) => {
        const info = item?.info;
        const linkId = extractLinkId(info?.share_url) || coerceStr(info?.linkid);
        return !!linkId;
      })
      .slice(0, pageSize);

    if (validItems.length === 0) {
      log(`第 ${page} 页无含 link_id 的有效帖子`, "warn");
      addProgress(pageWeight);
      continue;
    }

    const itemWeight = pageWeight / validItems.length;
    log(`第 ${page}/${endPage} 页：共 ${validItems.length} 条有效帖子，开始解析`);
    for (const item of validItems) {
      const info = item.info || {};
      const linkId = extractLinkId(info.share_url) || coerceStr(info.linkid);
      await crawlPost(
        linkId,
        itemWeight,
        commonParams,
        !!vars?.fetch_comment_images,
        autoCommentText,
      );
    }
    log(`第 ${page} 页处理完成`);
  }
}

export async function crawl(_common, custom) {
  const vars = custom || {};
  setRequestHeaders();
  const commonParams = `${COMMON_PARAMS_BASE}&device_id=${xhhFakeDeviceId()}`;

  // 机会注入：从畅游取小黑盒 Cookie（脚本拿不到明文）。取不到不阻断，
  // 但小黑盒多数接口需要登录态，失败时在告警里提示去畅游登录。
  const cookieAvailable = requireCookie();
  setCookieAvailable(cookieAvailable);
  if (!cookieAvailable) {
    warn("未从畅游获取到小黑盒 Cookie，将以未登录状态抓取；小黑盒多数接口需要登录，可能无结果。请先在畅游登录小黑盒后重试。");
  }

  if (vars?.crawl_mode === "single_post") {
    await runSinglePost(commonParams, vars);
  } else {
    await runSearch(commonParams, vars);
  }

  log("[小黑盒] 任务结束");
}

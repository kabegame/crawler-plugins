// @ts-nocheck
// 自动互动：给爬到的帖子点个赞 + 发一条评论（已抓到的评论里存在相同内容就跳过评论）。
//
// 两个接口同主机、同签名，都是 POST 表单，参数全在 body 里；URL 只带公共参数 + 签名。
// 抓包里还有一个 `_rnd=<n>:<sha256>`，实测不带也能过，故不实现。`heybox_id` 同理可
// 留空——登录态由畅游注入的 Cookie 承载。但 Referer 必须带，见 COMMENT_REFERER。
import {
  COMMENT_API_HOST,
  COMMENT_REFERER,
  PATH_AWARD_LINK,
  PATH_COMMENT_CREATE,
} from "./consts";
import { signedUrl } from "./sign";
import {
  coerceStr,
  isChallenge,
  log,
  loginHint,
  stripEmojiBracketTokens,
  stripTags,
} from "./util";

/** 仅当开关打开且文案非空时才启用自动评论。 */
export function resolveAutoCommentText(vars) {
  if (!vars?.auto_comment) return "";
  return coerceStr(vars.auto_comment_text).trim();
}

// 去重的比较口径：接口回来的 text 可能带 <a> 标签与 [emoji_xxx] 占位符，
// 先剥成纯文本再比，才能和用户填的纯文案对上。
function normalizeCommentText(value) {
  return stripEmojiBracketTokens(stripTags(coerceStr(value)));
}

function firstCommentFloor(response) {
  const list = response?.result?.comment?.comment;
  return Array.isArray(list) && list.length > 0 ? Number(list[0]?.floor_num ?? 0) : 0;
}

/** 两个写接口共用的 POST 表单调用。 */
async function postForm(path, body, commonParams) {
  const url = signedUrl(COMMENT_API_HOST, path, commonParams, "");
  return (
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Referer: COMMENT_REFERER,
      },
      body,
    })
  ).json();
}

/**
 * 给帖子点赞。award_type=1 是幂等的——实测同一帖连点四次仍是 is_award_link=1，
 * 不会翻成取消，所以评论被去重跳过时也照点，正好把上一轮漏掉的赞补上。
 */
async function awardPost(linkId, commonParams) {
  const response = await postForm(
    PATH_AWARD_LINK,
    `link_id=${encodeURIComponent(linkId)}&award_type=1`,
    commonParams,
  );

  if (isChallenge(response?.status)) {
    log(`自动点赞触发风控/验证码 link_id=${linkId} status=${coerceStr(response?.status)}`, "warn");
    return;
  }
  if (response?.status !== "ok") {
    log(
      `自动点赞失败 link_id=${linkId} status=${coerceStr(response?.status)} msg=${coerceStr(response?.msg)}${loginHint()}`,
      "warn",
    );
    return;
  }
  log(`[小黑盒] 已点赞 link_id=${linkId}`);
}

/**
 * 给帖子发一条自动评论。抛错由调用方兜住——评论失败不应打断下载。
 */
async function postAutoComment(linkId, commentText, commentsSnapshot, commonParams) {
  const target = normalizeCommentText(commentText);
  if (!target) return;

  const duplicated = commentsSnapshot.some(
    (comment) => normalizeCommentText(comment.text) === target,
  );
  if (duplicated) {
    log(`[小黑盒] link_id=${linkId} 已抓到的评论中存在相同内容，跳过自动评论`);
    return;
  }

  const response = await postForm(
    PATH_COMMENT_CREATE,
    `is_cy=0&link_id=${encodeURIComponent(linkId)}&reply_id=-1&root_id=-1&text=${encodeURIComponent(commentText)}`,
    commonParams,
  );

  if (isChallenge(response?.status)) {
    log(`自动评论触发风控/验证码 link_id=${linkId} status=${coerceStr(response?.status)}`, "warn");
    return;
  }
  if (response?.status !== "ok") {
    log(
      `自动评论失败 link_id=${linkId} status=${coerceStr(response?.status)} msg=${coerceStr(response?.msg)}${loginHint()}`,
      "warn",
    );
    return;
  }

  const floor = firstCommentFloor(response);
  log(`[小黑盒] 已自动评论 link_id=${linkId}${floor ? ` floor=${floor}` : ""}`);
}

async function safely(label, run) {
  try {
    await run();
  } catch (error) {
    log(`${label}：${coerceStr(error?.message ?? error)}`, "warn");
  }
}

/**
 * 自动互动入口：先点赞再评论。两步互相独立——任一步失败（含网络异常）都只告警，
 * 既不影响另一步，也不打断图片下载。
 */
export async function runAutoInteract(linkId, commentText, commentsSnapshot, commonParams) {
  await safely(`自动点赞异常 link_id=${linkId}`, () => awardPost(linkId, commonParams));
  await safely(`自动评论异常 link_id=${linkId}`, () =>
    postAutoComment(linkId, commentText, commentsSnapshot, commonParams),
  );
}

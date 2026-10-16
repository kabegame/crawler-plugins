// @ts-nocheck
// 微博插件入口。
//
// 模块分工：
//   consts   端点与常量            util     HTTP / 登录失效识别 / 输入解析
//   modes    五种模式的微博来源     post     单条微博取图、长文、评论、metadata、下载
//   derived  标签与元数据搜索词
//
// 所有模式都依赖畅游里 weibo.com 的登录态：未登录时时间线 403、m 站 432、搜索跳登录页。
import { POST_DELAY_MS, TIMELINE_FEATURES } from "./consts";
import { albumSource, resolveUser, searchSource, supertopicSource, timelineSource } from "./modes";
import { fetchPost, processPost } from "./post";
import { LoginError, parsePostInput, parseSupertopicInput, pause, str } from "./util";

const { addProgress, requireCookie, setHeader, warn } = Kabegame;

function setup() {
  const ua = Kabegame.cefUserAgent?.();
  if (ua) setHeader("User-Agent", ua);
  // 图片 CDN（sinaimg.cn）防盗链：不带 weibo.com 的 Referer 一律 403
  setHeader("Referer", "https://weibo.com/");
  setHeader("Accept", "application/json, text/plain, */*");
  if (!requireCookie("weibo.com")) {
    throw new Error("未获取到微博登录态：请先在畅游打开 weibo.com 并登录，然后重新运行。");
  }
}

async function runSingle(vars, opts) {
  const id = parsePostInput(vars.post_url);
  if (!id) throw new Error("请填写微博链接（如 https://weibo.com/<UID>/<微博ID>）或微博 ID");
  const mblog = await fetchPost(id);
  if (mblog?.ok === 0 || !mblog?.id) throw new Error(`微博 ${id} 不可见：${str(mblog?.message) || "已删除或无权限"}`);
  // 单条链接指向转发时，收原帖的图
  const own = await processPost(mblog, opts);
  if (own === 0 && mblog.retweeted_status) {
    const n = await processPost(mblog.retweeted_status, opts, mblog.user);
    if (n === 0) warn("[weibo] 这条转发的原帖没有图片");
  } else if (own === 0) {
    warn("[weibo] 这条微博没有图片");
  }
  addProgress(100);
}

async function sourceFor(vars) {
  const mode = str(vars.mode) || "album";
  if (mode === "album" || mode === "timeline") {
    const user = await resolveUser(vars.user);
    const uid = str(user.idstr || user.id);
    console.log(`[weibo] 用户：${str(user.screen_name)}（${uid}），共 ${user.statuses_count ?? "?"} 条微博`);
    if (mode === "album") return albumSource(uid);
    const feature = TIMELINE_FEATURES[str(vars.timeline_filter)] ?? TIMELINE_FEATURES.all;
    return timelineSource(uid, feature, vars.include_retweets === true);
  }
  if (mode === "supertopic") {
    const topicId = parseSupertopicInput(vars.supertopic);
    if (!topicId) throw new Error("请填写超话名（如：原神）或超话链接");
    return supertopicSource(topicId, str(vars.supertopic_channel) || "latest", vars.supertopic_tag);
  }
  if (mode === "search") {
    const keyword = str(vars.keyword).trim();
    if (!keyword) throw new Error("请填写搜索关键词");
    return searchSource(keyword, str(vars.search_sort), vars.search_original === true, str(vars.start_date), str(vars.end_date));
  }
  throw new Error(`未知模式：${mode}`);
}

export async function crawl(_common, custom) {
  const vars = custom || {};
  setup();
  const opts = {
    livePhoto: vars.live_photo !== false,
    maxComments: Math.max(0, Number(vars.max_comments ?? 20)),
    commentImages: vars.comment_images !== false,
  };

  if (str(vars.mode) === "single") return runSingle(vars, opts);

  const maxPosts = Math.max(1, Number(vars.max_posts ?? 20));
  const perPost = 100 / maxPosts;
  const source = await sourceFor(vars);
  const done = new Set();
  let posts = 0;
  let files = 0;
  let failed = 0;
  for await (const { mblog, retweetedBy } of source) {
    const mid = str(mblog?.idstr || mblog?.id);
    if (!mid || done.has(mid)) continue;
    done.add(mid);
    try {
      const n = await processPost(mblog, opts, retweetedBy);
      if (n === 0) continue; // 无图微博不计数
      posts += 1;
      files += n;
      addProgress(perPost);
      console.log(`[weibo] ${posts}/${maxPosts} ${str(mblog?.user?.screen_name)} ${str(mblog?.mblogid)}：${n} 个文件`);
    } catch (e) {
      if (e instanceof LoginError) throw e;
      failed += 1;
      warn(`[weibo] 微博 ${str(mblog?.mblogid) || mid} 处理失败：${e?.message ?? e}`);
    }
    if (posts >= maxPosts) break;
    await pause(POST_DELAY_MS);
  }
  console.log(`[weibo] 完成：${posts} 条微博、${files} 个文件${failed ? `，${failed} 条失败` : ""}`);
  if (posts === 0 && failed === 0) warn("[weibo] 没有找到带图片的微博");
  addProgress(Math.max(0, 100 - posts * perPost));
}

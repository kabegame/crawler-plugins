// @ts-nocheck
// 各模式的微博来源：都是 async generator，逐条产出 { mblog, retweetedBy? }，
// 由入口统一做去重、计数上限与进度。按需拉取——到上限后不再请求下一页或下一条详情。
import {
  IMAGE_WALL_API, MYMBLOG_API, PAGE_DELAY_MS, POST_DELAY_MS, PROFILE_INFO_API, SEARCH_MAX_PAGE, SEARCH_URL,
  SUPERTOPIC_API, SUPERTOPIC_SORTS,
} from "./consts";
import { fetchPost } from "./post";
import { LoginError, fetchHtml, fetchJson, parseUserInput, pause, str } from "./util";

const { warn } = Kabegame;
const XHR = { "X-Requested-With": "XMLHttpRequest" };

/** 用户输入 → 微博用户对象（含 idstr / screen_name）。 */
export async function resolveUser(input) {
  const parsed = parseUserInput(input);
  if (!parsed) throw new Error("请填写用户：UID、主页链接或昵称");
  const query = parsed.uid
    ? `uid=${parsed.uid}`
    : parsed.custom
      ? `custom=${encodeURIComponent(parsed.custom)}`
      : `screen_name=${encodeURIComponent(parsed.screenName)}`;
  let json;
  try {
    json = await fetchJson(`${PROFILE_INFO_API}?${query}`);
  } catch (e) {
    if (e instanceof LoginError) throw e;
    throw new Error(`找不到微博用户「${str(input).trim()}」：${e?.message ?? e}`);
  }
  const user = json?.data?.user;
  if (!user?.idstr && !user?.id) throw new Error(`找不到微博用户「${str(input).trim()}」`);
  return user;
}

/** 逐个 mid 拉详情；单条失败（已删除、仅粉丝可见等）跳过。 */
async function* postsByMids(mids) {
  for (const mid of mids) {
    try {
      const mblog = await fetchPost(mid);
      if (mblog?.ok === 0 || !mblog?.id) {
        warn(`[weibo] 微博 ${mid} 不可见（${str(mblog?.message || mblog?.msg) || "已删除或无权限"}），跳过`);
      } else {
        yield { mblog };
      }
    } catch (e) {
      if (e instanceof LoginError) throw e;
      warn(`[weibo] 微博 ${mid} 详情获取失败：${e?.message ?? e}`);
    }
    await pause(POST_DELAY_MS);
  }
}

/** 用户相册（图片墙）：同一条微博的多张图在墙上相邻，按 mid 分组后逐条拉详情。 */
export async function* albumSource(uid) {
  let since = "0";
  const seen = new Set();
  for (let page = 1; ; page += 1) {
    const json = await fetchJson(`${IMAGE_WALL_API}?uid=${uid}&sinceid=${encodeURIComponent(since)}&has_album=true`);
    const list = Array.isArray(json?.data?.list) ? json.data.list : [];
    const mids = [];
    for (const item of list) {
      const mid = str(item?.mid);
      if (mid && !seen.has(mid)) {
        seen.add(mid);
        mids.push(mid);
      }
    }
    console.log(`[weibo] 相册第 ${page} 页：${list.length} 张图，${mids.length} 条新微博`);
    yield* postsByMids(mids);
    since = str(json?.data?.since_id);
    if (list.length === 0 || !since || since === "0") return;
    await pause(PAGE_DELAY_MS);
  }
}

/** 用户时间线：转发默认跳过；开启时产出被转发的原帖并记下转发者。 */
export async function* timelineSource(uid, feature, includeRetweets) {
  for (let page = 1; ; page += 1) {
    const json = await fetchJson(`${MYMBLOG_API}?uid=${uid}&page=${page}&feature=${feature}`);
    const list = Array.isArray(json?.data?.list) ? json.data.list : [];
    console.log(`[weibo] 时间线第 ${page} 页：${list.length} 条`);
    if (list.length === 0) return;
    for (const item of list) {
      if (item?.retweeted_status) {
        if (includeRetweets) yield { mblog: item.retweeted_status, retweetedBy: item.user };
      } else {
        yield { mblog: item };
      }
    }
    await pause(PAGE_DELAY_MS);
  }
}

/** 超话频道 flowId：内置排序直接拼后缀；标签频道（如「同人」）按标题在 channelInfo 里查。 */
async function resolveFlowId(topicId, channel, tagName) {
  if (channel !== "tag") return `${topicId}${SUPERTOPIC_SORTS[channel] || SUPERTOPIC_SORTS.latest}`;
  const json = await fetchSupertopicPage(`containerid=${topicId}${SUPERTOPIC_SORTS.latest}`);
  const channels = Array.isArray(json?.channelInfo?.channels) ? json.channelInfo.channels : [];
  const want = str(tagName).trim();
  const hit = channels.find((c) => str(c?.title).trim() === want);
  if (!hit?.flowId) {
    const titles = channels.map((c) => str(c?.title)).filter(Boolean).join("、");
    throw new Error(`超话里没有「${want}」频道。可选频道：${titles || "（无）"}`);
  }
  return str(hit.flowId);
}

async function fetchSupertopicPage(query) {
  const json = await fetchJson(`${SUPERTOPIC_API}?${query}`, XHR);
  // 超话不存在时 HTTP 200 + {code:310105, msg:"超话不存在"}
  if (!Array.isArray(json?.items)) throw new Error(`超话接口：${str(json?.msg) || "返回结构异常"}`);
  return json;
}

export async function* supertopicSource(topicId, channel, tagName) {
  const flowId = await resolveFlowId(topicId, channel, tagName);
  let query = `containerid=${encodeURIComponent(flowId)}`;
  for (let page = 1; ; page += 1) {
    const json = await fetchSupertopicPage(query);
    if (page === 1) console.log(`[weibo] 超话「${str(json?.header?.data?.nick) || topicId}」频道 ${flowId.slice(topicId.length)}`);
    const feeds = json.items.filter((x) => x?.category === "feed" && x?.data?.id).map((x) => x.data);
    console.log(`[weibo] 超话第 ${page} 页：${feeds.length} 条`);
    for (const mblog of feeds) yield { mblog };
    const more = json?.moreInfo?.params;
    if (feeds.length === 0 || !more) return;
    query = `containerid=${encodeURIComponent(flowId)}&${Object.entries(more)
      .map(([k, v]) => `${k}=${encodeURIComponent(str(v))}`)
      .join("&")}`;
    await pause(PAGE_DELAY_MS);
  }
}

/**
 * 关键词搜索：s.weibo.com 只有 HTML，只从中抽 mid（页面顺序），再逐条拉 statuses/show。
 * 最多 50 页；某页没有新 mid 时停止（第 51 页起会回绕）。
 */
export async function* searchSource(keyword, sort, originalOnly, startDate, endDate) {
  const params = [`q=${encodeURIComponent(keyword)}`, "haspic=1"];
  if (sort === "hot") params.push("xsort=hot");
  if (originalOnly) params.push("scope=ori");
  if (startDate || endDate) {
    const from = startDate ? `${startDate}-0` : "";
    const to = endDate ? `${endDate}-23` : "";
    params.push(`timescope=custom:${from}:${to}`);
  }
  const seen = new Set();
  for (let page = 1; page <= SEARCH_MAX_PAGE; page += 1) {
    const html = await fetchHtml(`${SEARCH_URL}?${params.join("&")}&page=${page}`);
    const mids = [...new Set([...html.matchAll(/\bmid="(\d+)"/g)].map((x) => x[1]))].filter((mid) => !seen.has(mid));
    console.log(`[weibo] 搜索第 ${page} 页：${mids.length} 条`);
    if (mids.length === 0) {
      if (page === 1 && !/card-no-result/.test(html)) {
        warn("[weibo] 搜索页没有解析到结果，可能触发了风控验证，可稍后在畅游打开 s.weibo.com 确认");
      }
      return;
    }
    for (const mid of mids) seen.add(mid);
    yield* postsByMids(mids);
    if (!/class="next"/.test(html)) return;
    await pause(PAGE_DELAY_MS);
  }
}

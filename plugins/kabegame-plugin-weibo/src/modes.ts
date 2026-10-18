// 各模式的微博来源：都是 async generator，逐条产出 { mblog, retweetedBy? }，
// 由入口统一做去重、计数上限与进度。按需拉取——到上限后不再请求下一页或下一条详情。
import {
  IMAGE_WALL_API, MYMBLOG_API, PAGE_DELAY_MS, POST_DELAY_MS, PROFILE_INFO_API, SEARCH_MAX_PAGE, SEARCH_URL,
  SUPERTOPIC_API, SUPERTOPIC_SORTS,
} from "./consts";
import { t } from "./i18n";
import { fetchPost } from "./post";
import type {
  WeiboImageWallResponse,
  WeiboMblog,
  WeiboProfileResponse,
  WeiboSource,
  WeiboSupertopicChannel,
  WeiboSupertopicItem,
  WeiboSupertopicResponse,
  WeiboTimelineResponse,
  WeiboUser,
} from "./types";
import { LoginError, errorMessage, fetchHtml, fetchJson, parseUserInput, pause, str } from "./util";

const { warn } = Kabegame;
const XHR = { "X-Requested-With": "XMLHttpRequest" };

/** 用户输入 → 微博用户对象（含 idstr / screen_name）。 */
export async function resolveUser(input: unknown): Promise<WeiboUser> {
  const parsed = parseUserInput(input);
  if (!parsed) throw new Error(t("userRequired"));
  const query = "uid" in parsed
    ? `uid=${parsed.uid}`
    : "custom" in parsed
      ? `custom=${encodeURIComponent(parsed.custom)}`
      : `screen_name=${encodeURIComponent(parsed.screenName)}`;
  let json: WeiboProfileResponse;
  try {
    json = await fetchJson<WeiboProfileResponse>(`${PROFILE_INFO_API}?${query}`);
  } catch (e) {
    if (e instanceof LoginError) throw e;
    throw new Error(t("userNotFoundWithReason", { name: str(input).trim(), reason: errorMessage(e) }));
  }
  const user = json?.data?.user;
  if (!user?.idstr && !user?.id) throw new Error(t("userNotFound", { name: str(input).trim() }));
  return user;
}

/** 逐个 mid 拉详情；单条失败（已删除、仅粉丝可见等）跳过。 */
async function* postsByMids(mids: string[]): WeiboSource {
  for (const mid of mids) {
    try {
      const mblog = await fetchPost(mid);
      if (mblog?.ok === 0 || !mblog?.id) {
        warn(t("postSkippedNotVisible", {
          id: mid,
          reason: str(mblog?.message || mblog?.msg) || t("deletedOrNoPermission"),
        }));
      } else {
        yield { mblog };
      }
    } catch (e) {
      if (e instanceof LoginError) throw e;
      warn(t("postDetailFailed", { id: mid, reason: errorMessage(e) }));
    }
    await pause(POST_DELAY_MS);
  }
}

/** 用户相册（图片墙）：同一条微博的多张图在墙上相邻，按 mid 分组后逐条拉详情。 */
export async function* albumSource(uid: string): WeiboSource {
  let since = "0";
  const seen = new Set<string>();
  for (let page = 1; ; page += 1) {
    const json = await fetchJson<WeiboImageWallResponse>(
      `${IMAGE_WALL_API}?uid=${uid}&sinceid=${encodeURIComponent(since)}&has_album=true`,
    );
    const data = json?.data;
    const list = Array.isArray(data?.list) ? data.list : [];
    const mids: string[] = [];
    for (const item of list) {
      const mid = str(item?.mid);
      if (mid && !seen.has(mid)) {
        seen.add(mid);
        mids.push(mid);
      }
    }
    console.log(t("albumPage", { page, images: list.length, mids: mids.length }));
    yield* postsByMids(mids);
    since = str(data?.since_id);
    if (list.length === 0 || !since || since === "0") return;
    await pause(PAGE_DELAY_MS);
  }
}

/** 用户时间线：转发默认跳过；开启时产出被转发的原帖并记下转发者。 */
export async function* timelineSource(uid: string, feature: number, includeRetweets: boolean): WeiboSource {
  for (let page = 1; ; page += 1) {
    const json = await fetchJson<WeiboTimelineResponse>(
      `${MYMBLOG_API}?uid=${uid}&page=${page}&feature=${feature}`,
    );
    const data = json?.data;
    const list: WeiboMblog[] = Array.isArray(data?.list) ? data.list : [];
    console.log(t("timelinePage", { page, count: list.length }));
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
async function resolveFlowId(topicId: string, channel: string, tagName: unknown): Promise<string> {
  if (channel !== "tag") return `${topicId}${SUPERTOPIC_SORTS[channel] || SUPERTOPIC_SORTS.latest}`;
  const json = await fetchSupertopicPage(`containerid=${topicId}${SUPERTOPIC_SORTS.latest}`);
  const channels: WeiboSupertopicChannel[] = Array.isArray(json?.channelInfo?.channels)
    ? json.channelInfo.channels
    : [];
  const want = str(tagName).trim();
  const hit = channels.find((c) => str(c?.title).trim() === want);
  if (!hit?.flowId) {
    const titles = channels.map((c) => str(c?.title)).filter(Boolean).join(t("listSeparator"));
    throw new Error(t("supertopicChannelMissing", { channel: want, channels: titles || t("none") }));
  }
  return str(hit.flowId);
}

async function fetchSupertopicPage(
  query: string,
): Promise<WeiboSupertopicResponse & { items: WeiboSupertopicItem[] }> {
  const json = await fetchJson<WeiboSupertopicResponse>(`${SUPERTOPIC_API}?${query}`, XHR);
  const items = json?.items;
  // 超话不存在时 HTTP 200 + {code:310105, msg:"超话不存在"}
  if (!Array.isArray(items)) {
    throw new Error(t("supertopicApiError", { message: str(json?.msg) || t("abnormalStructure") }));
  }
  // 断言只发生在站点 JSON 边界：上面已确认 items 是数组
  return json as WeiboSupertopicResponse & { items: WeiboSupertopicItem[] };
}

export async function* supertopicSource(topicId: string, channel: string, tagName: unknown): WeiboSource {
  const flowId = await resolveFlowId(topicId, channel, tagName);
  let query = `containerid=${encodeURIComponent(flowId)}`;
  for (let page = 1; ; page += 1) {
    const json = await fetchSupertopicPage(query);
    if (page === 1) {
      console.log(t("supertopicChannel", {
        topic: str(json?.header?.data?.nick) || topicId,
        channel: flowId.slice(topicId.length),
      }));
    }
    const feeds = json.items.filter((x) => x?.category === "feed" && x?.data?.id).map((x) => x.data);
    console.log(t("supertopicPage", { page, count: feeds.length }));
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
export async function* searchSource(
  keyword: string,
  sort: string,
  originalOnly: boolean,
  startDate: string,
  endDate: string,
): WeiboSource {
  const params = [`q=${encodeURIComponent(keyword)}`, "haspic=1"];
  if (sort === "hot") params.push("xsort=hot");
  if (originalOnly) params.push("scope=ori");
  if (startDate || endDate) {
    const from = startDate ? `${startDate}-0` : "";
    const to = endDate ? `${endDate}-23` : "";
    params.push(`timescope=custom:${from}:${to}`);
  }
  const seen = new Set<string>();
  for (let page = 1; page <= SEARCH_MAX_PAGE; page += 1) {
    const html = await fetchHtml(`${SEARCH_URL}?${params.join("&")}&page=${page}`);
    const mids = [...new Set([...html.matchAll(/\bmid="(\d+)"/g)].map((x) => x[1]))].filter((mid) => !seen.has(mid));
    console.log(t("searchPage", { page, count: mids.length }));
    if (mids.length === 0) {
      if (page === 1 && !/card-no-result/.test(html)) {
        warn(t("searchNoResult"));
      }
      return;
    }
    for (const mid of mids) seen.add(mid);
    yield* postsByMids(mids);
    if (!/class="next"/.test(html)) return;
    await pause(PAGE_DELAY_MS);
  }
}

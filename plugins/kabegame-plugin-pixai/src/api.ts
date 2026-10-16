// @ts-nocheck
// PixAI GraphQL 访问层：固定请求头、查询 URL 拼装，以及作品详情/评论两个点查。
//
// PixAI 的 GraphQL 走 GET + query string（operation/variables/query 全塞进 URL），
// 所以这里没有 POST body，只有 buildGraphqlUrl。
import { ARTWORK_DETAIL_QUERY, API_URL, MESSAGES_QUERY, OPERATION_GET_ARTWORK_DETAIL, OPERATION_MESSAGES, REQUEST_HEADERS } from "./consts";
import { arrayValue, coerceStr, log } from "./util";

const { setHeader } = Kabegame;

export function setRequestHeaders() {
  for (const [key, value] of Object.entries(REQUEST_HEADERS)) {
    setHeader(key, value);
  }
}

export function buildGraphqlUrl(operation, variables, query) {
  const params = new URLSearchParams();
  params.set("operation", operation);
  params.set("operationName", operation);
  params.set("variables", JSON.stringify(variables));
  params.set("query", query);
  return `${API_URL}?${params.toString()}`;
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
}

export async function fetchGraphql(operation, variables, query) {
  setHeader("x-apollo-operation-name", operation);
  return fetchJson(buildGraphqlUrl(operation, variables, query));
}

export async function fetchPixaiComments(artworkId) {
  const artworkIdStr = coerceStr(artworkId);
  if (!artworkIdStr) return [];

  try {
    const res = await fetchGraphql(
      OPERATION_MESSAGES,
      { topicId: artworkIdStr, last: 20 },
      MESSAGES_QUERY,
    );
    const edges = arrayValue(res?.data?.messages?.edges);
    return edges.map((edge) => edge?.node).filter(Boolean);
  } catch {
    log(`[PixAI] 评论获取失败，artwork_id=${artworkIdStr}`, "warn");
    return [];
  }
}

export async function fetchPixaiArtworkDetail(artworkId) {
  const artworkIdStr = coerceStr(artworkId);
  if (!artworkIdStr) return null;

  try {
    const res = await fetchGraphql(
      OPERATION_GET_ARTWORK_DETAIL,
      { id: artworkIdStr },
      ARTWORK_DETAIL_QUERY,
    );
    return res?.data?.artwork || null;
  } catch {
    log(`[PixAI] 作品详情获取失败，artwork_id=${artworkIdStr}`, "warn");
    return null;
  }
}

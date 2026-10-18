// PixAI GraphQL 访问层：固定请求头、查询 URL 拼装，以及作品详情/评论两个点查。
//
// PixAI 的 GraphQL 走 GET + query string（operation/variables/query 全塞进 URL），
// 所以这里没有 POST body，只有 buildGraphqlUrl。
import { ARTWORK_DETAIL_QUERY, API_URL, MESSAGES_QUERY, OPERATION_GET_ARTWORK_DETAIL, OPERATION_MESSAGES, REQUEST_HEADERS } from "./consts";
import type {
  GetArtworkDetailResponse,
  ListMessagesResponse,
  PixaiArtworkDetail,
  PixaiComment,
  PixaiMessageEdge,
} from "./types";
import { arrayValue, coerceStr, log } from "./util";
import { t } from "./i18n";

const { setHeader } = Kabegame;

export function setRequestHeaders(): void {
  for (const [key, value] of Object.entries(REQUEST_HEADERS)) {
    setHeader(key, value);
  }
}

export function buildGraphqlUrl(
  operation: string,
  variables: Record<string, unknown>,
  query: string,
): string {
  const params = new URLSearchParams();
  params.set("operation", operation);
  params.set("operationName", operation);
  params.set("variables", JSON.stringify(variables));
  params.set("query", query);
  return `${API_URL}?${params.toString()}`;
}

export async function fetchJson<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }
  // 响应体是外部 JSON，断言只发生在这一层边界上
  return (await response.json()) as T;
}

export async function fetchGraphql<T = unknown>(
  operation: string,
  variables: Record<string, unknown>,
  query: string,
): Promise<T> {
  setHeader("x-apollo-operation-name", operation);
  return fetchJson<T>(buildGraphqlUrl(operation, variables, query));
}

export async function fetchPixaiComments(artworkId: unknown): Promise<PixaiComment[]> {
  const artworkIdStr = coerceStr(artworkId);
  if (!artworkIdStr) return [];

  try {
    const res = await fetchGraphql<ListMessagesResponse>(
      OPERATION_MESSAGES,
      { topicId: artworkIdStr, last: 20 },
      MESSAGES_QUERY,
    );
    const edges = arrayValue<PixaiMessageEdge>(res?.data?.messages?.edges);
    return edges
      .map((edge) => edge?.node)
      .filter((node): node is PixaiComment => Boolean(node));
  } catch {
    log(t("commentsFailed", { artworkId: artworkIdStr }), "warn");
    return [];
  }
}

export async function fetchPixaiArtworkDetail(artworkId: unknown): Promise<PixaiArtworkDetail | null> {
  const artworkIdStr = coerceStr(artworkId);
  if (!artworkIdStr) return null;

  try {
    const res = await fetchGraphql<GetArtworkDetailResponse>(
      OPERATION_GET_ARTWORK_DETAIL,
      { id: artworkIdStr },
      ARTWORK_DETAIL_QUERY,
    );
    return res?.data?.artwork || null;
  } catch {
    log(t("artworkDetailFailed", { artworkId: artworkIdStr }), "warn");
    return null;
  }
}

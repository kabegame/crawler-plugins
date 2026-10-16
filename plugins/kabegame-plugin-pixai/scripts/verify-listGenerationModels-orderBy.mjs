#!/usr/bin/env node
/**
 * 验证 PixAI `listGenerationModels`：站点默认的降序 orderBy（`-字段`）与「倒序」升序（去掉 `-`）是否均被服务端接受。
 *
 * 用法：
 *   node scripts/verify-listGenerationModels-orderBy.mjs
 *   PIXAI_AUTHORIZATION="Bearer <token>" node scripts/verify-listGenerationModels-orderBy.mjs
 *   PIXAI_PQ_HASH=<sha256> node scripts/verify-listGenerationModels-orderBy.mjs
 *
 * 在插件目录下执行时：
 *   node ./scripts/verify-listGenerationModels-orderBy.mjs
 */

const BASE = "https://api.pixai.art/graphql";
const OP = "listGenerationModels";

/** 与当前站点抓包一致；失败时可换文档 §6 旧哈希或自行从 Network 复制 */
const DEFAULT_PQ_HASH =
  process.env.PIXAI_PQ_HASH ||
  "1658f8e716184e95d3177d20fad189d8f7b250fb30e8401496ed0aaf34e4ad83";

const EXTENSIONS = {
  clientLibrary: { name: "@apollo/client", version: "4.1.4" },
  persistedQuery: { version: 1, sha256Hash: DEFAULT_PQ_HASH },
};

function buildUrl(variables) {
  const vars = JSON.stringify(variables);
  const ext = JSON.stringify(EXTENSIONS);
  return (
    `${BASE}?operation=${encodeURIComponent(OP)}` +
    `&operationName=${encodeURIComponent(OP)}` +
    `&variables=${encodeURIComponent(vars)}` +
    `&extensions=${encodeURIComponent(ext)}`
  );
}

async function probe(label, variables) {
  const url = buildUrl(variables);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-apollo-operation-name": OP,
    Origin: "https://pixai.art",
    Referer: "https://pixai.art/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
  const auth = process.env.PIXAI_AUTHORIZATION;
  if (auth) headers.Authorization = auth;

  const res = await fetch(url, { headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _parseError: true, _rawPreview: text.slice(0, 400) };
  }

  const edges = body?.data?.generationModels?.edges;
  const ok = res.ok && Array.isArray(edges);

  const row = {
    label,
    variables,
    httpStatus: res.status,
    ok,
    edgeCount: edges?.length ?? null,
    firstId: edges?.[0]?.node?.id ?? null,
    errors: body?.errors ?? null,
  };
  console.log(JSON.stringify(row, null, 2));
  return { ok, firstId: row.firstId, secondId: edges?.[1]?.node?.id ?? null };
}

/** 人气 / 生成人气 / 最新：各跑一对 降序 vs 升序（倒序） */
const cases = [
  ["人气-降序", { feed: "meilisearch", orderBy: "-markInfo.likedCount", first: 24 }],
  ["人气-升序(倒序)", { feed: "meilisearch", orderBy: "markInfo.likedCount", first: 24 }],
  ["生成人气-降序", { feed: "meilisearch", orderBy: "-markInfo.refCount", first: 24 }],
  ["生成人气-升序(倒序)", { feed: "meilisearch", orderBy: "markInfo.refCount", first: 24 }],
  ["最新-降序", { feed: "latest", orderBy: "-createdAt", last: 24 }],
  ["最新-升序(倒序)", { feed: "latest", orderBy: "createdAt", last: 24 }],
];

async function main() {
  console.error(
    `[verify] PQ hash: ${EXTENSIONS.persistedQuery.sha256Hash.slice(0, 16)}… auth: ${process.env.PIXAI_AUTHORIZATION ? "yes" : "no"}\n`
  );

  const results = [];
  for (const [label, vars] of cases) {
    const r = await probe(label, vars);
    results.push({ label, ...r });
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  const pairs = [
    ["人气-降序", "人气-升序(倒序)"],
    ["生成人气-降序", "生成人气-升序(倒序)"],
    ["最新-降序", "最新-升序(倒序)"],
  ];
  console.error("\n--- 首尾 id 对比（升序若打通，通常应与降序不同）---");
  for (const [a, b] of pairs) {
    const ra = results.find((x) => x.label === a);
    const rb = results.find((x) => x.label === b);
    if (!ra || !rb) continue;
    console.error(
      `${a} vs ${b}: firstId 相同? ${ra.firstId === rb.firstId} | ` +
        `降序首=${ra.firstId ?? "null"} 升序首=${rb.firstId ?? "null"}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

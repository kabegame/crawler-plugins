// 路由对照测试：fixtures/routes-*.expected.json 是 hydrus 本体 NetworkDomainManager.GetURLToFetchAndParser 的结果
// （URL class 匹配、规范化、参数默认值、API 转换链、解析器自动关联），由 fixtures/hydrus_route.py 生成。
import { unzlibSync } from "fflate";
import { loadHydrusPng } from "../src/hydrus/serialisable/index.js";
import { T } from "../src/hydrus/serialisable/core.js";
import { DomainManager } from "../src/hydrus/runtime/url.js";

const fixtures = new URL("./fixtures/", import.meta.url);
const byType = (objects: any[]) => ({ urlClasses: objects.filter((o) => o[0] === T.URL_CLASS), parsers: objects.filter((o) => o[0] === T.PAGE_PARSER) });

for (const name of ["wallhaven-2023-01-11", "derpibooru-2021-03-20", "zerochan-2025-05-03", "flickr-2021-12-28"]) {
  Deno.test(`${name}：请求地址与解析器和 hydrus 一致`, async () => {
    const { objects } = await loadHydrusPng(await Deno.readFile(new URL(`${name}.png`, fixtures)), { inflate: unzlibSync });
    const domains = new DomainManager(byType(objects));
    const expected: [string, string | null, string][] = JSON.parse(await Deno.readTextFile(new URL(`routes-${name}.expected.json`, fixtures)));
    const failures: string[] = [];
    for (const [url, wantUrl, wantParser] of expected) {
      const t = domains.fetchTarget(url);
      const got = t ? [t.url, t.parser?.[1] ?? null] : [null, null];
      const want = wantUrl === null ? [null, null] : [wantUrl, wantParser];
      if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${url}\n  期望 ${JSON.stringify(want)}\n  实际 ${JSON.stringify(got)}`);
    }
    if (failures.length > 0) throw new Error(failures.join("\n"));
  });
}

Deno.test("URL 参数默认值覆盖：替换、去掉", async () => {
  const { objects } = await loadHydrusPng(await Deno.readFile(new URL("wallhaven-2023-01-11.png", fixtures)), { inflate: unzlibSync });
  const domains = new DomainManager(byType(objects), new Map([["apikey", ""], ["purity", "100"]]));
  const got = [domains.fetchTarget("https://wallhaven.cc/api/v1/search?q=cute")?.url, domains.fetchTarget("https://wallhaven.cc/w/d8vrwm")?.url];
  const want = ["https://wallhaven.cc/api/v1/search?categories=111&order=desc&page=1&purity=100&q=cute&sorting=date_added", "https://wallhaven.cc/api/v1/w/d8vrwm"];
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`期望 ${JSON.stringify(want)}\n实际 ${JSON.stringify(got)}`);
});

// 升级链对照测试：fixtures 里的 *.upgraded.json 是 hydrus 本体（v690）读入 png 后再导出的结果，
// 由 fixtures/decode_hydrus_png.py 生成：
//   cd <hydrus 源码> && venv/bin/python -I <本目录>/fixtures/decode_hydrus_png.py <png> <输出目录> "$PWD"
import { unzlibSync } from "fflate";
import { load, loadDownloaderObjects } from "../src/hydrus/serialisable/core.js";
import "../src/hydrus/serialisable/index.js";
import { loadStringFromHydrusPng } from "../src/hydrus/serialisable/png.js";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) throw new Error(`期望 ${expectedJson.slice(0, 400)}…，实际 ${actualJson.slice(0, 400)}…`);
}

const fixtures = new URL("./fixtures/", import.meta.url);
const cases = [
  "wallhaven-2020-03-01",
  "danbooru-2026-09-29",
  // API 转换、JSON / COMPOUND / CONTEXT_VARIABLE 公式的 v2、v3 升级
  "wallhaven-2023-01-11",
  // STATIC 公式、conversion 10
  "zerochan-2025-05-03",
  // NESTED 公式
  "imgchest-2024-12-04",
  // 子页面解析器、JSON 公式、SerialisableList v1
  "derpibooru-2021-03-20",
  // 单个 PageParser：JSON v1、Zipper v1、ContextVariable v1、ContentParser v2、HTML 规则 v1，hydrus 默认对象里最老的一批
  "4chan-thread-api-parser",
  // StringSplitter v2 + StringSlicer
  "gelbooru-0.2.5-file-page-parser",
  // StringSplitter v1（分隔符里的反斜杠要转义）
  "lofter-2023-02-23",
  "pawoo-2021-07-24",
];
const strictCtx = () => {
  const warnings: string[] = [];
  return {
    warnings,
    ctx: {
      warn: (m: string) => warnings.push(m),
      generateKey: () => {
        throw new Error("不应生成新 key");
      },
    },
  };
};

for (const name of cases) {
  Deno.test(`${name}：升级结果与 hydrus 一致`, async () => {
    const png = await Deno.readFile(new URL(`${name}.png`, fixtures));
    const raw = JSON.parse(await loadStringFromHydrusPng(png, { inflate: unzlibSync }));
    const expected = JSON.parse(await Deno.readTextFile(new URL(`${name}.upgraded.json`, fixtures)));
    const { warnings, ctx } = strictCtx();
    assertEquals(load(raw, ctx), expected);
    assertEquals(warnings, []);
  });

  Deno.test(`${name}：对当前版本幂等`, async () => {
    const expected = JSON.parse(await Deno.readTextFile(new URL(`${name}.upgraded.json`, fixtures)));
    assertEquals(load(structuredClone(expected), strictCtx().ctx), expected);
  });

  Deno.test(`${name}：逐项加载与整体加载一致`, async () => {
    const expected = JSON.parse(await Deno.readTextFile(new URL(`${name}.upgraded.json`, fixtures)));
    const { objects, skipped } = loadDownloaderObjects(expected, strictCtx().ctx);
    assertEquals(skipped, []);
    assertEquals(objects, expected[0] === 26 ? expected[2].map(([, o]: [number, unknown]) => o) : [expected]);
  });
}

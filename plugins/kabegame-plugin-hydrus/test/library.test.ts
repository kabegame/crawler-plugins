// 下载器库合并对照测试：fixtures/import-sequence.expected.json 是 hydrus 本体依次导入同一组 png 后的
// domain manager 状态（fixtures/hydrus_import.py 生成）。覆盖重复跳过、旧 URL class 改名、重名加后缀、
// 解析器示例 URL 合并、关联重算、NGUG 按名字找回子 GUG、域名请求头与带宽规则。
import { unzlibSync } from "fflate";
import { defaultContext, infoOf, T } from "../src/hydrus/serialisable/core.js";
import { loadHydrusPng } from "../src/hydrus/serialisable/index.js";
import { DownloaderLibrary } from "../src/hydrus/library.js";
import { generateGalleryUrl } from "../src/hydrus/runtime/url.js";

const fixtures = new URL("./fixtures/", import.meta.url);
const ctx = { ...defaultContext(), warn: () => {} };
/** 与 Python 的 sorted 一致：列表逐项比较 */
const byJson = (a: unknown, b: unknown): number => {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = byJson(a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  return (a as any) < (b as any) ? -1 : (a as any) > (b as any) ? 1 : 0;
};
const keyOf = (t: any[]) => (t[0] === T.PAGE_PARSER ? (infoOf(t) as any[])[1] : (infoOf(t) as any[])[0]);

/** 与 hydrus_import.py 相同的输出形状 */
function describe(lib: DownloaderLibrary, steps: { png: string; duplicates: number }[]) {
  const ucNames = new Map(lib.urlClasses.map((u) => [keyOf(u), u[1]]));
  const parserNames = new Map(lib.parsers.map((p) => [keyOf(p), p[1]]));
  const headers: Record<string, string[][]> = {};
  const bandwidth: Record<string, number[][]> = {};
  for (const [domain, { headers: h, bandwidthRules }] of [...lib.domains].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (h) headers[domain] = h.map(([k, v]) => [k, v]).sort(byJson);
    if (bandwidthRules) bandwidth[domain] = (infoOf(bandwidthRules) as number[][]).map((r) => [...r]).sort(byJson);
  }
  return {
    steps,
    gugs: lib.gugs.map((g) =>
      g[0] === T.NESTED_GALLERY_URL_GENERATOR
        ? [g[1], (infoOf(g) as any[])[2].map((kn: [string, string]) => lib.getGug(kn)?.[1] ?? null)]
        // GalleryURLGenerator.GetExampleURL
        : [g[1], generateGalleryUrl(g, (infoOf(g) as any[])[5])],
    ),
    urlClasses: lib.urlClasses.map((u) => u[1]),
    parsers: lib.parsers.map((p) => [p[1], [...(infoOf(p) as any[])[5]].sort()]),
    links: [...lib.links].map(([k, v]) => [ucNames.get(k), parserNames.get(v)]).sort(byJson),
    headers,
    bandwidth,
  };
}

Deno.test("依次导入一组 png：库的状态与 hydrus 一致", async () => {
  const expected = JSON.parse(await Deno.readTextFile(new URL("import-sequence.expected.json", fixtures)));
  const lib = new DownloaderLibrary();
  const steps = [];
  for (const { png } of expected.steps) {
    const { objects } = await loadHydrusPng(await Deno.readFile(new URL(png, fixtures)), { inflate: unzlibSync, ctx });
    const report = lib.importObjects(objects, { ctx });
    steps.push({ png, duplicates: report.duplicates });
  }
  // 存盘再读回，结果不变
  const reloaded = DownloaderLibrary.fromJSON(JSON.parse(JSON.stringify(lib.toJSON())), ctx);
  for (const [what, l] of [["导入后", lib], ["存盘读回后", reloaded]] as const) {
    const got = describe(l, steps);
    const failures = Object.keys(expected).filter((k) => JSON.stringify(got[k as keyof typeof got]) !== JSON.stringify(expected[k]));
    if (failures.length > 0) {
      throw new Error(failures.map((k) => `${what} ${k}\n  期望 ${JSON.stringify(expected[k])}\n  实际 ${JSON.stringify(got[k as keyof typeof got])}`).join("\n"));
    }
  }
});

Deno.test("NGUG 展开成库里的子 GUG", async () => {
  const lib = new DownloaderLibrary();
  const { objects } = await loadHydrusPng(await Deno.readFile(new URL("newgrounds-2021-03-22.png", fixtures)), { inflate: unzlibSync, ctx });
  lib.importObjects(objects, { ctx });
  const ngug = lib.findGug("Newgrounds Artist Lookup")!;
  const subs = lib.expandGug(ngug).map((g) => g[1]);
  const want = ["newgrounds artist art lookup", "newgrounds artist games lookup", "newgrounds artist movies lookup"];
  if (JSON.stringify(subs) !== JSON.stringify(want)) throw new Error(`期望 ${JSON.stringify(want)}\n实际 ${JSON.stringify(subs)}`);
});

Deno.test("来源自带的关联在两边都新导入时沿用", async () => {
  const { objects } = await loadHydrusPng(await Deno.readFile(new URL("danbooru-2026-09-29.png", fixtures)), { inflate: unzlibSync, ctx });
  const uc = objects.find((o) => o[0] === T.URL_CLASS && o[1] === "danbooru.donmai.us gallery page")!;
  const parser = objects.find((o) => o[0] === T.PAGE_PARSER && o[1] === "danbooru.donmai.us file page parser")!;
  const lib = new DownloaderLibrary();
  lib.importObjects(objects, { ctx, links: [[keyOf(uc), keyOf(parser)]] });
  const ucKey = keyOf(lib.urlClasses.find((u) => u[1] === uc[1])!);
  const linked = lib.parsers.find((p) => keyOf(p) === lib.links.get(ucKey))?.[1];
  if (linked !== parser[1]) throw new Error(`期望关联到 ${parser[1]}，实际 ${linked}`);
});

Deno.test("GUG 名带首尾空格时也能按名字选中", () => {
  const lib = new DownloaderLibrary({
    gugs: [[T.GALLERY_URL_GENERATOR, "erocurves.com model-search ", 1, ["00", "https://x.com/?q=%tags%", "%tags%", "+", "", "a"]]],
  });
  for (const name of ["erocurves.com model-search", "erocurves.com model-search ", "EROCURVES.COM model-search"]) {
    if (lib.findGug(name)?.[1] !== "erocurves.com model-search ") throw new Error(`"${name}" 没有选中`);
  }
});

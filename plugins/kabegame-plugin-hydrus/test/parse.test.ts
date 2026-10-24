// 解析对照测试：fixtures/pages 里的 *.expected.json 是 hydrus 本体（v690）的 PageParser 对同一份 HTML 的解析结果，
// 由 fixtures/hydrus_parse.py 生成。HTML 用与插件运行时相同版本的 deno-dom 解析。
import { DOMParser } from "jsr:@b-fuze/deno-dom@0.1.56";
import { unzlibSync } from "fflate";
import { loadHydrusPng } from "../src/hydrus/serialisable/index.js";
import { parsePage } from "../src/hydrus/runtime/parsing.js";

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

function assertEquals(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n期望 ${e.slice(0, 600)}\n实际 ${a.slice(0, 600)}`);
}

const fixtures = new URL("./fixtures/", import.meta.url);
type Case = { png: string; parser: string; context: Record<string, string>; page: string };
const cases: Case[] = [
  // HTML 公式
  { png: "danbooru-2026-09-29", parser: "danbooru.donmai.us file page parser", context: { url: "https://danbooru.donmai.us/posts/2982422" }, page: "danbooru-post-2982422.html" },
  { png: "danbooru-2026-09-29", parser: "danbooru.donmai.us gallery page parser", context: { url: "https://danbooru.donmai.us/posts?page=1&tags=touhou" }, page: "danbooru-list-touhou.html" },
  // JSON / COMPOUND / CONTEXT_VARIABLE；context 与 hydrus GallerySeed / FileSeed 给的一致
  {
    png: "wallhaven-2023-01-11",
    parser: "wallhaven.cc gallery parser",
    context: {
      gallery_url: "https://wallhaven.cc/api/v1/search?q=cute",
      url: "https://wallhaven.cc/api/v1/search?apikey=myPersonalApiToken&categories=111&order=desc&page=1&purity=111&q=cute&sorting=date_added",
      post_index: "0",
    },
    page: "wallhaven-api-search-cute.json",
  },
  {
    png: "wallhaven-2023-01-11",
    parser: "wallhaven.cc post parser",
    context: { post_url: "https://wallhaven.cc/w/d8vrwm", url: "https://wallhaven.cc/api/v1/w/d8vrwm?apikey=myPersonalApiToken" },
    page: "wallhaven-api-post-d8vrwm.json",
  },
  // STATIC 公式、conversion 10（本机时区，需 TZ=UTC）
  {
    png: "zerochan-2025-05-03",
    parser: "zerochan.net gallery parser",
    context: { gallery_url: "https://www.zerochan.net/Hatsune+Miku?p=1", url: "https://www.zerochan.net/Hatsune+Miku?p=1", post_index: "0" },
    page: "zerochan-list-hatsune-miku.html",
  },
  { png: "zerochan-2025-05-03", parser: "zerochan.net post parser", context: { post_url: "https://www.zerochan.net/3248583", url: "https://www.zerochan.net/3248583" }, page: "zerochan-post-3248583.html" },
  // 子页面解析器 + JSON + conversion 10（带 %z）
  {
    png: "derpibooru-2021-03-20",
    parser: "derpibooru gallery page parser",
    context: {
      gallery_url: "https://www.derpibooru.org/api/v1/json/search/images?filter_id=56027&page=1&per_page=50&q=safe,cute",
      url: "https://derpibooru.org/api/v1/json/search/images?filter_id=56027&page=1&per_page=50&q=safe,cute",
      post_index: "0",
    },
    page: "derpibooru-search-safe-cute.json",
  },
  // NESTED 公式：HTML 里取出 JSON 再解析
  { png: "imgchest-2024-12-04", parser: "imgchest post", context: { post_url: "https://imgchest.com/p/69rydv2dykz", url: "https://imgchest.com/p/69rydv2dykz" }, page: "imgchest-post-69rydv2dykz.html" },
  // StringSplitter 拆标签
  {
    png: "gelbooru-0.2.5-file-page-parser",
    parser: "gelbooru 0.2.5 file page parser",
    context: { post_url: "https://gelbooru.com/index.php?page=post&s=view&id=15122881", url: "https://gelbooru.com/index.php?id=15122881&page=post&s=view" },
    page: "gelbooru-post-15122881.html",
  },
  // 多个子页面解析器、COMPOUND、CONTEXT_VARIABLE（post_index）
  {
    png: "4chan-thread-api-parser",
    parser: "4chan thread api parser",
    context: { post_url: "https://a.4cdn.org/wg/thread/8146419.json", url: "https://a.4cdn.org/wg/thread/8146419.json" },
    page: "4chan-wg-thread-8146419.json",
  },
];

Deno.test("解析对照在 UTC 下运行", () => {
  // 日期转换按本机时区解释时结果随时区变化，金标在 TZ=UTC 下生成
  if (new Date(2020, 0, 1).getTimezoneOffset() !== 0) throw new Error("请用 TZ=UTC deno test 运行");
});

for (const c of cases) {
  Deno.test(`${c.page}：解析结果与 hydrus 一致`, async () => {
    const { objects } = await loadHydrusPng(await Deno.readFile(new URL(`${c.png}.png`, fixtures)), { inflate: unzlibSync });
    const parser = objects.find((o: unknown[]) => o[0] === 58 && o[1] === c.parser);
    const text = await Deno.readTextFile(new URL(`pages/${c.page}`, fixtures));
    const expected: Record<string, unknown>[] = JSON.parse(await Deno.readTextFile(new URL(`pages/${c.page.replace(/\.\w+$/, "")}.expected.json`, fixtures)));
    const actual: Record<string, unknown>[] = parsePage(parser, text, { ...c.context });
    assertEquals(actual.length, expected.length, "post 数");
    expected.forEach((post, i) => {
      for (const key of Object.keys(post)) assertEquals(actual[i][key], post[key], `第 ${i} 个 post 的 ${key}`);
    });
  });
}

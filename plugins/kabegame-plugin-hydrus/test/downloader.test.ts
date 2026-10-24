// GalleryDownloader 的调度：用假网络记录请求，不访问真实站点。
import { unzlibSync } from "fflate";
import { defaultContext } from "../src/hydrus/serialisable/core.js";
import { loadHydrusPng } from "../src/hydrus/serialisable/index.js";
import { DownloaderLibrary } from "../src/hydrus/library.js";
import { GalleryDownloader } from "../src/hydrus/runtime/downloader.js";

const fixtures = new URL("./fixtures/", import.meta.url);
const ctx = { ...defaultContext(), warn: () => {} };

async function libraryOf(...pngs: string[]) {
  const lib = new DownloaderLibrary();
  for (const png of pngs) {
    const { objects } = await loadHydrusPng(await Deno.readFile(new URL(png, fixtures)), { inflate: unzlibSync, ctx });
    lib.importObjects(objects, { ctx });
  }
  return lib;
}

/** wallhaven API 的一页：每页给出一个帖子，meta 里有下一页 */
function wallhavenPage(url: string) {
  const id = `id${new URL(url).searchParams.get("page") ?? "x"}${new URL(url).searchParams.get("q") ?? ""}`;
  return JSON.stringify({ data: [{ id, url: `https://wallhaven.cc/w/${id}`, path: `https://w.wallhaven.cc/full/${id}.jpg` }], meta: { current_page: 1, last_page: 9 } });
}

function fakeIo(respond: (url: string) => string) {
  const fetched: string[] = [];
  const downloaded: string[] = [];
  const warnings: string[] = [];
  return {
    fetched,
    downloaded,
    warnings,
    io: {
      fetchText: (url: string) => {
        fetched.push(url);
        return Promise.resolve(respond(url));
      },
      download: (f: { fileUrl: string }) => {
        downloaded.push(f.fileUrl);
        return Promise.resolve();
      },
      log: () => {},
      warn: (m: string) => warnings.push(m),
      progress: () => {},
      sleep: () => Promise.resolve(),
    },
  };
}

Deno.test("列表页上限按每个起始列表页分别计", async () => {
  const lib = await libraryOf("newgrounds-2021-03-22.png");
  const gugs = lib.expandGug(lib.findGug("newgrounds artist lookup")!);
  const { fetched, io } = fakeIo(() => {
    throw new Error("HTTP 403");
  });
  const d = new GalleryDownloader({ domains: lib.domainManager(), domainPackages: lib.domainPackages() }, { maxPages: 1, maxFiles: 10 }, io);
  await d.run(gugs, "someone");
  const want = ["https://someone.newgrounds.com/art/", "https://someone.newgrounds.com/games/", "https://someone.newgrounds.com/movies/"];
  if (JSON.stringify(fetched) !== JSON.stringify(want)) throw new Error(`期望 ${JSON.stringify(want)}\n实际 ${JSON.stringify(fetched)}`);
});

Deno.test("网址导入：帖子走解析，不认识的地址直接下载，列表页不翻页", async () => {
  const lib = await libraryOf("wallhaven-2023-01-11.png");
  const { fetched, downloaded, io } = fakeIo((url) => {
    if (url.includes("/api/v1/search")) return wallhavenPage(url);
    return JSON.stringify({ data: { id: "abc", url: "https://wallhaven.cc/w/abc", path: "https://w.wallhaven.cc/full/abc.jpg", tags: [] } });
  });
  const d = new GalleryDownloader({ domains: lib.domainManager(new Map([["apikey", ""]])), domainPackages: [] }, { maxPages: 5, maxFiles: 10 }, io);
  await d.runUrls(["https://wallhaven.cc/w/abc", "https://example.com/x.jpg", "https://wallhaven.cc/api/v1/search?q=cat"]);
  const searches = fetched.filter((u) => u.includes("/api/v1/search"));
  if (searches.length !== 1) throw new Error(`列表页应只抓一页，实际 ${JSON.stringify(searches)}`);
  if (!fetched.includes("https://wallhaven.cc/api/v1/w/abc")) throw new Error(`帖子应转成 API 地址请求，实际 ${JSON.stringify(fetched)}`);
  if (!downloaded.includes("https://example.com/x.jpg")) throw new Error(`不认识的地址应直接下载，实际 ${JSON.stringify(downloaded)}`);
});

Deno.test("子列表页另起页数额度：先查 ID 再进列表的下载器在 1 页上限下也能进列表", async () => {
  const lib = await libraryOf("bsky-2025-12-06.png");
  const { fetched, io } = fakeIo((url) => (url.includes("resolveHandle") ? JSON.stringify({ did: "did:plc:abc123" }) : "{}"));
  const d = new GalleryDownloader({ domains: lib.domainManager(), domainPackages: [] }, { maxPages: 1, maxFiles: 5 }, io);
  await d.run(lib.expandGug(lib.findGug("bluesky profile lookup")!), "someone.bsky.social");
  const want = [
    "https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=someone.bsky.social",
    "https://bsky.social/xrpc/com.atproto.repo.listRecords?collection=app.bsky.feed.post&repo=did:plc:abc123",
  ];
  if (JSON.stringify(fetched) !== JSON.stringify(want)) throw new Error(`期望 ${JSON.stringify(want)}\n实际 ${JSON.stringify(fetched)}`);
});

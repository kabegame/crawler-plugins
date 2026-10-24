// 请求头与带宽规则：对照 hydrus 的 ClientDefaults 与 NetworkJob 组装顺序。
import { T } from "../src/hydrus/serialisable/core.js";
import { applicableDomains, DEFAULT_GLOBAL_HEADERS, NetworkRules } from "../src/hydrus/runtime/network.js";

function assertEquals(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`期望 ${e}，实际 ${a}`);
}

Deno.test("适用域名：去 www、从具体到二级域", () => {
  assertEquals(applicableDomains("cdn.donmai.us"), ["cdn.donmai.us", "donmai.us"]);
  assertEquals(applicableDomains("www.example.com"), ["example.com"]);
  assertEquals(applicableDomains("img.example.co.jp"), ["img.example.co.jp", "example.co.jp"]);
  assertEquals(applicableDomains("localhost:8080"), ["localhost:8080"]);
});

const urlClass = (overrides: [string, string][], sendReferralUrl: number) => ({ headerOverrides: new Map(overrides), sendReferralUrl });

Deno.test("请求头：全局默认 → 域名 → URL class → referer", () => {
  const rules = new NetworkRules({
    domainPackages: [[T.DOMAIN_METADATA_PACKAGE, 1, ["donmai.us", [["User-Agent", "pkg-ua", "reason"], ["X-Site", "1", "reason"]], null]]],
    urlClassFor: (u: string) => (u.includes("/posts/") ? urlClass([["X-Site", "2"]], 0) : null),
  });
  assertEquals(rules.headersFor("https://cdn.donmai.us/a.jpg", "https://danbooru.donmai.us/posts/1"), {
    ...DEFAULT_GLOBAL_HEADERS,
    "User-Agent": "pkg-ua",
    "X-Site": "1",
    Referer: "https://danbooru.donmai.us/posts/1",
  });
  assertEquals(rules.headersFor("https://danbooru.donmai.us/posts/1", null), { ...DEFAULT_GLOBAL_HEADERS, "User-Agent": "pkg-ua", "X-Site": "2" });
});

Deno.test("请求头：send_referral_url=never 时不发 referer", () => {
  const rules = new NetworkRules({ domainPackages: [], urlClassFor: () => urlClass([], 1) });
  assertEquals(rules.headersFor("https://example.com/x", "https://example.com/"), DEFAULT_GLOBAL_HEADERS);
});

Deno.test("带宽：同一域名默认每秒 1 次请求", async () => {
  const rules = new NetworkRules({ domainPackages: [], urlClassFor: () => null });
  const slept: number[] = [];
  const sleep = (ms: number) => {
    slept.push(ms);
    return new Promise<void>((r) => setTimeout(r, ms));
  };
  await rules.waitForBandwidth("https://a.example.com/1", sleep);
  await rules.waitForBandwidth("https://b.example.com/2", sleep); // 共享 example.com 上下文
  if (slept.length === 0 || slept[0] < 900) throw new Error(`应等待约 1 秒，实际 ${JSON.stringify(slept)}`);
});

import { labelsFromMetadata, pinyinLabelKey, searchTextsFromMetadata } from "../src/metadata-derived.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) throw new Error(`期望 ${expectedJson}，实际 ${actualJson}`);
}

Deno.test("bilibili 标签使用 tiny-pinyin 生成稳定 key", () => {
  const names = ["二次元", "同人", "玉足", "米哈游", "美图分享", "鸣潮", "崩坏星穹铁道", "次元女"];
  assertEquals(names.map(pinyinLabelKey), [
    "er-ci-yuan",
    "tong-ren",
    "yu-zu",
    "mi-ha-you",
    "mei-tu-fen-xiang",
    "ming-chao",
    "beng-huai-xing-qiong-tie-dao",
    "ci-yuan-nv",
  ]);
  assertEquals(
    labelsFromMetadata({ tags: names.map((name) => ({ name })) }),
    names.map((name, index) => ({
      key: [
        "er-ci-yuan",
        "tong-ren",
        "yu-zu",
        "mi-ha-you",
        "mei-tu-fen-xiang",
        "ming-chao",
        "beng-huai-xing-qiong-tie-dao",
        "ci-yuan-nv",
      ][index],
      category: "bilibili/tag",
      name,
    })),
  );
});

Deno.test("bilibili 专栏搜索词只取用户可见字段并格式化中国日期", () => {
  const metadata = {
    source: "bilibili_article",
    title: "测试文章",
    publish_time: 1543766400,
    author: { name: "测试UP", mid: 12345 },
    tags: [{ name: "二次元" }, { name: "同人" }],
    categories: [{ name: "动画" }, { name: "动漫杂谈" }],
    replies: [
      { uname: "回复者甲", message: "第一条回复" },
      { uname: "回复者乙", message: "第二条回复" },
    ],
  };
  assertEquals(searchTextsFromMetadata(metadata), [
    "#二次元",
    "#同人",
    "测试文章",
    "测试UP",
    "12345",
    "动画",
    "动漫杂谈",
    "回复者甲",
    "第一条回复",
    "回复者乙",
    "第二条回复",
    "2018年12月3日",
  ]);
});

Deno.test("bilibili 纯 opus 保留页面展示的 opus id 搜索", () => {
  assertEquals(searchTextsFromMetadata({ source: "bilibili_opus", opus_id: "1154738799821979656" }), [
    "1154738799821979656",
  ]);
});

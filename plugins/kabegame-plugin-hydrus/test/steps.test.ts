// StringSplitter / StringSlicer / StringSorter 对照测试：fixtures/steps.expected.json 是 hydrus 本体 StringProcessor 的结果，
// 由 fixtures/hydrus_steps.py 生成。
import { load } from "../src/hydrus/serialisable/core.js";
import "../src/hydrus/serialisable/index.js";
import { processStrings } from "../src/hydrus/runtime/strings.js";

const cases: [unknown[], string[], string[]][] = JSON.parse(await Deno.readTextFile(new URL("./fixtures/steps.expected.json", import.meta.url)));

Deno.test("拆分、切片、排序与 hydrus 一致", () => {
  const failures: string[] = [];
  for (const [tuple, inputs, want] of cases) {
    const processor = load(tuple);
    const got = processStrings(processor, inputs);
    if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${JSON.stringify(inputs)}\n  步骤 ${JSON.stringify(tuple).slice(0, 200)}\n  期望 ${JSON.stringify(want)}\n  实际 ${JSON.stringify(got)}`);
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
});

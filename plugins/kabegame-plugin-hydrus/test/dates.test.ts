// conversion 10（DATE_DECODE）对照测试：fixtures/dates.expected.json 是 hydrus 本体 StringConverter 的结果，
// 由 fixtures/hydrus_dates.py 在 TZ=UTC 下生成，本测试同样需要 TZ=UTC。
import { convert, StringConvertError } from "../src/hydrus/runtime/strings.js";

const expected: [string, number, number, string, string | null][] = JSON.parse(await Deno.readTextFile(new URL("./fixtures/dates.expected.json", import.meta.url)));

Deno.test("日期解码与 hydrus 一致", () => {
  if (new Date(2020, 0, 1).getTimezoneOffset() !== 0) throw new Error("请用 TZ=UTC deno test 运行");
  const failures: string[] = [];
  for (const [phrase, tz, offset, text, want] of expected) {
    let got: string | null;
    try {
      got = convert([55, 2, [[[10, [phrase, tz, offset]]], "example string"]], text);
    } catch (e) {
      if (!(e instanceof StringConvertError)) throw e;
      got = null;
    }
    if (got !== want) failures.push(`${JSON.stringify(text)} / ${JSON.stringify(phrase)} / tz=${tz}：期望 ${want}，实际 ${got}`);
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
});

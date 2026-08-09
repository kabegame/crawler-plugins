// 爬虫插件 e2e 测试 harness：经 run-crawler-plugin driver（kabegame-cli plugin run）
// 走与主应用完全相同的链路，断言落盘产物。
//
// 用法（插件的 test/e2e.ts）：
//   import { defineCases, expectFiles } from "../../../test/harness.ts";
//   await defineCases("bilibili", [ { name, vars, expect: expectFiles({...}) }, ... ]);
//
// 运行：deno run -A plugins/<name>/test/e2e.ts [用例名…]   （不带参数跑全部非 optional 用例）
//
// 去重感知：dev 库里已入库过的 URL/hash 会被下载器去重（产物 0 个文件但任务成功）。
// harness 从任务日志统计 dedup 次数，断言按「新落盘文件 + 去重命中」计总量，
// 因此用例可以反复跑，不需要每次清库。

const HARNESS_DIR = new URL(".", import.meta.url).pathname;
const REPO = `${HARNESS_DIR}../`; // src-crawler-plugins/
const DRIVER = `${REPO}.claude/skills/run-crawler-plugin/driver.mjs`;

export interface RunResult {
  exitCode: number;
  stdout: string;
  /** 本次新落盘的文件名列表 */
  files: string[];
  /** 下载器 URL/hash 去重命中次数（已入库过的产物） */
  dedupCount: number;
  /** files.length + dedupCount，即插件本次实际产出的总条目数 */
  total: number;
  outputDir: string;
}

export interface E2ECase {
  name: string;
  /** kbConfig 覆盖项，经 --var 传入 */
  vars: Record<string, string | number | boolean>;
  /** 秒，默认 600 */
  timeout?: number;
  /** true = 失败不置败（依赖登录态、会员等环境条件的用例） */
  optional?: boolean;
  /** 首个用例前默认 repack 一次；置 true 强制该用例前再 repack */
  repack?: boolean;
  /** 返回错误信息列表，空数组 = 通过 */
  expect: (r: RunResult) => string[];
}

/** 断言产物：total = 新文件 + 去重命中。exts 按扩展名计数（只对新文件生效，去重时自动放宽为总量）。 */
export function expectFiles(spec: { total?: number; minTotal?: number; exts?: Record<string, number> }) {
  return (r: RunResult): string[] => {
    const errors: string[] = [];
    if (r.exitCode !== 0) errors.push(`退出码 ${r.exitCode}（期望 0）`);
    if (spec.total != null && r.total !== spec.total) {
      errors.push(`总产出 ${r.total}（新文件 ${r.files.length} + 去重 ${r.dedupCount}），期望 ${spec.total}`);
    }
    if (spec.minTotal != null && r.total < spec.minTotal) {
      errors.push(`总产出 ${r.total} < 期望下限 ${spec.minTotal}`);
    }
    // 全部新落盘时才能核对扩展名分布；有去重命中说明历史已验证过，跳过。
    if (spec.exts && r.dedupCount === 0) {
      for (const [ext, count] of Object.entries(spec.exts)) {
        const actual = r.files.filter((f) => f.toLowerCase().endsWith(ext)).length;
        if (actual !== count) errors.push(`扩展名 ${ext} 有 ${actual} 个，期望 ${count}`);
      }
    }
    return errors;
  };
}

/** 只断言任务成功（探索性/环境依赖用例）。 */
export function expectSuccess() {
  return (r: RunResult): string[] => (r.exitCode === 0 ? [] : [`退出码 ${r.exitCode}（期望 0）`]);
}

export async function runPlugin(
  plugin: string,
  vars: Record<string, string | number | boolean>,
  opts: { timeoutSec?: number; repack?: boolean } = {},
): Promise<RunResult> {
  const outputDir = await Deno.makeTempDir({ prefix: `kb-e2e-${plugin}-` });
  const args = [
    "run", "-A", DRIVER, plugin,
    "--output-dir", outputDir,
    "--timeout", String(opts.timeoutSec ?? 600),
    ...(opts.repack ? [] : ["--no-repack"]),
  ];
  for (const [key, value] of Object.entries(vars)) {
    args.push("--var", `${key}=${value}`);
  }

  const command = new Deno.Command(Deno.execPath(), {
    args,
    cwd: REPO,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  const text = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);

  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(outputDir)) {
      if (entry.isFile) files.push(entry.name);
    }
  } catch { /* 输出目录可能没建（任务失败） */ }

  // 只数原始日志行（JSON 形态）；driver 摘要区的「N × i18n:taskLogDedupByUrl」聚合行不算。
  const dedupCount = (text.match(/"k":"taskLogDedupBy(?:Url|Hash)"/g) || []).length;
  return { exitCode: code, stdout: text, files, dedupCount, total: files.length + dedupCount, outputDir };
}

export async function defineCases(plugin: string, cases: E2ECase[]): Promise<void> {
  const wanted = Deno.args.filter((a) => !a.startsWith("-"));
  const selected = wanted.length > 0
    ? cases.filter((c) => wanted.includes(c.name))
    : cases.filter((c) => !c.optional);
  if (selected.length === 0) {
    console.error(`没有匹配的用例。可用：${cases.map((c) => c.name + (c.optional ? "（optional）" : "")).join("、")}`);
    Deno.exit(1);
  }

  let failed = 0;
  let repacked = false;
  for (const testCase of selected) {
    const start = Date.now();
    console.log(`\n▶ ${plugin} :: ${testCase.name}`);
    // 首个用例 repack 一次，把当前源码打包投放到 dev 数据目录；其余用例复用。
    const needRepack = testCase.repack || !repacked;
    const result = await runPlugin(plugin, testCase.vars, {
      timeoutSec: testCase.timeout,
      repack: needRepack,
    });
    repacked = repacked || needRepack;

    const errors = testCase.expect(result);
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    if (errors.length === 0) {
      console.log(`✓ ${testCase.name}（${elapsed}s，新文件 ${result.files.length} + 去重 ${result.dedupCount}）`);
      await Deno.remove(result.outputDir, { recursive: true }).catch(() => {});
    } else {
      const tag = testCase.optional ? "⚠（optional，不置败）" : "✗";
      console.error(`${tag} ${testCase.name}（${elapsed}s）`);
      for (const err of errors) console.error(`    - ${err}`);
      console.error(`    输出目录（保留待查）：${result.outputDir}`);
      console.error(`    日志尾部：\n${result.stdout.split("\n").slice(-12).map((l) => "      " + l).join("\n")}`);
      if (!testCase.optional) failed += 1;
    }
  }

  console.log(`\n${failed === 0 ? "✓ 全部通过" : `✗ ${failed} 个用例失败`}（共跑 ${selected.length} 个）`);
  Deno.exit(failed === 0 ? 0 : 1);
}

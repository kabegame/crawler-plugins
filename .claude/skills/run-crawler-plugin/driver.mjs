#!/usr/bin/env -S deno run -A
/**
 * run-crawler-plugin driver —— 改完插件源码后，一条命令跑通
 * 「打包 → 投放 dev 数据目录 → 用 kabegame-cli 在本进程跑 V8 插件 → 摘要」。
 *
 * 为什么需要它，而不是直接敲 `kabegame-cli plugin run`：
 *   1. `plugin run` 只跑**已安装**的插件，读的是 .kgpg 而不是 src/。不重新打包，
 *      你改的 TS 根本不会生效——这是最容易浪费半小时的坑，所以默认先 repack。
 *   2. release 构建的 CLI 里 `is_dev()` 为 false，数据目录默认指向系统用户目录
 *      （macOS 的 ~/Library/Application Support/Kabegame），那里通常是旧版本的包，
 *      甚至没有你要测的插件。必须显式 `--data dev` 才会用仓库内的 .kabegame/debug。
 *   3. 输出量很大（一页 50 帖能刷上百行），末尾摘要比人肉翻日志有用。
 *
 * 用法（cwd = src-crawler-plugins）：
 *   deno run -A .claude/skills/run-crawler-plugin/driver.mjs kemono \
 *     --var source=creator --var service=patreon --var creator_id=44096704 \
 *     --var creator_page_start=1 --var creator_page_end=1
 *
 *   ... --dry-run          # 只解析并打印最终配置，不建任务、不联网
 *   ... --no-repack        # 跳过打包，直接跑已安装的那份
 *   ... --timeout 600      # 默认 300 秒
 *   ... --data prod        # 改用系统数据目录（默认 dev）
 *   ... --raw              # 不加摘要，子进程输出原样透传
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
// .claude/skills/run-crawler-plugin/ -> src-crawler-plugins/
const REPO = path.resolve(SKILL_DIR, "../../..");
const WORKSPACE = path.resolve(REPO, "..");
const PLUGIN_DIR = path.join(REPO, "plugins");
const REPACK = path.join(
  REPO,
  ".claude/skills/repack-crawler-plugins/driver.mjs",
);
const EXE = process.platform === "win32" ? "kabegame-cli.exe" : "kabegame-cli";
const CLI_RELEASE = path.join(WORKSPACE, "target/release", EXE);
const CLI_DEBUG = path.join(WORKSPACE, "target/debug", EXE);

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function usage() {
  const names = fs.existsSync(PLUGIN_DIR)
    ? fs.readdirSync(PLUGIN_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : [];
  console.log(`用法: driver.mjs <plugin> [--var k=v]... [选项]

选项:
  --var KEY=VALUE   覆盖插件 kbConfig 项，可重复
  --dry-run         只打印最终配置，不建任务
  --no-repack       跳过打包，直接跑已安装的版本
  --data dev|prod   数据目录（默认 dev = 仓库内 .kabegame/debug）
  --output-dir <目录> 图片落盘目录。**不传的话图片会进 <Pictures>/Kabegame**，
                    而不是 .kabegame/debug —— --data 管不到图片输出
  --timeout <秒>    默认 300
  --raw             不做摘要，原样透传子进程输出

可用插件: ${names.join(", ")}`);
}

// ── 参数解析 ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
  usage();
  process.exit(argv.length === 0 ? 1 : 0);
}

let plugin = null;
const vars = [];
let dryRun = false, noRepack = false, raw = false;
let dataMode = "dev";
let timeoutSec = 300;
let outputDir = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--var") {
    const v = argv[++i];
    if (!v) die("--var 需要一个 KEY=VALUE");
    if (!v.includes("=")) die(`--var 需要 KEY=VALUE 形式，收到：${v}`);
    vars.push(v);
  } else if (a === "--dry-run") dryRun = true;
  else if (a === "--no-repack") noRepack = true;
  else if (a === "--raw") raw = true;
  else if (a === "--data") dataMode = argv[++i];
  else if (a === "--output-dir") outputDir = path.resolve(argv[++i]);
  else if (a === "--timeout") timeoutSec = Number(argv[++i]);
  else if (a.startsWith("-")) die(`未知选项：${a}`);
  else if (plugin) die(`只能指定一个插件，已有 ${plugin}，又收到 ${a}`);
  else plugin = a;
}

if (!plugin) die("必须指定插件名。加 --help 看可用列表。");
if (!["dev", "prod"].includes(dataMode)) die(`--data 只能是 dev / prod`);
if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) die("--timeout 需要正数");
if (!fs.existsSync(path.join(PLUGIN_DIR, plugin))) {
  die(`插件目录不存在：plugins/${plugin}（加 --help 看可用列表）`);
}

// ── 定位 CLI，并确认它带 plugin run ───────────────────────────────────
const cli = fs.existsSync(CLI_RELEASE)
  ? CLI_RELEASE
  : fs.existsSync(CLI_DEBUG)
  ? CLI_DEBUG
  : null;
if (!cli) {
  die(
    `找不到 kabegame-cli。先构建：\n` +
      `    cd ${WORKSPACE} && deno task b -c kabegame-cli --release`,
  );
}

// 老版本 CLI 没有 plugin run（该子命令在 2026-07 才加回来，且需要
// kabegame-core 的 plugin-runtime + ipc-server feature）。早发现比跑一半报错强。
const help = spawnSync(cli, ["plugin", "run", "--help"], { encoding: "utf8" });
if (help.status !== 0) {
  die(
    `${path.relative(WORKSPACE, cli)} 不支持 \`plugin run\`（可能是旧版本）。\n` +
      `  重新构建：cd ${WORKSPACE} && deno task b -c kabegame-cli --release\n` +
      `  裸 cargo 构建需要先注入 FFmpeg 环境，见 SKILL.md 的「构建 CLI」。`,
  );
}

// ── 1. 打包 + 投放（= 安装）────────────────────────────────────────────
// plugin run 读的是已安装的 .kgpg，不是 src/。不重打包就是在跑旧代码。
if (!noRepack) {
  if (!fs.existsSync(REPACK)) {
    die(`找不到 repack driver：${path.relative(WORKSPACE, REPACK)}`);
  }
  console.log(`▶ 打包并投放 ${plugin} …`);
  const r = spawnSync("deno", ["run", "-A", REPACK, plugin], {
    cwd: REPO,
    stdio: "inherit",
  });
  if (r.status !== 0) die("打包失败，已中止（没有重新打包就跑等于测旧代码）");
  console.log();
}

// ── 2. 跑 ─────────────────────────────────────────────────────────────
const runArgs = ["plugin", "run", plugin, "--data", dataMode, "--plain"];
if (outputDir) runArgs.push("--output-dir", outputDir);
if (dryRun) runArgs.push("--dry-run");
for (const v of vars) runArgs.push("--var", v);

console.log(`▶ ${path.relative(WORKSPACE, cli)} ${runArgs.join(" ")}\n`);

const child = spawn(cli, runArgs, {
  cwd: WORKSPACE,
  stdio: ["ignore", "pipe", "pipe"],
});

const lines = [];
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  child.kill("SIGKILL");
}, timeoutSec * 1000);

function wire(stream, isErr) {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buf += chunk;
    const parts = buf.split("\n");
    buf = parts.pop();
    for (const line of parts) {
      lines.push({ line, isErr });
      // 始终实时透传：爬取任务动辄几分钟，没有实时输出没法判断是否卡住。
      (isErr ? process.stderr : process.stdout).write(line + "\n");
    }
  });
  stream.on("end", () => {
    if (buf) {
      lines.push({ line: buf, isErr });
      (isErr ? process.stderr : process.stdout).write(buf + "\n");
    }
  });
}
wire(child.stdout, false);
wire(child.stderr, true);

const code = await new Promise((resolve) => {
  child.on("close", (c) => {
    clearTimeout(timer);
    resolve(c);
  });
});

// ── 3. 摘要 ───────────────────────────────────────────────────────────
if (raw) process.exit(timedOut ? 124 : code ?? 1);

const all = lines.map((l) => l.line);
const warns = all.filter((l) => /^\s*WARN\s/.test(l));
const errors = all.filter((l) => /^\s*ERROR\s/.test(l));
const logs = all.filter((l) => /^\s*LOG\s/.test(l));
const done = all.find((l) => l.startsWith("完成 "));
// 插件自报的分页/作者边界（kemono 风格 ▶ ◀），有就拿来当结构摘要
const bounds = all.filter((l) => /\[.*\]\s*[▶◀]/.test(l));

// 下载器发的任务日志是**未解析的 i18n 占位对象**（{"_i18n":{"k":...,"p":{...}}}），
// GUI 会按 locale 渲染，CLI 原样吐出。整条 JSON 塞进摘要会把有用信息淹掉，
// 所以这里只取 key 当作「问题类别」。
function classify(line) {
  const body = line.replace(/^\s*(WARN|ERROR)\s+/, "").trim();
  const m = body.match(/"_i18n"\s*:\s*\{\s*"k"\s*:\s*"([^"]+)"/);
  if (m) return `i18n:${m[1]}`;
  // 非 i18n 的消息：截断到冒号前，把「同一类、不同 id」的行归成一组
  return body.split(/[：:]/)[0].slice(0, 60);
}

console.log("\n── 摘要 ──");
console.log(`  日志 ${logs.length} 行 · 警告 ${warns.length} · 错误 ${errors.length}`);
for (const b of bounds.slice(0, 6)) console.log(`  ${b.replace(/^\s*LOG\s+/, "")}`);
if (bounds.length > 6) console.log(`  …（另有 ${bounds.length - 6} 条边界日志）`);

const groups = new Map();
for (const l of [...errors, ...warns]) {
  const k = classify(l);
  groups.set(k, (groups.get(k) ?? 0) + 1);
}
if (groups.size) {
  console.log("  问题分类：");
  for (const [k, n] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(n).padStart(4)} × ${k}`);
  }
}
if (done) console.log(`  ${done}`);
console.log(
  `  图片输出：${outputDir ?? "应用默认目录（通常是 <Pictures>/Kabegame，不在 .kabegame/debug 下）"}`,
);

if (timedOut) {
  console.log(`  ✗ 超时（${timeoutSec}s）已 SIGKILL；加 --timeout 放宽`);
  process.exit(124);
}
if (code !== 0) {
  console.log(`  ✗ 退出码 ${code}`);
  process.exit(code ?? 1);
}
console.log("  ✓ 通过");

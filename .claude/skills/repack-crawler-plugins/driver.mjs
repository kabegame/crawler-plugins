#!/usr/bin/env -S deno run -A
/**
 * repack driver —— 把 src-crawler-plugins/plugins/<name>/ 打包成 .kgpg 并投放到
 * dev 数据目录 .kabegame/debug/data/plugins-directory（不碰 packed/）。
 *
 * 改完哪个插件就显式传哪个插件名。不做 git 检测：改动来自本轮编辑，自己知道改了谁，
 * 而 git 工作区里的历史改动和它无关。
 *
 * 为什么不直接用 `deno run -A package-plugin.ts --only a b`：
 *   --only 和全量模式都会 cleanupPackedKgpgFiles(outputDir)，把输出目录里其它
 *   .kgpg 全删掉。对 packed/ 无所谓（随后会全量重打），但对 dev 数据目录等于把没改的
 *   插件从应用里卸载了。单插件位置参数模式不做清理，所以本 driver 逐个插件调它。
 *
 * 用法（cwd = src-crawler-plugins）：
 *   deno run -A .claude/skills/repack-crawler-plugins/driver.mjs konachan
 *   deno run -A .claude/skills/repack-crawler-plugins/driver.mjs konachan pixiv
 *   deno run -A .claude/skills/repack-crawler-plugins/driver.mjs --all
 *   ... --out-dir <dir>       # 覆盖输出目录
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
// .claude/skills/repack-crawler-plugins/ -> src-crawler-plugins/
const REPO = path.resolve(SKILL_DIR, "../../..");
const WORKSPACE = path.resolve(REPO, "..");
const PLUGIN_DIR = path.join(REPO, "plugins");
const DEFAULT_OUT = path.join(
  WORKSPACE,
  ".kabegame/debug/data/plugins-directory",
);
const CLI = path.join(
  WORKSPACE,
  "target/release",
  process.platform === "win32" ? "kabegame-cli.exe" : "kabegame-cli",
);

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function allPlugins() {
  return fs
    .readdirSync(PLUGIN_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "node_modules")
    .map((e) => e.name)
    .sort();
}

// ---------- 参数 ----------
const argv = process.argv.slice(2);
let outDir = DEFAULT_OUT;
let all = false;
const names = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out-dir") outDir = path.resolve(process.cwd(), argv[++i]);
  else if (a === "--all") all = true;
  else if (a.startsWith("-")) die(`未知参数: ${a}`);
  else names.push(a);
}

const targets = all ? allPlugins() : names;
if (targets.length === 0) {
  console.error("用法: driver.mjs <插件名...> | --all  [--out-dir <dir>]");
  console.error(`可用插件: ${allPlugins().join(", ")}`);
  process.exit(1);
}

/**
 * 校验 .kgpg。注意这里有两个互相独立的「版本」，别混：
 *   - 容器格式版本：文件头 magic 后的 u16，固定为 3（KGPG v3 = 64B meta +
 *     128×128 RGB24 icon + ZIP）。由 kabegame-core/src/kgpg.rs 的 VERSION 写死。
 *   - 插件包规范版本：ZIP 内 package.json 的 kbPackageVersion，当前为 3
 *     （v3 = package.json 取代旧 manifest.json）。打包器只接受 >= 3。
 */
function verify(file) {
  const fd = fs.openSync(file, "r");
  const head = Buffer.alloc(8);
  fs.readSync(fd, head, 0, 8, 0);
  fs.closeSync(fd);
  if (head.subarray(0, 4).toString("latin1") !== "KGPG")
    return { ok: false, err: "缺少 KGPG magic" };
  const ver = head.readUInt16LE(4);
  if (ver !== 3)
    return { ok: false, err: `KGPG 容器格式版本非法: ${ver}（只接受 3）` };

  const z = spawnSync("unzip", ["-p", file, "package.json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // KGPG v3 = 固定头部 + ZIP，unzip 把头部当 "extra bytes at beginning" 报 warning
  // 并以 exit 1 退出，即使解包成功。所以只认 stdout 能否解析，不看退出码。
  if (z.status !== 0 && z.status !== 1)
    return { ok: false, err: `unzip 失败(${z.status}): ${z.stderr.trim()}` };
  let pkg;
  try {
    pkg = JSON.parse(z.stdout);
  } catch (e) {
    return { ok: false, err: `package.json 解析失败: ${e.message}` };
  }
  const pkgVer = pkg.kbPackageVersion ?? 0;
  if (pkgVer < 3)
    return { ok: false, err: `插件包规范版本过低: kbPackageVersion=${pkgVer}` };
  return {
    ok: true,
    ver,
    pkgVer,
    version: pkg.version ?? "?",
    size: fs.statSync(file).size,
  };
}

function pack(name) {
  const dir = path.join(PLUGIN_DIR, name);
  if (!fs.existsSync(dir)) return { name, ok: false, err: "插件目录不存在" };
  // 单插件位置参数模式 —— 唯一不清理输出目录的模式
  const r = spawnSync(
    "deno",
    ["run", "-A", "package-plugin.ts", name, "--out-dir", outDir],
    { cwd: REPO, stdio: "inherit" },
  );
  if (r.status !== 0) return { name, ok: false, err: "package-plugin.ts 失败" };
  const v = verify(path.join(outDir, `${name}.kgpg`));
  return v.ok ? { name, ok: true, ...v } : { name, ok: false, err: v.err };
}

// ---------- 主流程 ----------
if (!fs.existsSync(CLI))
  die(
    `找不到 ${CLI}\n  打包由 kabegame-cli plugin pack 实现，先在仓库根构建：\n  deno task b -c kabegame-cli --release`,
  );

console.log(`→ 输出目录: ${outDir}`);
console.log(`→ 目标插件: ${targets.join(", ")}\n`);

fs.mkdirSync(outDir, { recursive: true });
const before = new Set(
  fs.readdirSync(outDir).filter((f) => f.endsWith(".kgpg")),
);

const results = targets.map(pack);

// 兜底断言：其它插件的 .kgpg 一个都不能少（防止哪天有人把 --only 接回来）
const after = new Set(fs.readdirSync(outDir).filter((f) => f.endsWith(".kgpg")));
const lost = [...before].filter((f) => !after.has(f));

console.log("\n── 结果 ──");
for (const r of results) {
  if (r.ok)
    console.log(
      `  ✓ ${r.name}  v${r.version}  包规范 v${r.pkgVer}  容器 KGPG v${r.ver}  ${(r.size / 1024).toFixed(1)} KB`,
    );
  else console.log(`  ✗ ${r.name}  ${r.err}`);
}
console.log(`  目录内 .kgpg 总数: ${after.size}`);
if (lost.length) console.log(`  ⚠ 丢失的包: ${lost.join(", ")}`);

if (results.some((r) => !r.ok) || lost.length) process.exit(1);
console.log(
  "\n应用若在运行：设置 → 插件 → 刷新已安装源（refresh_plugins），或重启。",
);

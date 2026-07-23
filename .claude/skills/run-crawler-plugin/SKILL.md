---
name: run-crawler-plugin
description: 用 kabegame-cli 真跑一个爬虫插件来验证改动 —— 打包、投放 dev 数据目录、在 CLI 进程内执行 V8 插件并汇总日志与下载结果。当需要 run / test / 调试 / 验证爬虫插件，试跑 plugin、跑一遍看看能不能下到图、排查插件报错或下载失败时使用。不要为此启动 GUI 主应用。
---

# 跑爬虫插件（kabegame-cli plugin run）

**改完 `plugins/<name>/` 下的插件源码，用本 skill 真跑一遍验证。** 不需要启动 GUI，
不需要 daemon —— `kabegame-cli plugin run` 在自己进程里初始化 TaskScheduler + V8 运行时，
走的是和主应用**完全同一条链路**（`commands::task::start_task` → 调度器冻结参数 → worker
在 `spawn_blocking` 里跑 V8）。

下文路径均相对 `src-crawler-plugins/`。

## 前置：构建 CLI

```bash
ls ../target/release/kabegame-cli || (cd .. && deno task b -c kabegame-cli --release)
```

`deno task b` 会自动注入 FFmpeg / bindgen 的环境变量。**不要**直接敲 `cargo build -p kabegame-cli` ——
裸 cargo 拿不到那些注入，`rusty_ffmpeg` 的 build.rs 会以 `No linking method set!` 或
`'errno.h' file not found` 失败。真要裸跑得自己补：

```bash
export FFMPEG_PKG_CONFIG_PATH="$PWD/../third/FFmpeg-build/install/lib/pkgconfig"
export BINDGEN_EXTRA_CLANG_ARGS="-isysroot $(xcrun --sdk macosx --show-sdk-path)"
cargo build -p kabegame-cli --release
```

CLI 首次带 V8 构建约 7-8 分钟（deno_core + rusty_v8 + aws-lc-rs），之后增量约 40 秒。

## 用法（agent path）

```bash
# 最常见：改完插件，跑一页看看
deno run -A .claude/skills/run-crawler-plugin/driver.mjs kemono \
  --var source=creator --var service=patreon --var creator_id=44096704 \
  --var creator_page_start=1 --var creator_page_end=1

# 只看最终配置解析成什么，不建任务、不联网（秒回）
deno run -A .claude/skills/run-crawler-plugin/driver.mjs kemono --dry-run \
  --var source=tag --var tag=nsfw

# 图片别落进你的图库
deno run -A .claude/skills/run-crawler-plugin/driver.mjs kemono \
  --output-dir /tmp/kb-test --var source=tag --var tag=wip

# 不带参数看可用插件列表
deno run -A .claude/skills/run-crawler-plugin/driver.mjs --help
```

driver 干三件事：**打包投放 → 跑 → 摘要**。

| 选项 | 说明 |
|---|---|
| `--var KEY=VALUE` | 覆盖 `kbConfig` 项，可重复。值按 kbConfig 里声明的类型自动转换，所以 `--var page=3` 会变成数字。key 写错会直接报错并列出所有可用 key。 |
| `--dry-run` | 只解析并打印最终配置 |
| `--no-repack` | 跳过打包，跑已安装的那份 |
| `--output-dir <目录>` | 图片落盘位置，**强烈建议测试时指定**（见 Gotchas） |
| `--data dev\|prod` | 默认 `dev` = 仓库内 `.kabegame/debug` |
| `--timeout <秒>` | 默认 300，超时 SIGKILL 并以 124 退出 |
| `--raw` | 不做摘要，原样透传 |

典型输出（`--plain` 模式，driver 固定用它以保证可解析）：

```
   LOG  [kemono] ▶ 进入作者 BaronOBeefdip（patreon:44096704）：共 312 帖 / 7 页，本次爬取第 7~7 页
   LOG  [kemono]   → 帖子开始 「Nessa Update」(patreon:44096704:43062053)：4 张图
   LOG  [kemono]   ← 帖子结束 「Nessa Update」(patreon:44096704:43062053)：成功 4，失败 0
  WARN  帖子的附件都被过滤掉了：patreon:44096704:42862646
完成 下载 6 张，失败 0

── 摘要 ──
  日志 14 行 · 警告 7 · 错误 0
  [kemono] ▶ 进入作者 …：共 312 帖 / 7 页，本次爬取第 7~7 页
  [kemono] ◀ 作者结束 …：12 帖，下载 11/11 张
  问题分类：
       7 × 帖子的附件都被过滤掉了
  完成 下载 6 张，失败 0
  图片输出：/tmp/kb-test
  ✓ 通过
```

退出码：0 通过 / 1 任务失败或参数错 / 124 超时。

## 人类路径

想看**进度条**（钉在最后一行、日志从上方滚出，同 cargo/apt）就直接敲 CLI，别经 driver：

```bash
../target/release/kabegame-cli plugin run kemono --data dev \
  --var source=creator --var service=patreon --var creator_id=44096704
```

注意进度条只在**真 TTY 且 `TERM` 已设置**时渲染。driver 固定加 `--plain`，因为管道里
进度条是噪音。`Ctrl-C` 会取消任务（而不是硬退出），避免数据库里留下永远 `running` 的任务。

## Gotchas

- **`plugin run` 跑的是已安装的 `.kgpg`，不是 `src/`。** 改完 TS 不重新打包，跑的就是旧代码，
  而且不会有任何提示。driver 默认先调 `repack-crawler-plugins` 就是为了堵这个洞——
  除非你明确要测已安装版本，否则别加 `--no-repack`。

- **图片输出不受 `--data` 控制。** `--data dev` 只切数据库和插件目录；图片默认落到
  **`<Pictures>/Kabegame/`**（macOS 上实测是 `/Volumes/KIOXIA/Pictures/Kabegame/`），
  会混进你真实的图库。测试时一律加 `--output-dir`。

- **release 构建的 CLI 默认走 prod 数据目录。** `is_dev()` 读的是编译期 cfg，release 即
  false → 系统用户数据目录。那里往往是旧版本装的插件（我实测是 KGPG **v2** 容器，
  现在的解析器只认 v3，会报 `非法 KGPG 包：容器版本 2 过低`），甚至根本没有你要测的插件。
  driver 默认 `--data dev`。

- **单个坏包不再中断整条命令。** `refresh_plugins` 遇到解析失败的 `.kgpg` 会整次失败，
  CLI 侧改成了打 `[WARN] 插件目录扫描未全部成功` 后继续——只要目标插件本身能解析就照跑。
  看到这条 warn 说明目录里有坏包，不一定影响本次测试。

- **只支持 `kbBackend: "v8"`。** WebView 后端要真实浏览器窗口，headless CLI 起不来，会直接报错。
  （注：仓库现有 14 个插件全是 v8，所以这条拒绝路径没有被实际触发过。）

- **任务日志里有未解析的 i18n 占位对象**，长这样：
  `{"_i18n":{"k":"taskLogDedupByUrl","p":{...}}}`。这是下载器发的，GUI 会按 locale 渲染，
  CLI 原样吐出。driver 的摘要会把它们归成 `i18n:<key>` 一类计数，不然去重警告能刷几十行。

- **core 有绕过日志系统的裸 `println!`**：`网络代理已配置 (async)`、
  `[v8-snapshot] restored runtime in N ms`、`[EVENT_FORWARD] ready for forward event`。
  它们不经事件总线，所以摘要统计不到，在非 `--plain` 模式下还会冲掉进度条那一行。

- **首次跑会生成 V8 baseline snapshot**，之后每次 `restored runtime in 3-13 ms`。
  如果看到某次特别慢，多半是快照失效在重建。

- **`--var` 的值全部先当字符串传**，由 core 的 `normalize_var_value` 按 `kbConfig` 的类型转换。
  所以 `--var creator_page_end=0`（0 = 一直到最后一页）能正确变成数字 0，不用引号。

## Troubleshooting

| 症状 | 原因 / 处理 |
|---|---|
| `找不到 kabegame-cli` | `cd .. && deno task b -c kabegame-cli --release` |
| `… 不支持 plugin run（可能是旧版本）` | CLI 是 2026-07 之前构建的。重新构建（同上）。 |
| `插件 X 未安装。已安装的有：…` | 先 `deno run -A .claude/skills/repack-crawler-plugins/driver.mjs X`，或直接去掉 `--no-repack` 让 driver 代劳。 |
| `插件 X 没有配置项 \`k\`。可用的有：…` | `--var` 的 key 拼错了，照它列出的改。 |
| `非法 KGPG 包：容器版本 2 过低` | 数据目录里有旧容器的包。多半是漏了 `--data dev` 跑到 prod 目录去了。 |
| `rusty_ffmpeg … No linking method set!` / `'errno.h' file not found` | 裸 `cargo build` 少了环境注入，见「前置：构建 CLI」。 |
| 跑完 `下载 0 张` 但没有 error | 先 `--dry-run` 看配置是不是真按预期解析的；再看摘要的「问题分类」，通常是附件被过滤规则全滤掉了。 |
| 退出码 124 | 撞上 `--timeout`（默认 300s）。爬多页时加 `--timeout 900`。 |

## driver

`.claude/skills/run-crawler-plugin/driver.mjs` —— 串起「repack → run → 摘要」，
实时透传子进程输出（爬取几分钟起步，没有实时输出没法判断卡没卡），
结束后按类别聚合警告/错误并给出结构化摘要。

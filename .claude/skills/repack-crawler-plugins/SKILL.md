---
name: repack-crawler-plugins
description: 改完 src-crawler-plugins/plugins/<name>/ 下的插件源码后，立刻用本 skill 把该插件重打成 .kgpg 并投放到 dev 数据目录 .kabegame/debug/data/plugins-directory，让正在跑的 dev 应用能加载到改动。用于 repack / rebuild / 重新打包爬虫插件、把插件装进开发环境、pack plugin to dev data、更新 kgpg。
---

# 重打爬虫插件到 dev 数据目录

**改完 `plugins/<name>/` 下任何源码，就用 driver 重打这个插件。** 产物投到
**dev 数据目录** `.kabegame/debug/data/plugins-directory/`（`deno task dev -c kabegame`
默认读这里），**不写 `packed/`**——`packed/` 是发布产物，只在 release 时全量生成。

下文路径均相对 `src-crawler-plugins/`。

## 前置

打包实际由 Rust sidecar `kabegame-cli plugin pack` 完成，仓库根必须已有 release CLI：

```bash
ls ../target/release/kabegame-cli    # 不存在则：deno task b -c kabegame-cli --release
```

`unzip` 需在 PATH 上（driver 用它校验产物）。

## 用法（agent path）

传你**这轮改过的**插件名，一个或多个：

```bash
# 改了 konachan
deno run -A .claude/skills/repack-crawler-plugins/driver.mjs konachan

# 改了多个
deno run -A .claude/skills/repack-crawler-plugins/driver.mjs konachan ziworld

# 全量重打 14 个插件（很少需要）
deno run -A .claude/skills/repack-crawler-plugins/driver.mjs --all

# 换输出目录（例如打进 tauri resources）
deno run -A .claude/skills/repack-crawler-plugins/driver.mjs konachan --out-dir ../src-tauri/kabegame/resources/plugins
```

不带参数会打印用法和全部可用插件名。输出示例（每个包都做了 KGPG 头部 + ZIP 内
`package.json` 校验）：

```
→ 输出目录: /Volumes/KIOXIA/kabegame/.kabegame/debug/data/plugins-directory
→ 目标插件: konachan, ziworld

── 结果 ──
  ✓ konachan  v1.2.7  包规范 v3  容器 KGPG v3  360.9 KB
  ✓ ziworld  v0.3.5  包规范 v3  容器 KGPG v3  60.4 KB
  目录内 .kgpg 总数: 14
```

失败（插件目录不存在 / 打包失败 / 包校验不过 / 目录里原有包丢失）时退出码为 1。

打完后应用不会自动感知：在运行中的应用里走 **设置 → 插件 → 刷新已安装源**
（后端 `refresh_plugins`，全量重扫 `plugins-directory`），或重启 dev 应用。

## Gotchas

- **别用 `--only`。** `deno run -A package-plugin.ts --only a b` 和全量模式都会
  `cleanupPackedKgpgFiles(outputDir)`，把输出目录里**其它 `.kgpg` 全删掉**。对 `packed/`
  无所谓（紧接着全量重打），但对 dev 数据目录等于把没改的插件从应用里卸载了。实测：
  目录里放 `haowallpaper/pixai/ziworld` 三个包，跑 `--only konachan` 之后只剩
  `konachan.kgpg`。**只有单插件位置参数模式**（`package-plugin.ts konachan --out-dir ...`）
  不清理，driver 就是逐个插件调这个模式的。
- **`unzip` 对 `.kgpg` 会 exit 1 但其实成功。** KGPG v3 = 固定头部（64B meta +
  128×128 RGB24 icon）+ ZIP，`unzip` 把头部当 "extra bytes at beginning" 报 warning
  并以 1 退出。校验只能看 stdout 能否解析，不能看退出码。
- **`project.json` 里的 nx target 用不了**——仓库根没有 `nx.json`，`package-to-dev-data`
  等是历史遗留。它的输出目录是对的，driver 沿用同一个。
- `package.json` 的 `scripts` 仍写着 `bun package-plugin.ts`，同属迁移残留；直接用
  `deno run -A package-plugin.ts`，已验证可跑。
- `plugins-directory/` 下的 `default-configs/` 是目录，清理逻辑只删文件，不受影响。
- 与内建插件同名的 `.kgpg` 会被后端 `refresh_plugins` 直接跳过（见
  `src-tauri/kabegame-core/src/plugin/mod.rs`），打进去也不生效。

## Troubleshooting

- `找不到 .../target/release/kabegame-cli 请在kabegame父仓库构建cli工具！`
  → `deno task b -c kabegame-cli --release`。若设了 `CARGO_TARGET_DIR`，脚本会去那个
  target 里找。
- `✗ <name>  插件目录不存在` → 名字要和 `plugins/` 下的目录名完全一致（如 `anime-pictures`，
  不是 `anime_pictures`）。不带参数跑一次可列出全部合法名字。
- `⚠ 丢失的包: ...` → 输出目录里原有的 `.kgpg` 被删了，几乎必然是有人把 `--only`
  接回了打包路径，见第一条 Gotcha。

## driver

`.claude/skills/repack-crawler-plugins/driver.mjs` —— 逐插件调用单插件打包模式，
打完校验 KGPG 头部与 ZIP 内 manifest，并断言输出目录里原有的包一个都没少。

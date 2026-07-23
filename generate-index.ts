#!/usr/bin/env -S deno run -A

/**
 * 生成插件索引文件 index.json
 * 版本信息从 package.json 读取
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";
import chalk from "chalk";
import { Command } from "commander";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 插件目录和输出目录
const PLUGIN_DIR = path.join(__dirname, "plugins");
const OUTPUT_DIR = path.join(__dirname, "packed");
const INDEX_FILE = path.join(OUTPUT_DIR, "index.json");
const PACKAGE_JSON = path.join(__dirname, "package.json");
const BUILTIN_JSON = path.join(__dirname, "builtin.json");

// KGPG v3 将列表 icon 写入 .kgpg 固定头部，可通过 HTTP Range 直接读取；商店元数据来自 index.json。
// 因此不再生成/引用 packed/<id>.icon.png 这类额外图标文件。

interface PackageJson {
  version?: string;
}

interface PluginPackageJson {
  name?: string;
  version?: string;
  description?: string;
  author?: string | { name?: string };
  kbPackageVersion?: number;
  engines?: {
    kabegame?: string;
  };
  [key: string]: unknown;
}

/** 从 manifest 中复制 name / name.zh / description / description.zh 等扁平键到目标对象（供 index.json 写入，由后端解析生成 i18n 对象） */
function copyFlatI18nKeys(
  manifest: Record<string, unknown>,
  target: Record<string, unknown>,
  baseKey: string,
): void {
  if (typeof manifest[baseKey] === "string") target[baseKey] = manifest[baseKey];
  const prefix = baseKey + ".";
  for (const [k, v] of Object.entries(manifest)) {
    if (typeof v !== "string") continue;
    if (k === baseKey || k.startsWith(prefix)) target[k] = v;
  }
}

interface Manifest {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  [key: string]: unknown;
}

interface PluginInfo {
  id: string;
  version: string;
  author: string;
  packageVersion: number;
  minAppVersion?: string;
  downloadUrl: string;
  sizeBytes: number;
  sha256: string;
  /** 扁平键 name / name.zh / name.en 等，由后端解析为 i18n 对象 */
  [key: string]: unknown;
}

interface IndexData {
  version: string;
  generated_at: string;
  repository: {
    owner: string;
    name: string;
    url: string;
  };
  release_url: string;
  plugins: PluginInfo[];
}

interface GenerateIndexOptions {
  repoOwner?: string;
  repoName?: string;
  tag?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function calculateSHA256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

function packageJsonIsV3(pkg: PluginPackageJson): boolean {
  return (pkg.kbPackageVersion ?? 0) >= 3;
}

function normalizeEnginesKabegame(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const version = trimmed.startsWith(">=") ? trimmed.slice(2).trim() : trimmed;
  return version.length > 0 ? version : undefined;
}

function authorString(author: PluginPackageJson["author"]): string {
  if (typeof author === "string") return author;
  if (author && typeof author === "object" && typeof author.name === "string") {
    return author.name;
  }
  return "";
}

function generateIndex(options: GenerateIndexOptions): string {
  // 从 package.json 读取版本信息
  let packageVersion = "latest";
  try {
    const packageJson: PackageJson = JSON.parse(
      fs.readFileSync(PACKAGE_JSON, "utf-8"),
    );
    packageVersion = packageJson.version || "latest";
  } catch (error) {
    console.warn(
      chalk.yellow(
        `⚠️  无法读取 package.json，使用默认版本: ${packageVersion}`,
      ),
    );
  }

  // 从环境变量或参数获取 Release 信息
  // 默认仓库: https://github.com/kabegame/crawler-plugins
  // Release tag 格式: v{version}，例如 v1.0.0
  //
  // 注意：GitHub Actions 在 push 到 main 时 GITHUB_REF_NAME=main，会导致生成的 index.json 写成 main。
  // 这里优先使用 "vX.Y.Z" 这种 tag；否则回退到 package.json 的版本推导出的 tag。
  const envRefName = process.env.GITHUB_REF_NAME;
  const envTag =
    envRefName && /^v\d+\.\d+\.\d+.*$/i.test(envRefName) ? envRefName : null;
  const RELEASE_TAG =
    options.tag ||
    envTag ||
    (packageVersion !== "latest" ? `v${packageVersion}` : "latest");
  const REPO_OWNER =
    options.repoOwner || process.env.GITHUB_REPOSITORY_OWNER || "kabegame";
  const REPO_NAME =
    options.repoName ||
    process.env.GITHUB_REPOSITORY?.split("/")[1] ||
    "crawler-plugins";

  // GitHub Release 下载 URL 模板
  // 格式: https://github.com/{owner}/{repo}/releases/download/{tag}/{filename}
  const GITHUB_RELEASE_BASE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${RELEASE_TAG}`;

  console.log(chalk.blue("📝 生成插件索引文件..."));
  console.log(chalk.cyan(`   仓库: ${REPO_OWNER}/${REPO_NAME}`));
  console.log(chalk.cyan(`   版本 (package.json): ${packageVersion}`));
  console.log(chalk.cyan(`   Release Tag: ${RELEASE_TAG}`));
  console.log(chalk.cyan(`   下载基础 URL: ${GITHUB_RELEASE_BASE}\n`));

  // 确保输出目录存在
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 读取所有插件目录
  const entries = fs.readdirSync(PLUGIN_DIR, { withFileTypes: true });
  const pluginDirs = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const dirName = entry.name;
      return (
        dirName !== "node_modules" &&
        dirName !== "packed" &&
        dirName !== ".git" &&
        dirName !== "plugins"
      );
    })
    .map((entry) => entry.name);

  if (pluginDirs.length === 0) {
    console.error(chalk.red("❌ 未找到任何插件目录"));
    process.exit(1);
  }

  const plugins: PluginInfo[] = [];

  for (const pluginName of pluginDirs) {
    const pluginDir = path.join(PLUGIN_DIR, pluginName);
    const packageJsonPath = path.join(pluginDir, "package.json");
    const manifestPath = path.join(pluginDir, "manifest.json");
    const kgpgFile = path.join(OUTPUT_DIR, `${pluginName}.kgpg`);

    // 检查 package.json / manifest.json 是否存在
    if (!fs.existsSync(packageJsonPath) && !fs.existsSync(manifestPath)) {
      console.warn(
        chalk.yellow(`⚠️  跳过 ${pluginName}: package.json/manifest.json 不存在`),
      );
      continue;
    }

    // 检查 .kgpg 文件是否存在
    if (!fs.existsSync(kgpgFile)) {
      console.warn(
        chalk.yellow(`⚠️  跳过 ${pluginName}: ${pluginName}.kgpg 不存在`),
      );
      continue;
    }

    try {
      let manifestRaw: Record<string, unknown>;
      let packageVersion = 2;
      let minAppVersion: string | undefined;
      let author = "";

      if (fs.existsSync(packageJsonPath)) {
        const pkgRaw = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf-8"),
        ) as PluginPackageJson;
        if (packageJsonIsV3(pkgRaw)) {
          manifestRaw = pkgRaw;
          packageVersion = pkgRaw.kbPackageVersion ?? 3;
          minAppVersion = normalizeEnginesKabegame(pkgRaw.engines?.kabegame);
          author = authorString(pkgRaw.author);
        } else if (fs.existsSync(manifestPath)) {
          manifestRaw = JSON.parse(
            fs.readFileSync(manifestPath, "utf-8"),
          ) as Record<string, unknown>;
          const manifest = manifestRaw as Manifest;
          author = (manifest.author as string) || "";
        } else {
          console.warn(
            chalk.yellow(`⚠️  跳过 ${pluginName}: package.json 不是 v3 且 manifest.json 不存在`),
          );
          continue;
        }
      } else {
        manifestRaw = JSON.parse(
          fs.readFileSync(manifestPath, "utf-8"),
        ) as Record<string, unknown>;
        const manifest = manifestRaw as Manifest;
        author = (manifest.author as string) || "";
      }
      const manifest = manifestRaw as Manifest;

      // 获取文件大小
      const stats = fs.statSync(kgpgFile);
      const fileSize = stats.size;

      // 计算 SHA256 校验和
      const sha256 = calculateSHA256(kgpgFile);

      // 构建插件信息：固定字段 + 扁平键 name/name.zh、description/description.zh 等（后端解析生成 i18n 对象）
      const pluginInfo: PluginInfo = {
        id: pluginName,
        version: manifest.version || "1.0.0",
        author,
        packageVersion,
        downloadUrl: `${GITHUB_RELEASE_BASE}/${pluginName}.kgpg`,
        sizeBytes: fileSize,
        sha256: sha256,
      };
      if (minAppVersion) {
        pluginInfo.minAppVersion = minAppVersion;
      }
      copyFlatI18nKeys(manifestRaw, pluginInfo, "name");
      copyFlatI18nKeys(manifestRaw, pluginInfo, "description");
      if (Array.isArray(manifestRaw.kbLabels)) {
        pluginInfo.kbLabels = manifestRaw.kbLabels;
      }

      plugins.push(pluginInfo);
      const displayName =
        (manifest.name as string) ||
        (manifest["name.zh"] as string) ||
        pluginName;
      console.log(
        chalk.green(
          `✅ ${pluginName}: ${displayName} v${
            pluginInfo.version
          } (${formatFileSize(fileSize)}, SHA256: ${sha256.substring(0, 8)}...)`,
        ),
      );
    } catch (error) {
      console.error(chalk.red(`❌ ${pluginName}: ${(error as Error).message}`));
    }
  }

  // 生成索引对象
  const index: IndexData = {
    version: RELEASE_TAG,
    generated_at: new Date().toISOString(),
    repository: {
      owner: REPO_OWNER,
      name: REPO_NAME,
      url: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
    },
    release_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${RELEASE_TAG}`,
    plugins: plugins.sort((a, b) => a.id.localeCompare(b.id)), // 按 ID 排序
  };

  // 写入 index.json
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");

  console.log(chalk.green(`\n📄 索引文件已生成: ${INDEX_FILE}`));
  console.log(chalk.cyan(`   包含 ${plugins.length} 个插件\n`));

  return INDEX_FILE;
}

// 创建 Commander 程序
const program = new Command();

program
  .name("generate-index.ts")
  .description("生成插件索引文件 index.json")
  .version("1.0.0")
  .option(
    "--repo-owner <owner>",
    "GitHub 仓库所有者（默认: kabegame）",
    "kabegame",
  )
  .option(
    "--repo-name <name>",
    "GitHub 仓库名称（默认: crawler-plugins）",
    "crawler-plugins",
  )
  .option("--tag <tag>", "Release 标签（默认: 从 package.json 或环境变量推导）")
  .action((options: GenerateIndexOptions) => {
    try {
      generateIndex(options);
    } catch (error) {
      console.error(chalk.red(`❌ 生成索引失败: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// 解析命令行参数
program.parse();

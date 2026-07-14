#!/usr/bin/env bun

/**
 * 打包插件为 .kgpg 格式
 * 根据 project.json 中的 inputs 字段路径模式计算需要打包的文件
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { glob } from "glob";
import { spawnSync } from "child_process";
import chalk from "chalk";
import { Command } from "commander";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 插件目录和输出目录（默认输出到 packed，可通过参数覆盖）
const PLUGIN_DIR = path.join(__dirname, "plugins");
const DEFAULT_OUTPUT_DIR = path.join(__dirname, "packed");
const PROJECT_JSON = path.join(__dirname, "project.json");

const PLUGIN_ICON_PACKED_SUFFIX = ".icon.png";

// 统一实现：改为调用 Rust sidecar `kabegame-cli plugin pack`
const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const TAURI_DIR = path.join(WORKSPACE_ROOT, "src-tauri");
// 与 scripts/utils.ts 的 TARGET_DIR 语义一致:优先 CARGO_TARGET_DIR(相对值按仓库根解析),
// 否则默认 <root>/target。保证隔离构建(如 CARGO_TARGET_DIR=target-22,在 22.04 VM 内降 glibc
// 地板)时,打包 .kgpg 用的 cli 与主构建同处一个 target,而不是误用旧的 target/release 产物。
const TARGET_DIR = process.env.CARGO_TARGET_DIR
  ? path.isAbsolute(process.env.CARGO_TARGET_DIR)
    ? process.env.CARGO_TARGET_DIR
    : path.join(WORKSPACE_ROOT, process.env.CARGO_TARGET_DIR)
  : path.join(WORKSPACE_ROOT, "target");
const CLI_EXE = path.join(
  TARGET_DIR,
  "release",
  process.platform === "win32" ? "kabegame-cli.exe" : "kabegame-cli",
);

interface PluginFile {
  relativePath: string;
  absolutePath: string;
}

interface PluginResult {
  name: string;
  success: boolean;
  error?: string;
}

interface ProjectJson {
  targets?: {
    package?: {
      inputs?: string[];
    };
  };
}

interface PluginPackageJson {
  kbPackageVersion?: number;
  main?: string;
  scripts?: Record<string, string>;
}

function ensureCli(): void {
  if (!fs.existsSync(CLI_EXE)) {
    throw new Error(`找不到 cli ${CLI_EXE} 请在kabegame父仓库构建cli工具！`);
  }
  // console.log(chalk.blue("🔧 构建 kabegame-cli（用于打包 .kgpg）..."));
  // const r = spawnSync(
  //   "cargo",
  //   ["build", "--manifest-path", CARGO_TOML, "-p", "kabegame-cli"],
  //   {
  //     cwd: TAURI_DIR,
  //     stdio: "inherit",
  //     env: { ...process.env },
  //   }
  // );
  // if (r.status !== 0) {
  //   throw new Error("构建 kabegame-cli 失败（请确认 Rust 工具链可用）");
  // }
  // cliBuilt = true;
}

function cliPackPlugin(pluginDir: string, outputFile: string): void {
  ensureCli();
  const r = spawnSync(
    CLI_EXE,
    ["plugin", "pack", "--plugin-dir", pluginDir, "--output", outputFile],
    { cwd: WORKSPACE_ROOT, stdio: "inherit" },
  );
  if (r.status !== 0) {
    throw new Error(`kabegame-cli 打包失败: ${path.basename(outputFile)}`);
  }
}

function commandExists(command: string): boolean {
  const r = spawnSync(command, ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

function runPluginBuild(pluginDir: string, pkg: PluginPackageJson): void {
  const buildScript = pkg.scripts?.build;
  if (typeof buildScript !== "string" || buildScript.trim().length === 0) {
    return;
  }

  const runner = commandExists("bun") ? "bun" : commandExists("npm") ? "npm" : null;
  if (!runner) {
    throw new Error("未找到可用的包管理器（bun/npm），无法执行插件构建");
  }

  const r = spawnSync(runner, ["run", "build"], {
    cwd: pluginDir,
    stdio: "inherit",
    env: { ...process.env },
  });
  if (r.status !== 0) {
    throw new Error(`插件构建失败: ${path.basename(pluginDir)}`);
  }
}

function cleanupPackedKgpgFiles(
  outputDir: string,
  keepNames: string[] | null = null,
): void {
  if (!fs.existsSync(outputDir)) return;
  const files = fs.readdirSync(outputDir);
  for (const file of files) {
    const filePath = path.join(outputDir, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || !file.endsWith(".kgpg")) continue;

    if (Array.isArray(keepNames)) {
      const stem = path.basename(file, ".kgpg");
      if (keepNames.includes(stem)) continue;
    }
    fs.unlinkSync(filePath);
  }
}

function cleanupPackedPluginIconFiles(
  outputDir: string,
  keepNames: string[] | null = null,
): void {
  if (!fs.existsSync(outputDir)) return;
  const files = fs.readdirSync(outputDir);
  for (const file of files) {
    const filePath = path.join(outputDir, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || !file.endsWith(PLUGIN_ICON_PACKED_SUFFIX)) continue;

    if (Array.isArray(keepNames)) {
      const stem = file.slice(0, -PLUGIN_ICON_PACKED_SUFFIX.length);
      if (keepNames.includes(stem)) continue;
    }
    fs.unlinkSync(filePath);
  }
}

/**
 * 从 project.json 读取 inputs 字段，解析文件路径模式
 */
function getInputPatterns(): string[] {
  try {
    const projectJson: ProjectJson = JSON.parse(
      fs.readFileSync(PROJECT_JSON, "utf-8"),
    );
    const packageTarget = projectJson.targets?.package;
    if (!packageTarget || !packageTarget.inputs) {
      console.warn(
        chalk.yellow("⚠️  无法从 project.json 读取 inputs，使用默认模式"),
      );
      return getDefaultPatterns();
    }

    // 过滤出路径模式（排除 "default" 和 "^default"）
    const patterns = packageTarget.inputs.filter(
      (input) => typeof input === "string" && input.includes("{projectRoot}"),
    );

    return patterns;
  } catch (error) {
    console.warn(
      chalk.yellow(
        `⚠️  读取 project.json 失败: ${(error as Error).message}，使用默认模式`,
      ),
    );
    return getDefaultPatterns();
  }
}

/**
 * 获取默认的文件模式（作为后备方案）
 */
function getDefaultPatterns(): string[] {
  return [
    "{projectRoot}/plugins/**/package.json",
    "{projectRoot}/plugins/**/crawl.js",
    "{projectRoot}/plugins/**/icon.png",
    "{projectRoot}/plugins/**/doc_root/doc.md",
    "{projectRoot}/plugins/**/doc_root/*.{jpg,jpeg,png,gif,webp,bmp,svg,ico}",
  ];
}

/**
 * 根据路径模式收集插件文件
 * @param pluginDir - 插件目录路径
 * @returns 文件列表
 */
async function collectPluginFiles(pluginDir: string): Promise<PluginFile[]> {
  const patterns = getInputPatterns();
  const files = new Map<string, PluginFile>(); // 使用 Map 避免重复文件

  for (const pattern of patterns) {
    // 将 {projectRoot}/plugins/**/ 替换为空字符串，得到相对于插件目录的模式
    // 例如: {projectRoot}/plugins/**/manifest.json -> manifest.json
    //      {projectRoot}/plugins/**/doc_root/*.{jpg,jpeg,...} -> doc_root/*.{jpg,jpeg,...}
    let resolvedPattern = pattern.replace("{projectRoot}/plugins/**/", "");

    // 将模式中的路径分隔符统一为正斜杠（glob 库期望的格式）
    resolvedPattern = resolvedPattern.replace(/\\/g, "/");

    // 构建完整的 glob 模式（相对于插件目录）
    // 使用 path.posix.join 确保使用正斜杠
    const globPattern = resolvedPattern.startsWith("/")
      ? resolvedPattern
      : resolvedPattern;

    try {
      // 使用 cwd 选项，让 glob 相对于插件目录进行匹配
      const matches = await glob(globPattern, {
        cwd: pluginDir, // 相对于插件目录
        absolute: false, // 返回相对路径
        nodir: true, // 只匹配文件，不匹配目录
      });

      for (const filePath of matches) {
        // 标准化路径分隔符（使用正斜杠）
        const normalizedRelative = filePath.replace(/\\/g, "/");

        // 构建绝对路径
        const absolutePath = path.resolve(pluginDir, normalizedRelative);

        // 验证文件确实存在
        if (!fs.existsSync(absolutePath)) {
          console.warn(
            chalk.yellow(`⚠️  文件不存在，跳过: ${normalizedRelative}`),
          );
          continue;
        }

        // 跳过已存在的文件（避免重复）
        if (!files.has(normalizedRelative)) {
          files.set(normalizedRelative, {
            relativePath: normalizedRelative,
            absolutePath: absolutePath,
          });
        }
      }
    } catch (error) {
      console.warn(
        chalk.yellow(
          `⚠️  模式匹配失败 ${pattern}: ${(error as Error).message}`,
        ),
      );
    }
  }

  return Array.from(files.values());
}

/**
 * 解析 doc.md 文件，提取引用的图片路径
 */
function extractReferencedImages(
  docPath: string,
  docRootDir: string,
): string[] {
  if (!fs.existsSync(docPath)) {
    return [];
  }

  const docContent = fs.readFileSync(docPath, "utf-8");
  const referencedImages = new Set<string>();

  // 匹配 Markdown 图片格式: ![alt](path) 或 ![alt text](path)
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownImageRegex.exec(docContent)) !== null) {
    let imagePath = match[2].trim();

    // 移除 URL 参数和锚点
    imagePath = imagePath.split("?")[0].split("#")[0];

    // 如果路径是绝对路径或 URL，跳过
    if (
      imagePath.startsWith("http://") ||
      imagePath.startsWith("https://") ||
      imagePath.startsWith("//")
    ) {
      continue;
    }

    // 处理相对路径（相对于 doc.md 所在目录）
    let fullPath: string;
    if (path.isAbsolute(imagePath)) {
      fullPath = imagePath;
    } else {
      fullPath = path.resolve(docRootDir, imagePath);
    }

    // 检查文件是否存在
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      // 确保文件在 doc_root 目录内
      const relativePath = path.relative(docRootDir, fullPath);
      if (!relativePath.startsWith("..")) {
        referencedImages.add(relativePath);
      }
    } else {
      // 如果相对路径不存在，尝试直接使用文件名
      const fileName = path.basename(imagePath);
      const filePath = path.join(docRootDir, fileName);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        referencedImages.add(fileName);
      }
    }
  }

  // 匹配 HTML img 标签: <img src="path"> 或 <img src='path'>
  const htmlImageRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = htmlImageRegex.exec(docContent)) !== null) {
    let imagePath = match[1].trim();

    // 移除 URL 参数和锚点
    imagePath = imagePath.split("?")[0].split("#")[0];

    // 如果路径是绝对路径或 URL，跳过
    if (
      imagePath.startsWith("http://") ||
      imagePath.startsWith("https://") ||
      imagePath.startsWith("//")
    ) {
      continue;
    }

    // 处理相对路径
    let fullPath: string;
    if (path.isAbsolute(imagePath)) {
      fullPath = imagePath;
    } else {
      fullPath = path.resolve(docRootDir, imagePath);
    }

    // 检查文件是否存在
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const relativePath = path.relative(docRootDir, fullPath);
      if (!relativePath.startsWith("..")) {
        referencedImages.add(relativePath);
      }
    } else {
      const fileName = path.basename(imagePath);
      const filePath = path.join(docRootDir, fileName);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        referencedImages.add(fileName);
      }
    }
  }

  return Array.from(referencedImages);
}

function readPluginPackageJson(pluginDir: string): PluginPackageJson | null {
  const packagePath = path.join(pluginDir, "package.json");
  if (!fs.existsSync(packagePath)) return null;
  const raw = fs.readFileSync(packagePath, "utf-8");
  return JSON.parse(raw) as PluginPackageJson;
}

function isV3PluginPackage(pkg: PluginPackageJson | null): boolean {
  return (pkg?.kbPackageVersion ?? 0) >= 3;
}

async function packagePlugin(
  pluginDir: string,
  outputFile: string,
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const pkg = readPluginPackageJson(pluginDir);
      if (isV3PluginPackage(pkg)) {
        const main = pkg?.main;
        if (!main || typeof main !== "string") {
          reject(new Error(`v3 package.json 缺少 main 字段`));
          return;
        }
        const mainPath = path.join(pluginDir, main);
        const hasBuildScript =
          typeof pkg?.scripts?.build === "string" &&
          pkg.scripts.build.trim().length > 0;
        if (hasBuildScript) {
          runPluginBuild(pluginDir, pkg);
        }
        if (!fs.existsSync(mainPath)) {
          reject(new Error(`main 脚本不存在: ${mainPath}`));
          return;
        }
      } else {
        reject(
          new Error(
            `只支持 package.json (v3) 插件；旧版 manifest.json (v2) 已停止支持`,
          ),
        );
        return;
      }

      if (!fs.existsSync(path.dirname(outputFile))) {
        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      }
      cliPackPlugin(pluginDir, outputFile);
      const finalSizeKB = (fs.statSync(outputFile).size / 1024).toFixed(2);
      console.log(
        chalk.green(`✅ ${path.basename(outputFile)} (${finalSizeKB} KB)`),
      );
      resolve(outputFile);
    } catch (e) {
      reject(e);
    }
  });
}

async function packageAllPlugins(outputDir: string): Promise<void> {
  console.log(chalk.blue("📦 开始打包插件...\n"));

  // 确保输出目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  } else {
    // 清空输出目录中的 .kgpg 文件
    cleanupPackedKgpgFiles(outputDir, null);
    // 旧的 <id>.icon.png 已废弃，清理掉，避免残留干扰发布
    cleanupPackedPluginIconFiles(outputDir, null);
  }

  // 读取插件目录下的所有文件夹
  const entries = fs.readdirSync(PLUGIN_DIR, { withFileTypes: true });
  const pluginDirs = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      // 排除非插件目录
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
    console.log(chalk.yellow("⚠️  未找到任何插件目录"));
    process.exit(0);
  }

  console.log(chalk.cyan(`找到 ${pluginDirs.length} 个插件目录:\n`));

  // 打包每个插件
  const promises = pluginDirs.map(async (pluginName) => {
    const pluginDir = path.join(PLUGIN_DIR, pluginName);
    const outputFile = path.join(outputDir, `${pluginName}.kgpg`);

    try {
      await packagePlugin(pluginDir, outputFile);
      // v2：不再输出 <id>.icon.png（图标在 .kgpg 固定头部）
      return { name: pluginName, success: true };
    } catch (error) {
      console.error(chalk.red(`❌ ${pluginName}: ${(error as Error).message}`));
      return {
        name: pluginName,
        success: false,
        error: (error as Error).message,
      };
    }
  });

  const results = await Promise.all(promises);

  // 输出总结
  console.log(chalk.blue("\n📊 打包总结:"));
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  console.log(chalk.green(`   ✅ 成功: ${successCount}`));
  if (failCount > 0) {
    console.log(chalk.red(`   ❌ 失败: ${failCount}`));
  }
  console.log(chalk.cyan(`\n📁 输出目录: ${outputDir}\n`));

  if (failCount > 0) {
    process.exit(1);
  }
}

async function packageSinglePlugin(
  pluginName: string,
  outputDir: string,
): Promise<void> {
  console.log(chalk.blue(`📦 开始打包插件: ${pluginName}\n`));

  const pluginDir = path.join(PLUGIN_DIR, pluginName);

  // 检查插件目录是否存在
  if (!fs.existsSync(pluginDir)) {
    console.error(chalk.red(`❌ 插件目录不存在: ${pluginDir}`));
    process.exit(1);
  }

  // 确保输出目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, `${pluginName}.kgpg`);

  try {
    await packagePlugin(pluginDir, outputFile);
    console.log(chalk.cyan(`\n📁 输出文件: ${outputFile}\n`));
  } catch (error) {
    console.error(chalk.red(`❌ 打包失败: ${(error as Error).message}`));
    process.exit(1);
  }
}

async function packageOnlyPlugins(
  pluginNames: string[],
  outputDir: string,
): Promise<void> {
  console.log(
    chalk.blue(
      `📦 开始打包指定插件 (${pluginNames.length} 个): ${pluginNames.join(
        ", ",
      )}\n`,
    ),
  );

  // 确保输出目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  } else {
    // 只保留目标插件（避免开发模式下"残留旧插件"被应用读到）
    cleanupPackedKgpgFiles(outputDir, pluginNames);
    // 旧的 <id>.icon.png 已废弃，清理掉
    cleanupPackedPluginIconFiles(outputDir, pluginNames);
  }

  const results: PluginResult[] = [];
  for (const pluginName of pluginNames) {
    const pluginDir = path.join(PLUGIN_DIR, pluginName);
    if (!fs.existsSync(pluginDir)) {
      console.error(chalk.red(`❌ 插件目录不存在: ${pluginDir}`));
      results.push({
        name: pluginName,
        success: false,
        error: "plugin dir not found",
      });
      continue;
    }
    const outputFile = path.join(outputDir, `${pluginName}.kgpg`);
    try {
      await packagePlugin(pluginDir, outputFile);
      results.push({ name: pluginName, success: true });
    } catch (error) {
      console.error(chalk.red(`❌ ${pluginName}: ${(error as Error).message}`));
      results.push({
        name: pluginName,
        success: false,
        error: (error as Error).message,
      });
    }
  }

  console.log(chalk.blue("\n📊 打包总结:"));
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  console.log(chalk.green(`   ✅ 成功: ${successCount}`));
  if (failCount > 0) console.log(chalk.red(`   ❌ 失败: ${failCount}`));
  console.log(chalk.cyan(`\n📁 输出目录: ${outputDir}\n`));

  if (failCount > 0) process.exit(1);
}

// 创建 Commander 程序
const program = new Command();

program
  .name("package-plugin.ts")
  .description("打包插件为 .kgpg 格式")
  .version("1.0.0")
  // 统一使用 --out-dir，支持多种别名格式
  .option("--out-dir <dir>", "输出目录（默认: packed）")
  .option("--outDir <dir>", "输出目录（别名）")
  .option("--output-dir <dir>", "输出目录（别名）")
  .option("--outputDir <dir>", "输出目录（别名）")
  .option(
    "--only <plugins...>",
    "只打包指定插件（会清理 packed 下的其它 .kgpg）",
  )
  .option("--plugins <plugins...>", "只打包指定插件（--only 的别名）")
  .argument("[pluginName]", "插件名称（如果提供，则只打包该插件）")
  .action(async (pluginName, options) => {
    // 处理输出目录：统一从 --out-dir 及其别名中获取
    // commander 会将 --out-dir 和 --outDir 都映射到 options.outDir
    // 将 --output-dir 和 --outputDir 都映射到 options.outputDir
    let outputDir = DEFAULT_OUTPUT_DIR;
    const outDirValue = options.outDir || options.outputDir;
    if (outDirValue) {
      outputDir = path.resolve(process.cwd(), outDirValue);
    }

    if (outputDir !== DEFAULT_OUTPUT_DIR) {
      console.log(chalk.cyan(`📁 使用自定义输出目录: ${outputDir}\n`));
    }

    // 处理插件列表：统一从 --only 或 --plugins 获取
    const pluginList = options.only || options.plugins || [];

    // 判断模式：--only/--plugins -> only 模式，pluginName -> single 模式，否则 -> all 模式
    if (pluginList.length > 0) {
      // --only/--plugins 模式
      const pluginNames = pluginList
        .flatMap((s: string) => s.split(","))
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (pluginNames.length === 0) {
        console.error(
          chalk.red("❌ 参数错误：--only/--plugins 后必须提供至少一个插件名"),
        );
        process.exit(1);
      }
      await packageOnlyPlugins(pluginNames, outputDir);
    } else if (pluginName && !pluginName.startsWith("-")) {
      // 单个插件模式
      await packageSinglePlugin(pluginName, outputDir);
    } else {
      // 打包所有插件
      await packageAllPlugins(outputDir);
    }
  });

// 解析命令行参数
program.parse();

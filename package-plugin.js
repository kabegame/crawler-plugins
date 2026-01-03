#!/usr/bin/env node

/**
 * 打包插件为 .kgpg 格式
 * 根据 project.json 中的 inputs 字段路径模式计算需要打包的文件
 * 用法:
 *   node package-plugin.js              # 打包所有插件
 *   node package-plugin.js <插件名称>   # 打包指定插件
 *   node package-plugin.js --only <插件名...>  # 只打包指定插件（会清理 packed 下的其它 .kgpg）
 *   node package-plugin.js --only a,b          # 逗号分隔也支持
 */

import fs from "fs";
import path from "path";
import { createWriteStream } from "fs";
import archiver from "archiver";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { glob } from "glob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 插件目录和输出目录（默认输出到 packed，可通过参数覆盖）
const PLUGIN_DIR = path.join(__dirname, "plugins");
const DEFAULT_OUTPUT_DIR = path.join(__dirname, "packed");
const PROJECT_JSON = path.join(__dirname, "project.json");

const PLUGIN_ICON_SOURCE_NAME = "icon.png";
const PLUGIN_ICON_PACKED_SUFFIX = ".icon.png";

function parseArgs(argv) {
  // argv: process.argv.slice(2)
  const result = {
    mode: "all", // all | single | only
    pluginNames: [],
    outDir: undefined, // string | undefined
    kgpgOnly: false, // boolean: 如果为 true，只输出 .kgpg 文件，不复制图标文件
  };

  if (!argv || argv.length === 0) return result;

  // 先解析通用参数（例如 --outDir），其余留给 mode 解析
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    // 支持：--outDir=xxx / --out-dir=xxx / --outputDir=xxx / --output-dir=xxx
    const m = a.match(
      /^--(?:outDir|outdir|out-dir|outputDir|output-dir)=(.+)$/
    );
    if (m) {
      result.outDir = m[1];
      continue;
    }

    // 支持：--outDir xxx / --out-dir xxx / --outputDir xxx / --output-dir xxx
    if (
      a === "--outDir" ||
      a === "--outdir" ||
      a === "--out-dir" ||
      a === "--outputDir" ||
      a === "--output-dir"
    ) {
      const v = argv[i + 1];
      if (!v) {
        console.error("❌ 参数错误：--outDir 后必须提供目录路径");
        process.exit(1);
      }
      result.outDir = v;
      i++;
      continue;
    }

    // 支持：--kgpg-only / --kgpgOnly (只输出 .kgpg 文件，不复制图标文件)
    if (a === "--kgpg-only" || a === "--kgpgOnly") {
      result.kgpgOnly = true;
      continue;
    }

    rest.push(a);
  }

  // --only mode (multi plugin)
  const onlyIdx = rest.findIndex((a) => a === "--only" || a === "--plugins");
  if (onlyIdx !== -1) {
    const after = rest.slice(onlyIdx + 1);
    const names = after
      .flatMap((s) => s.split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) {
      console.error("❌ 参数错误：--only 后必须提供至少一个插件名");
      process.exit(1);
    }
    result.mode = "only";
    result.pluginNames = Array.from(new Set(names));
    return result;
  }

  // Legacy: single plugin by first arg
  const first = rest[0];
  if (first && !first.startsWith("-")) {
    result.mode = "single";
    result.pluginNames = [first];
    return result;
  }

  if (rest.length === 0) return result;

  console.error(`❌ 未识别的参数: ${rest.join(" ")}`);
  process.exit(1);
}

function cleanupPackedKgpgFiles(outputDir, keepNames = null) {
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

function cleanupPackedPluginIconFiles(outputDir, keepNames = null) {
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
function getInputPatterns() {
  try {
    const projectJson = JSON.parse(fs.readFileSync(PROJECT_JSON, "utf-8"));
    const packageTarget = projectJson.targets?.package;
    if (!packageTarget || !packageTarget.inputs) {
      console.warn("⚠️  无法从 project.json 读取 inputs，使用默认模式");
      return getDefaultPatterns();
    }

    // 过滤出路径模式（排除 "default" 和 "^default"）
    const patterns = packageTarget.inputs.filter(
      (input) => typeof input === "string" && input.includes("{projectRoot}")
    );

    return patterns;
  } catch (error) {
    console.warn(`⚠️  读取 project.json 失败: ${error.message}，使用默认模式`);
    return getDefaultPatterns();
  }
}

/**
 * 获取默认的文件模式（作为后备方案）
 */
function getDefaultPatterns() {
  return [
    "{projectRoot}/plugins/**/manifest.json",
    "{projectRoot}/plugins/**/config.json",
    "{projectRoot}/plugins/**/crawl.rhai",
    "{projectRoot}/plugins/**/icon.png",
    "{projectRoot}/plugins/**/doc_root/doc.md",
    "{projectRoot}/plugins/**/doc_root/*.{jpg,jpeg,png,gif,webp,bmp,svg,ico}",
  ];
}

/**
 * 根据路径模式收集插件文件
 * @param {string} pluginDir - 插件目录路径
 * @returns {Array<{relativePath: string, absolutePath: string}>} - 文件列表
 */
async function collectPluginFiles(pluginDir) {
  const patterns = getInputPatterns();
  const files = new Map(); // 使用 Map 避免重复文件

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
          console.warn(`⚠️  文件不存在，跳过: ${normalizedRelative}`);
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
      console.warn(`⚠️  模式匹配失败 ${pattern}: ${error.message}`);
    }
  }

  return Array.from(files.values());
}

/**
 * 解析 doc.md 文件，提取引用的图片路径
 */
function extractReferencedImages(docPath, docRootDir) {
  if (!fs.existsSync(docPath)) {
    return [];
  }

  const docContent = fs.readFileSync(docPath, "utf-8");
  const referencedImages = new Set();

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
    let fullPath;
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
    let fullPath;
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

async function packagePlugin(pluginDir, outputFile) {
  return new Promise(async (resolve, reject) => {
    // 检查 manifest.json 是否存在
    const manifestPath = path.join(pluginDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      reject(new Error(`manifest.json 不存在: ${manifestPath}`));
      return;
    }

    // 读取 manifest.json 获取插件名称
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch (error) {
      reject(new Error(`无法解析 manifest.json: ${error.message}`));
      return;
    }

    // 根据 project.json 的 inputs 模式收集文件
    let pluginFiles;
    try {
      pluginFiles = await collectPluginFiles(pluginDir);
    } catch (error) {
      reject(new Error(`收集插件文件失败: ${error.message}`));
      return;
    }

    // 检查必需文件是否存在
    const requiredFiles = ["manifest.json", "crawl.rhai"];
    const missingFiles = requiredFiles.filter(
      (file) => !pluginFiles.some((f) => f.relativePath === file)
    );

    if (missingFiles.length > 0) {
      reject(new Error(`缺少必需文件: ${missingFiles.join(", ")}`));
      return;
    }

    // 创建 ZIP 文件
    const output = createWriteStream(outputFile);
    const archive = archiver("zip", {
      zlib: { level: 9 }, // 最高压缩级别
    });

    output.on("close", () => {
      const sizeKB = (archive.pointer() / 1024).toFixed(2);
      console.log(
        `✅ ${path.basename(outputFile)} (${sizeKB} KB, ${
          pluginFiles.length
        } 个文件)`
      );
      resolve(outputFile);
    });

    archive.on("error", (err) => {
      reject(err);
    });

    archive.pipe(output);

    // 添加所有收集到的文件
    for (const fileInfo of pluginFiles) {
      if (fs.existsSync(fileInfo.absolutePath)) {
        archive.file(fileInfo.absolutePath, { name: fileInfo.relativePath });
      } else {
        console.warn(`⚠️  文件不存在，跳过: ${fileInfo.relativePath}`);
      }
    }

    archive.finalize();
  });
}

function copyPluginIconToPacked(pluginDir, pluginName, outputDir) {
  const src = path.join(pluginDir, PLUGIN_ICON_SOURCE_NAME);
  if (!fs.existsSync(src)) {
    return false;
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const dst = path.join(outputDir, `${pluginName}${PLUGIN_ICON_PACKED_SUFFIX}`);
  fs.copyFileSync(src, dst);
  return true;
}

async function packageAllPlugins(outputDir, options = {}) {
  const { kgpgOnly = false } = options;
  console.log("📦 开始打包插件...\n");

  // 确保输出目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  } else {
    // 清空输出目录中的 .kgpg 文件
    cleanupPackedKgpgFiles(outputDir, null);
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
    console.log("⚠️  未找到任何插件目录");
    process.exit(0);
  }

  console.log(`找到 ${pluginDirs.length} 个插件目录:\n`);

  // 打包每个插件
  const promises = pluginDirs.map(async (pluginName) => {
    const pluginDir = path.join(PLUGIN_DIR, pluginName);
    const outputFile = path.join(outputDir, `${pluginName}.kgpg`);

    try {
      await packagePlugin(pluginDir, outputFile);
      if (!kgpgOnly) {
        copyPluginIconToPacked(pluginDir, pluginName, outputDir);
      }
      return { name: pluginName, success: true };
    } catch (error) {
      console.error(`❌ ${pluginName}: ${error.message}`);
      return { name: pluginName, success: false, error: error.message };
    }
  });

  const results = await Promise.all(promises);

  // 输出总结
  console.log("\n📊 打包总结:");
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  console.log(`   ✅ 成功: ${successCount}`);
  if (failCount > 0) {
    console.log(`   ❌ 失败: ${failCount}`);
  }
  console.log(`\n📁 输出目录: ${outputDir}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

async function packageSinglePlugin(pluginName, outputDir, options = {}) {
  const { kgpgOnly = false } = options;
  console.log(`📦 开始打包插件: ${pluginName}\n`);

  const pluginDir = path.join(PLUGIN_DIR, pluginName);

  // 检查插件目录是否存在
  if (!fs.existsSync(pluginDir)) {
    console.error(`❌ 插件目录不存在: ${pluginDir}`);
    process.exit(1);
  }

  // 确保输出目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, `${pluginName}.kgpg`);

  try {
    await packagePlugin(pluginDir, outputFile);
    if (!kgpgOnly) {
      copyPluginIconToPacked(pluginDir, pluginName, outputDir);
    }
    console.log(`\n📁 输出文件: ${outputFile}\n`);
  } catch (error) {
    console.error(`❌ 打包失败: ${error.message}`);
    process.exit(1);
  }
}

async function packageOnlyPlugins(pluginNames, outputDir, options = {}) {
  const { kgpgOnly = false } = options;
  console.log(
    `📦 开始打包指定插件 (${pluginNames.length} 个): ${pluginNames.join(
      ", "
    )}\n`
  );

  // 确保输出目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  } else {
    // 只保留目标插件（避免开发模式下"残留旧插件"被应用读到）
    cleanupPackedKgpgFiles(outputDir, pluginNames);
    if (!kgpgOnly) {
      cleanupPackedPluginIconFiles(outputDir, pluginNames);
    }
  }

  const results = [];
  for (const pluginName of pluginNames) {
    const pluginDir = path.join(PLUGIN_DIR, pluginName);
    if (!fs.existsSync(pluginDir)) {
      console.error(`❌ 插件目录不存在: ${pluginDir}`);
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
      if (!kgpgOnly) {
        copyPluginIconToPacked(pluginDir, pluginName, outputDir);
      }
      results.push({ name: pluginName, success: true });
    } catch (error) {
      console.error(`❌ ${pluginName}: ${error.message}`);
      results.push({ name: pluginName, success: false, error: error.message });
    }
  }

  console.log("\n📊 打包总结:");
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  console.log(`   ✅ 成功: ${successCount}`);
  if (failCount > 0) console.log(`   ❌ 失败: ${failCount}`);
  console.log(`\n📁 输出目录: ${outputDir}\n`);

  if (failCount > 0) process.exit(1);
}

// 主函数
const args = parseArgs(process.argv.slice(2));
const outputDir = args.outDir
  ? path.resolve(process.cwd(), args.outDir)
  : DEFAULT_OUTPUT_DIR;

const options = { kgpgOnly: args.kgpgOnly };

// 给自定义 outDir 一个显眼提示，避免误操作（例如指向生产数据目录）
if (args.outDir) {
  console.log(`📁 使用自定义输出目录: ${outputDir}\n`);
}

if (args.kgpgOnly) {
  console.log(`ℹ️  仅输出 .kgpg 文件（跳过图标文件）\n`);
}

if (args.mode === "single") {
  packageSinglePlugin(args.pluginNames[0], outputDir, options).catch((error) => {
    console.error("❌ 打包失败:", error.message);
    process.exit(1);
  });
} else if (args.mode === "only") {
  packageOnlyPlugins(args.pluginNames, outputDir, options).catch((error) => {
    console.error("❌ 打包失败:", error.message);
    process.exit(1);
  });
} else {
  packageAllPlugins(outputDir, options).catch((error) => {
    console.error("❌ 打包失败:", error.message);
    process.exit(1);
  });
}

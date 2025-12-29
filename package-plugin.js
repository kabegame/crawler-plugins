#!/usr/bin/env node

/**
 * 打包插件为 .kgpg 格式
 * 用法: 
 *   node package-plugin.js              # 打包所有插件
 *   node package-plugin.js <插件名称>   # 打包指定插件
 */

import fs from "fs";
import path from "path";
import { createWriteStream } from "fs";
import archiver from "archiver";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 插件目录和输出目录
const PLUGIN_DIR = __dirname;
const OUTPUT_DIR = path.join(__dirname, "packed");

function packagePlugin(pluginDir, outputFile) {
  return new Promise((resolve, reject) => {
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

    // 创建 ZIP 文件
    const output = createWriteStream(outputFile);
    const archive = archiver("zip", {
      zlib: { level: 9 }, // 最高压缩级别
    });

    output.on("close", () => {
      const sizeKB = (archive.pointer() / 1024).toFixed(2);
      console.log(
        `✅ ${path.basename(outputFile)} (${sizeKB} KB)`
      );
      resolve(outputFile);
    });

    archive.on("error", (err) => {
      reject(err);
    });

    archive.pipe(output);

    // 添加文件到 ZIP
    const files = fs.readdirSync(pluginDir);

    for (const file of files) {
      const filePath = path.join(pluginDir, file);
      const stat = fs.statSync(filePath);

      // 跳过 .git 目录、node_modules、packed 目录等
      if (file === ".git" || file === "node_modules" || file === "packed" || file === "package.json" || file === "package-plugin.js" || file === "README.md") {
        continue;
      }

      if (stat.isFile()) {
        archive.file(filePath, { name: file });
      } else if (stat.isDirectory()) {
        archive.directory(filePath, file);
      }
    }

    archive.finalize();
  });
}

async function packageAllPlugins() {
  console.log("📦 开始打包插件...\n");

  // 确保输出目录存在
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  } else {
    // 清空输出目录中的 .kgpg 文件
    const files = fs.readdirSync(OUTPUT_DIR);
    for (const file of files) {
      const filePath = path.join(OUTPUT_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && file.endsWith(".kgpg")) {
        fs.unlinkSync(filePath);
      }
    }
  }

  // 读取插件目录下的所有文件夹
  const entries = fs.readdirSync(PLUGIN_DIR, { withFileTypes: true });
  const pluginDirs = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      // 排除非插件目录
      const dirName = entry.name;
      return dirName !== "node_modules" && dirName !== "packed" && dirName !== ".git";
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
    const outputFile = path.join(OUTPUT_DIR, `${pluginName}.kgpg`);

    try {
      await packagePlugin(pluginDir, outputFile);
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
  console.log(`\n📁 输出目录: ${OUTPUT_DIR}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

async function packageSinglePlugin(pluginName) {
  console.log(`📦 开始打包插件: ${pluginName}\n`);

  const pluginDir = path.join(PLUGIN_DIR, pluginName);

  // 检查插件目录是否存在
  if (!fs.existsSync(pluginDir)) {
    console.error(`❌ 插件目录不存在: ${pluginDir}`);
    process.exit(1);
  }

  // 确保输出目录存在
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outputFile = path.join(OUTPUT_DIR, `${pluginName}.kgpg`);

  try {
    await packagePlugin(pluginDir, outputFile);
    console.log(`\n📁 输出文件: ${outputFile}\n`);
  } catch (error) {
    console.error(`❌ 打包失败: ${error.message}`);
    process.exit(1);
  }
}

// 主函数
const pluginName = process.argv[2];

if (pluginName) {
  packageSinglePlugin(pluginName).catch((error) => {
    console.error("❌ 打包失败:", error.message);
    process.exit(1);
  });
} else {
  packageAllPlugins().catch((error) => {
    console.error("❌ 打包失败:", error.message);
    process.exit(1);
  });
}


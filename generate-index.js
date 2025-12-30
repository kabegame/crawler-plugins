#!/usr/bin/env node

/**
 * 生成插件索引文件 index.json
 * 版本信息从 package.json 读取
 * 用法: node generate-index.js [repo_owner] [repo_name]
 * 
 * 示例: node generate-index.js kabegame crawler-plugins
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 插件目录和输出目录
const PLUGIN_DIR = path.join(__dirname, "plugins");
const OUTPUT_DIR = path.join(__dirname, "packed");
const INDEX_FILE = path.join(OUTPUT_DIR, "index.json");
const PACKAGE_JSON = path.join(__dirname, "package.json");

// 从 package.json 读取版本信息
let packageVersion = "latest";
try {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf-8"));
  packageVersion = packageJson.version || "latest";
} catch (error) {
  console.warn(`⚠️  无法读取 package.json，使用默认版本: ${packageVersion}`);
}

// 从环境变量或参数获取 Release 信息
// 默认仓库: https://github.com/kabegame/crawler-plugins
// Release tag 格式: v{version}，例如 v1.0.0
//
// 注意：GitHub Actions 在 push 到 main 时 GITHUB_REF_NAME=main，会导致生成的 index.json 写成 main。
// 这里优先使用 "vX.Y.Z" 这种 tag；否则回退到 package.json 的版本推导出的 tag。
const envRefName = process.env.GITHUB_REF_NAME;
const envTag = envRefName && /^v\d+\.\d+\.\d+.*$/i.test(envRefName) ? envRefName : null;
const RELEASE_TAG = envTag || (packageVersion !== "latest" ? `v${packageVersion}` : "latest");
const REPO_OWNER = process.argv[2] || process.env.GITHUB_REPOSITORY_OWNER || "kabegame";
const REPO_NAME = process.argv[3] || process.env.GITHUB_REPOSITORY?.split("/")[1] || "crawler-plugins";

// GitHub Release 下载 URL 模板
// 格式: https://github.com/{owner}/{repo}/releases/download/{tag}/{filename}
const GITHUB_RELEASE_BASE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${RELEASE_TAG}`;

function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}

function calculateSHA256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

function generateIndex() {
  console.log("📝 生成插件索引文件...");
  console.log(`   仓库: ${REPO_OWNER}/${REPO_NAME}`);
  console.log(`   版本 (package.json): ${packageVersion}`);
  console.log(`   Release Tag: ${RELEASE_TAG}`);
  console.log(`   下载基础 URL: ${GITHUB_RELEASE_BASE}\n`);

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
    console.error("❌ 未找到任何插件目录");
    process.exit(1);
  }

  const plugins = [];

  for (const pluginName of pluginDirs) {
    const pluginDir = path.join(PLUGIN_DIR, pluginName);
    const manifestPath = path.join(pluginDir, "manifest.json");
    const kgpgFile = path.join(OUTPUT_DIR, `${pluginName}.kgpg`);

    // 检查 manifest.json 是否存在
    if (!fs.existsSync(manifestPath)) {
      console.warn(`⚠️  跳过 ${pluginName}: manifest.json 不存在`);
      continue;
    }

    // 检查 .kgpg 文件是否存在
    if (!fs.existsSync(kgpgFile)) {
      console.warn(`⚠️  跳过 ${pluginName}: ${pluginName}.kgpg 不存在`);
      continue;
    }

    try {
      // 读取 manifest.json
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      // 获取文件大小
      const stats = fs.statSync(kgpgFile);
      const fileSize = stats.size;

      // 计算 SHA256 校验和
      const sha256 = calculateSHA256(kgpgFile);

      // 构建插件信息（符合后端期望的格式）
      // 后端期望字段: id, name, version, description, downloadUrl, sizeBytes, sha256
      // 额外包含 author 字段以保持与 manifest.json 的一致性
      const pluginInfo = {
        id: pluginName,
        name: manifest.name || pluginName,
        version: manifest.version || "1.0.0",
        description: manifest.description || "",
        author: manifest.author || "", // 从 manifest.json 读取作者信息
        downloadUrl: `${GITHUB_RELEASE_BASE}/${pluginName}.kgpg`, // camelCase，符合后端期望
        sizeBytes: fileSize, // 数字格式，符合后端期望
        sha256: sha256, // SHA256 校验和，必需字段
      };

      plugins.push(pluginInfo);
      console.log(
        `✅ ${pluginName}: ${pluginInfo.name} v${pluginInfo.version} (${formatFileSize(fileSize)}, SHA256: ${sha256.substring(0, 8)}...)`
      );
    } catch (error) {
      console.error(`❌ ${pluginName}: ${error.message}`);
    }
  }

  // 生成索引对象
  const index = {
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

  console.log(`\n📄 索引文件已生成: ${INDEX_FILE}`);
  console.log(`   包含 ${plugins.length} 个插件\n`);

  return INDEX_FILE;
}

try {
  generateIndex();
} catch (error) {
  console.error("❌ 生成索引失败:", error.message);
  process.exit(1);
}


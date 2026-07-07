#!/usr/bin/env bun

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PLUGINS_DIR = path.join(ROOT, "plugins");
const KABEGAME_ENGINE = ">=4.3.0";

type JsonObject = Record<string, unknown>;

function readJsonObject(file: string): JsonObject {
  const value = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${file} must contain a JSON object`);
  }
  return value as JsonObject;
}

function writeJsonObject(file: string, value: JsonObject): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

function listFiles(dir: string, predicate?: (rel: string) => boolean): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];

  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const rel = path.relative(dir, fullPath).replace(/\\/g, "/");
      if (!predicate || predicate(rel)) out.push(rel);
    }
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function collectDoc(pluginDir: string): JsonObject | undefined {
  const docRoot = path.join(pluginDir, "doc_root");
  const docs = listFiles(docRoot, (rel) => {
    const base = path.basename(rel);
    return !rel.includes("/") && (base === "doc.md" || /^doc\.[^.]+\.md$/.test(base));
  });
  if (docs.length === 0) return undefined;

  const docMap: JsonObject = {};
  for (const rel of docs) {
    const base = path.basename(rel);
    const key = base === "doc.md" ? "default" : base.slice("doc.".length, -".md".length);
    docMap[key] = `doc_root/${rel}`;
  }
  return docMap;
}

function collectMetadataMigrations(pluginDir: string): string[] | undefined {
  const migrationRoot = path.join(pluginDir, "metadata_migrations");
  const files = listFiles(migrationRoot, (rel) => /^v\d+\.rhai$/.test(rel));
  if (files.length === 0) return undefined;

  const versions = files.map((rel) => {
    const version = Number(rel.slice(1, -".rhai".length));
    return { rel, version };
  }).sort((a, b) => a.version - b.version);

  for (let i = 0; i < versions.length; i += 1) {
    const expected = i + 1;
    if (versions[i].version !== expected) {
      throw new Error(
        `${pluginDir}: metadata_migrations must be continuous from v1, missing v${expected}`,
      );
    }
  }

  return versions.map((item) => `metadata_migrations/${item.rel}`);
}

function copyFlatI18nKeys(
  source: JsonObject,
  target: JsonObject,
  baseKey: string,
): void {
  if (baseKey !== "name" && typeof source[baseKey] === "string") {
    target[baseKey] = source[baseKey];
  }

  const prefix = `${baseKey}.`;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") continue;
    if (key.startsWith(prefix)) target[key] = value;
  }
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function migratePlugin(pluginName: string): void {
  const pluginDir = path.join(PLUGINS_DIR, pluginName);
  const manifestPath = path.join(pluginDir, "manifest.json");
  const configPath = path.join(pluginDir, "config.json");
  const packagePath = path.join(pluginDir, "package.json");
  if (!fs.existsSync(manifestPath)) {
    if (fs.existsSync(packagePath)) {
      const pkg = readJsonObject(packagePath);
      if (pkg.kbPackageVersion === 3) {
        console.log(`${pluginName}: already migrated`);
        return;
      }
    }
    throw new Error(`${pluginName}: manifest.json not found`);
  }

  const manifest = readJsonObject(manifestPath);
  const config = fs.existsSync(configPath) ? readJsonObject(configPath) : {};
  const hasJs = fs.existsSync(path.join(pluginDir, "crawl.js"));
  const hasRhai = fs.existsSync(path.join(pluginDir, "crawl.rhai"));
  if (!hasJs && !hasRhai) {
    throw new Error(`${pluginName}: crawl.js or crawl.rhai is required`);
  }

  const pkg: JsonObject = {
    name: pluginName,
    version: typeof manifest.version === "string" ? manifest.version : "1.0.0",
    private: true,
  };

  copyFlatI18nKeys(manifest, pkg, "name");
  const legacyDefaultName = manifest.name;
  if (
    typeof legacyDefaultName === "string" &&
    hasCjk(legacyDefaultName) &&
    typeof pkg["name.zh"] !== "string"
  ) {
    pkg["name.zh"] = legacyDefaultName;
  }
  copyFlatI18nKeys(manifest, pkg, "description");

  if (typeof manifest.author === "string") pkg.author = manifest.author;
  pkg.kbPackageVersion = 3;
  pkg.engines = { kabegame: KABEGAME_ENGINE };
  pkg.main = hasJs ? "crawl.js" : "crawl.rhai";
  pkg.kbBackend = hasJs ? "webview" : "rhai";

  if (typeof config.baseUrl === "string") pkg.kbBaseUrl = config.baseUrl;
  pkg.kbConfig = Array.isArray(config.var) ? config.var : [];

  if (fs.existsSync(path.join(pluginDir, "icon.png"))) {
    pkg.kbIcon = "icon.png";
  }

  const doc = collectDoc(pluginDir);
  if (doc) pkg.kbDoc = doc;

  const recommendedConfigs = listFiles(
    path.join(pluginDir, "configs"),
    (rel) => rel.endsWith(".json"),
  ).map((rel) => `configs/${rel}`);
  if (recommendedConfigs.length > 0) {
    pkg.kbRecommendedConfigs = recommendedConfigs;
  }

  const providers = listFiles(
    path.join(pluginDir, "providers"),
    (rel) => rel.endsWith(".json5") || rel.endsWith(".json"),
  ).map((rel) => `providers/${rel}`);
  if (providers.length > 0) {
    pkg.kbPathQLProviders = providers;
  }

  const migrations = collectMetadataMigrations(pluginDir);
  if (migrations) pkg.kbMetadataMigrations = migrations;

  if (fs.existsSync(path.join(pluginDir, "templates", "description.ejs"))) {
    pkg.kbDescriptionTemplate = "templates/description.ejs";
  }

  writeJsonObject(packagePath, pkg);
  fs.unlinkSync(manifestPath);
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);

  if (hasJs && hasRhai) {
    fs.unlinkSync(path.join(pluginDir, "crawl.rhai"));
  }

  console.log(`${pluginName}: migrated to v3 (${pkg.kbBackend})`);
}

const pluginNames = fs
  .readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

for (const pluginName of pluginNames) {
  migratePlugin(pluginName);
}

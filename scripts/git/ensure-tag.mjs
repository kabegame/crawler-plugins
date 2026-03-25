import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

function execGit(args, opts = {}) {
  return execFileSync("git", args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    ...opts,
  }).trim();
}

function tryExecGit(args, opts = {}) {
  try {
    return { ok: true, out: execGit(args, opts) };
  } catch (e) {
    const stderr = e?.stderr?.toString?.() ?? "";
    const stdout = e?.stdout?.toString?.() ?? "";
    return { ok: false, err: e, stdout, stderr };
  }
}

function repoRoot() {
  return execGit(["rev-parse", "--show-toplevel"]);
}

function readPackageVersion(root) {
  const pkgPath = path.join(root, "package.json");
  const content = fs.readFileSync(pkgPath, "utf8");
  const json = JSON.parse(content);
  const v = String(json.version || "").trim();
  if (!v) throw new Error(`Missing version in ${pkgPath}`);
  return v;
}

function toTag(version) {
  const v = String(version).trim();
  return v.startsWith("v") ? v : `v${v}`;
}

function tagExists(tag) {
  const res = tryExecGit(["tag", "-l", tag]);
  return res.ok && res.out === tag;
}

function main() {
  // 仅确保本地存在 vX.Y.Z 注释 tag。
  // 人读日志 → stderr；若本次新建了 tag，stdout 仅输出一行 tag 名（供 pre-push 决定是否 git push tag）。
  try {
    const root = repoRoot();
    const version = readPackageVersion(root);
    const tag = toTag(version);

    if (tagExists(tag)) {
      process.stderr.write(`[ensure-tag] tag '${tag}' already exists, skip\n`);
      return;
    }

    const create = tryExecGit(["tag", "-a", tag, "-m", `crawler-plugins ${tag}`], { cwd: root });
    if (create.ok) {
      process.stderr.write(`[ensure-tag] created local tag '${tag}'\n`);
      process.stdout.write(`${tag}\n`);
    } else {
      process.stderr.write(
        `[ensure-tag] warn: failed to create tag '${tag}', skip (non-blocking)\n${create.stderr || create.stdout}\n`
      );
    }
  } catch (e) {
    process.stderr.write(`[ensure-tag] warn: ensure-tag failed, skip (non-blocking)\n${e?.message ?? e}\n`);
  }
}

main();

// 生成 templates/description.ejs：把 description.src.ejs 里独占一行的 `@@EJS_LIB@@`
// 换成宿主（apps/kabegame）所用同一份 ejs 的浏览器版，保证来源插件模板的编译语义与宿主一致。
//
// 库代码以 `<%- "…" %>` 的 JS 字符串字面量嵌入：其中的 `%` 写成 %，宿主 EJS 解析本模板时
// 就不会把库里的 `<%` / `%>` 当成标签。库里不能出现 `<script` / `</script`：前者会被宿主补 nonce
// 的正则改写，后者会提前结束脚本块。

const pluginDir = new URL("..", import.meta.url);
const srcPath = new URL("templates/description.src.ejs", pluginDir);
const outPath = new URL("templates/description.ejs", pluginDir);
const MARKER = /^[ \t]*@@EJS_LIB@@[ \t]*$/m;

async function exists(url: URL): Promise<boolean> {
  try {
    await Deno.stat(url);
    return true;
  } catch {
    return false;
  }
}

// 优先取宿主应用自己的依赖；找不到再沿目录向上找任一 node_modules/ejs。
async function findEjsLib(): Promise<URL> {
  for (let dir = pluginDir; ; ) {
    for (const rel of ["apps/kabegame/node_modules/ejs/ejs.min.js", "node_modules/ejs/ejs.min.js"]) {
      const candidate = new URL(rel, dir);
      if (await exists(candidate)) return candidate;
    }
    const parent = new URL("..", dir);
    if (parent.href === dir.href) break;
    dir = parent;
  }
  throw new Error("找不到 ejs/ejs.min.js：请在仓库根执行 deno install");
}

const libUrl = await findEjsLib();
const lib = await Deno.readTextFile(libUrl);
for (const bad of ["<script", "</script"]) {
  if (lib.toLowerCase().includes(bad)) throw new Error(`ejs.min.js 含有 ${bad}，不能直接内嵌`);
}

const src = await Deno.readTextFile(srcPath);
if (!MARKER.test(src)) throw new Error("description.src.ejs 缺少独占一行的 @@EJS_LIB@@");

const literal = JSON.stringify(lib).replace(/%/g, "\\u0025");
const out = src.replace(MARKER, () => `<%- ${literal} %>`);
await Deno.writeTextFile(outPath, out);

const pkg = JSON.parse(await Deno.readTextFile(new URL("./package.json", libUrl)));
console.log(`[kabegame-server] templates/description.ejs 已生成（内嵌 ejs ${pkg.version}，${out.length} 字符）`);

// SQLite 读取器对照测试：用 Python 自带的 sqlite3 现场建库，覆盖多层 b-tree、溢出页、WITHOUT ROWID 表、
// 自动索引，以及没有合并回主库的 WAL；期望值由同一个 Python 进程用 SQL 查出。
import { decodeRecord, openDatabase, type SqliteFile, SqliteSnapshotChanged } from "../src/sqlite/reader.js";

const PY = String.raw`
import sqlite3, shutil, json, sys, os
out = sys.argv[1]
src = os.path.join(out, "src.db")
con = sqlite3.connect(src)
con.execute("PRAGMA page_size=1024")
con.execute("PRAGMA journal_mode=WAL")
con.execute("PRAGMA wal_autocheckpoint=0")
con.execute("CREATE TABLE files (hash_id INTEGER PRIMARY KEY, name TEXT, size INTEGER, ratio REAL, data BLOB)")
con.execute("CREATE TABLE url_map (hash_id INTEGER, url_id INTEGER, PRIMARY KEY (hash_id, url_id))")
con.execute("CREATE TABLE mappings (tag_id INTEGER, hash_id INTEGER, PRIMARY KEY (tag_id, hash_id)) WITHOUT ROWID")
con.execute("CREATE UNIQUE INDEX mappings_hash_tag ON mappings (hash_id, tag_id)")
rows = []
for i in range(1, 1500):
    name = ("名前-%d-" % i) * (1 + (i * 37) % 120)   # 一部分超过一页，走溢出页
    rows.append((i * 3, name, i * 1000003 - 5000000, i / 7, bytes([i % 256]) * (i % 50)))
con.executemany("INSERT INTO files VALUES (?,?,?,?,?)", rows)
con.execute("INSERT INTO files VALUES (?,?,?,?,?)", (2**40, None, -2**62, -0.5, b""))
con.executemany("INSERT INTO url_map VALUES (?,?)", [(i % 300, i) for i in range(4000)])
con.executemany("INSERT OR IGNORE INTO mappings VALUES (?,?)", [((i * 7919) % 1000, i % 400) for i in range(20000)])
con.commit()
con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
# 检查点之后的改动只留在 WAL 里
con.execute("UPDATE files SET name = 'wal-' || name WHERE hash_id % 9 = 0")
con.execute("DELETE FROM files WHERE hash_id BETWEEN 3000 AND 3300")
con.executemany("INSERT INTO mappings VALUES (?,?)", [(5000 + i, 77) for i in range(50)])
con.commit()
# copy.db 给读取器；verify.db 给这里查期望值（sqlite3 关闭连接时会把 WAL 合并回主库）
for name in ("copy.db", "verify.db"):
    for suffix in ("", "-wal"):
        shutil.copyfile(src + suffix, os.path.join(out, name + suffix))
con.execute("UPDATE files SET name = 'uncommitted' WHERE hash_id = 3")   # 未提交，不应被读到
def enc(v):
    if isinstance(v, bytes): return {"blob": v.hex()}
    if isinstance(v, int) and abs(v) > 2**53: return {"big": str(v)}
    return v
c2 = sqlite3.connect(os.path.join(out, "verify.db"))
q = lambda sql, *a: [[enc(x) for x in r] for r in c2.execute(sql, a)]
print(json.dumps({
    "files": q("SELECT hash_id, hash_id, name, size, ratio, data FROM files ORDER BY hash_id"),
    "url_map_150": q("SELECT hash_id, url_id FROM url_map WHERE hash_id = 150 ORDER BY url_id"),
    "url_map_299": q("SELECT hash_id, url_id FROM url_map WHERE hash_id = 299 ORDER BY url_id"),
    "url_map_999": q("SELECT hash_id, url_id FROM url_map WHERE hash_id = 999"),
    "by_hash_77": q("SELECT hash_id, tag_id FROM mappings WHERE hash_id = 77 ORDER BY tag_id"),
    "by_hash_0": q("SELECT hash_id, tag_id FROM mappings WHERE hash_id = 0 ORDER BY tag_id"),
    "mappings": q("SELECT tag_id, hash_id FROM mappings ORDER BY tag_id, hash_id"),
}))
`;

type Json = null | number | string | { blob: string } | { big: string };

function encode(v: unknown): Json {
  if (v instanceof Uint8Array) return { blob: [...v].map((b) => b.toString(16).padStart(2, "0")).join("") };
  if (typeof v === "bigint") return { big: String(v) };
  return v as Json;
}

function fileOf(path: string): SqliteFile {
  const f = Deno.openSync(path);
  return {
    size: f.statSync().size,
    readAt(offset, length) {
      const buf = new Uint8Array(length);
      f.seekSync(offset, Deno.SeekMode.Start);
      let got = 0;
      while (got < length) {
        const n = f.readSync(buf.subarray(got));
        if (!n) break;
        got += n;
      }
      return buf.subarray(0, got);
    },
    version: () => {
      const s = Deno.statSync(path);
      return [s.size, s.mtime?.getTime()];
    },
  };
}

const dir = await Deno.makeTempDir();
const py = new Deno.Command("python3", { args: ["-I", "-c", PY, dir], stdout: "piped", stderr: "inherit" }).outputSync();
if (!py.success) throw new Error("python3 建库失败");
const expected = JSON.parse(new TextDecoder().decode(py.stdout));
const open = () => openDatabase({ db: fileOf(`${dir}/copy.db`), wal: fileOf(`${dir}/copy.db-wal`) });

const assertSame = (got: unknown, want: unknown, what: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${what} 不一致\n期望 ${w.slice(0, 400)}\n实际 ${g.slice(0, 400)}`);
};

Deno.test("WAL 快照里有已提交的改动", () => {
  const db = open();
  if (db.walFrameCount === 0) throw new Error("WAL 里应当有帧");
});

Deno.test("rowid 表全表扫描（多层 b-tree、溢出页、INTEGER PRIMARY KEY 存为 NULL）", () => {
  const db = open();
  const got = [...db.rows(db.rootOf("files")!)].map(([rowid, v]) => [rowid, ...v].map(encode));
  // 别名列在记录里是 NULL，值就是 rowid
  assertSame(got.map(([rowid, alias, ...rest]) => [rowid, alias === null ? rowid : alias, ...rest]), expected.files, "files");
});

Deno.test("按 rowid 查找", () => {
  const db = open();
  const root = db.rootOf("files")!;
  for (const row of expected.files.filter((_: unknown, i: number) => i % 97 === 0)) {
    const rowid = typeof row[0] === "number" ? row[0] : BigInt(row[0].big);
    assertSame([row[0], row[0], ...db.get(root, rowid)!.slice(1).map(encode)], row, `rowid ${rowid}`);
  }
  if (db.get(root, 3001) !== null) throw new Error("已删除的行不应被读到");
});

Deno.test("自动索引按首列取区间", () => {
  const db = open();
  const root = db.rootOf("sqlite_autoindex_url_map_1")!;
  for (const id of [150, 299, 999]) {
    assertSame([...db.indexRange(root, id)].map((r) => r.slice(0, 2)), expected[`url_map_${id}`], `url_map hash_id=${id}`);
  }
});

Deno.test("WITHOUT ROWID 表与它的索引", () => {
  const db = open();
  assertSame([...db.indexRows(db.rootOf("mappings")!)], expected.mappings, "mappings 全表");
  const byHash = db.rootOf("mappings_hash_tag")!;
  assertSame([...db.indexRange(byHash, 77)], expected.by_hash_77, "hash_id=77");
  assertSame([...db.indexRange(byHash, 0)], expected.by_hash_0, "hash_id=0");
});

Deno.test("源文件变化时报快照失效", () => {
  const db = open();
  Deno.writeFileSync(`${dir}/copy.db-wal`, new Uint8Array(1), { append: true });
  try {
    db.checkUnchanged();
    throw new Error("应当抛 SqliteSnapshotChanged");
  } catch (e) {
    if (!(e instanceof SqliteSnapshotChanged)) throw e;
  }
});

Deno.test("记录解码：各种整数宽度与浮点", () => {
  // header: 长度 7，类型 1(1 字节) 2(2) 4(4) 6(8) 7(浮点) 8(0) 9(1)
  const rec = new Uint8Array([8, 1, 2, 4, 6, 7, 8, 9, 0xff, 0x80, 0x00, 0x7f, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 5, 0x3f, 0xf0, 0, 0, 0, 0, 0, 0]);
  assertSame(decodeRecord(rec), [-1, -32768, 2147483647, 5, 1, 0, 1], "记录");
});

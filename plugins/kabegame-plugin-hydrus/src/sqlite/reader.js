// 只读 SQLite 读取器：只用「按偏移读文件」，直接解析 b-tree 页，不需要 SQL 引擎，也不把整个库读进内存。
//
// 支持：rowid 表按 rowid 查找与全表扫描、索引（含 WITHOUT ROWID 表）按首列取区间、溢出页、WAL。
// WAL 的处理和 SQLite 读事务一致：打开时取最后一个提交帧为快照，快照内每页用最新的帧。
// 不写 -shm、不登记读锁，所以源库仍在被写入时快照可能失效：读 WAL 帧时校验 salt，
// `checkUnchanged()` 比对文件大小与修改时间，发现变化抛 SqliteSnapshotChanged，由调用方重开再读。
// 文件格式见 https://www.sqlite.org/fileformat2.html

/**
 * @typedef {object} SqliteFile
 * @property {(offset: number, length: number) => Uint8Array} readAt  读不满时返回较短的数组
 * @property {number} size
 * @property {() => unknown} [version]  文件大小、修改时间等指纹，用于发现文件被改写
 */

export class SqliteError extends Error {
  name = "SqliteError";
}

/** 读的过程中源库被写入，快照不再一致。重开数据库后重试即可。 */
export class SqliteSnapshotChanged extends SqliteError {
  name = "SqliteSnapshotChanged";
}

const PAGE_CACHE_SIZE = 4096;

const TABLE_INTERIOR = 0x05;
const TABLE_LEAF = 0x0d;
const INDEX_INTERIOR = 0x02;
const INDEX_LEAF = 0x0a;

const utf8 = new TextDecoder("utf-8");

function varint(b, p) {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    const c = b[p + i];
    v = (v << 7n) | BigInt(c & 0x7f);
    if (!(c & 0x80)) return [v, i + 1];
  }
  return [(v << 8n) | BigInt(b[p + 8]), 9];
}

/** varint 的 Number 版本，用在长度、类型码等不会超过 2^53 的地方 */
function smallVarint(b, p) {
  let v = 0;
  for (let i = 0; i < 8; i++) {
    const c = b[p + i];
    v = v * 128 + (c & 0x7f);
    if (!(c & 0x80)) return [v, i + 1];
  }
  return [v * 256 + b[p + 8], 9];
}

const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** 能精确表示时转成 Number，否则保留 BigInt */
const toNumber = (v) => (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v);

/** 解析一条记录成列值：NULL → null，整数 → number（超出安全范围为 bigint），REAL → number，TEXT → string，BLOB → Uint8Array */
export function decodeRecord(rec) {
  const [headerLen, a] = smallVarint(rec, 0);
  const types = [];
  for (let p = a; p < headerLen; ) {
    const [t, n] = smallVarint(rec, p);
    types.push(t);
    p += n;
  }
  const dv = view(rec);
  const values = [];
  let p = headerLen;
  for (const t of types) {
    if (t === 0) values.push(null);
    else if (t >= 1 && t <= 6) {
      const len = [0, 1, 2, 3, 4, 6, 8][t];
      let v = 0n;
      for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(rec[p + i]);
      values.push(toNumber(BigInt.asIntN(len * 8, v)));
      p += len;
    } else if (t === 7) {
      values.push(dv.getFloat64(p));
      p += 8;
    } else if (t === 8 || t === 9) values.push(t - 8);
    else if (t >= 12) {
      const len = (t - (t % 2 === 1 ? 13 : 12)) / 2;
      const bytes = rec.subarray(p, p + len);
      values.push(t % 2 === 1 ? utf8.decode(bytes) : bytes);
      p += len;
    } else throw new SqliteError(`记录里有保留的类型码 ${t}`);
  }
  return values;
}

/** SQLite 的排序：NULL < 数值 < TEXT < BLOB；TEXT 按 BINARY 比较（字节序） */
function compareValues(a, b) {
  const rank = (v) => (v === null ? 0 : typeof v === "number" || typeof v === "bigint" ? 1 : typeof v === "string" ? 2 : 3);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  if (ra === 1) return a < b ? -1 : a > b ? 1 : 0;
  const ba = ra === 2 ? new TextEncoder().encode(a) : a;
  const bb = rb === 2 ? new TextEncoder().encode(b) : b;
  for (let i = 0; i < Math.min(ba.length, bb.length); i++) if (ba[i] !== bb[i]) return ba[i] - bb[i];
  return ba.length - bb.length;
}

/**
 * @param {{ db: SqliteFile, wal?: SqliteFile | null }} files
 */
export function openDatabase({ db, wal = null }) {
  const header = db.readAt(0, 100);
  if (utf8.decode(header.subarray(0, 15)) !== "SQLite format 3") throw new SqliteError("不是 SQLite 数据库文件");
  const hv = view(header);
  let pageSize = hv.getUint16(16);
  if (pageSize === 1) pageSize = 65536;
  const usable = pageSize - header[20];
  if (hv.getUint32(56) > 1) throw new SqliteError(`只支持 UTF-8 编码的数据库（文本编码 ${hv.getUint32(56)}）`);
  const dbVersion = db.version?.();
  const walVersion = wal?.version?.();

  // WAL：只认 salt 与头部一致的帧，取最后一个提交帧为快照
  /** @type {Map<number, number>} 页号 → 帧在 WAL 中的偏移 */
  const walFrames = new Map();
  let salt1 = 0;
  let salt2 = 0;
  if (wal && wal.size >= 32) {
    const wh = view(wal.readAt(0, 32));
    const magic = wh.getUint32(0);
    if ((magic === 0x377f0682 || magic === 0x377f0683) && wh.getUint32(8) === pageSize) {
      salt1 = wh.getUint32(16);
      salt2 = wh.getUint32(20);
      const pending = new Map();
      for (let off = 32; off + 24 + pageSize <= wal.size; off += 24 + pageSize) {
        const fh = view(wal.readAt(off, 24));
        if (fh.getUint32(8) !== salt1 || fh.getUint32(12) !== salt2) break;
        pending.set(fh.getUint32(0), off);
        if (fh.getUint32(4) !== 0) {
          for (const [k, v] of pending) walFrames.set(k, v);
          pending.clear();
        }
      }
    }
  }

  /** @type {Map<number, Uint8Array>} */
  const cache = new Map();

  function page(n) {
    const hit = cache.get(n);
    if (hit) {
      cache.delete(n);
      cache.set(n, hit);
      return hit;
    }
    let bytes;
    const frame = walFrames.get(n);
    if (frame !== undefined) {
      const raw = wal.readAt(frame, 24 + pageSize);
      const fh = view(raw);
      if (raw.length < 24 + pageSize || fh.getUint32(0) !== n || fh.getUint32(8) !== salt1 || fh.getUint32(12) !== salt2) {
        throw new SqliteSnapshotChanged("WAL 在读取过程中被改写");
      }
      bytes = raw.subarray(24);
    } else {
      bytes = db.readAt((n - 1) * pageSize, pageSize);
      if (bytes.length < pageSize) throw new SqliteSnapshotChanged(`第 ${n} 页超出文件末尾`);
    }
    cache.set(n, bytes);
    if (cache.size > PAGE_CACHE_SIZE) cache.delete(cache.keys().next().value);
    return bytes;
  }

  /** b-tree 页头：第 1 页前面有 100 字节文件头 */
  function btreePage(n) {
    const pg = page(n);
    const h = n === 1 ? 100 : 0;
    const type = pg[h];
    if (type !== TABLE_INTERIOR && type !== TABLE_LEAF && type !== INDEX_INTERIOR && type !== INDEX_LEAF) {
      throw new SqliteSnapshotChanged(`第 ${n} 页不是 b-tree 页（类型 ${type}）`);
    }
    const dv = view(pg);
    const interior = type === TABLE_INTERIOR || type === INDEX_INTERIOR;
    const cellCount = dv.getUint16(h + 3);
    const ptrBase = h + (interior ? 12 : 8);
    return {
      pg,
      dv,
      type,
      cellCount,
      cell: (i) => dv.getUint16(ptrBase + i * 2),
      rightChild: interior ? dv.getUint32(h + 8) : 0,
    };
  }

  /** 读 payload，溢出部分沿溢出页链读出 */
  function payload(pg, p, total, maxLocal) {
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
    let local = total;
    if (total > maxLocal) {
      local = minLocal + ((total - minLocal) % (usable - 4));
      if (local > maxLocal) local = minLocal;
    }
    if (local === total) return pg.subarray(p, p + total);
    const out = new Uint8Array(total);
    out.set(pg.subarray(p, p + local));
    let got = local;
    let next = view(pg).getUint32(p + local);
    while (got < total) {
      if (next === 0) throw new SqliteSnapshotChanged("溢出页链提前结束");
      const op = page(next);
      const n = Math.min(usable - 4, total - got);
      out.set(op.subarray(4, 4 + n), got);
      got += n;
      next = view(op).getUint32(0);
    }
    return out;
  }

  const tableMaxLocal = usable - 35;
  const indexMaxLocal = Math.floor(((usable - 12) * 64) / 255) - 23;

  function tableLeafCell(pg, cp) {
    const [size, a] = smallVarint(pg, cp);
    const [rowid, b] = varint(pg, cp + a);
    return { rowid: toNumber(rowid), record: payload(pg, cp + a + b, size, tableMaxLocal) };
  }

  function indexCellRecord(pg, cp) {
    const [size, a] = smallVarint(pg, cp);
    return decodeRecord(payload(pg, cp + a, size, indexMaxLocal));
  }

  /** rowid 表的全部行，按 rowid 升序：[rowid, 列值] */
  function* rows(root) {
    const p = btreePage(root);
    if (p.type === TABLE_INTERIOR) {
      for (let i = 0; i < p.cellCount; i++) yield* rows(p.dv.getUint32(p.cell(i)));
      yield* rows(p.rightChild);
    } else if (p.type === TABLE_LEAF) {
      for (let i = 0; i < p.cellCount; i++) {
        const { rowid, record } = tableLeafCell(p.pg, p.cell(i));
        yield [rowid, decodeRecord(record)];
      }
    } else throw new SqliteSnapshotChanged(`第 ${root} 页不是表 b-tree 页`);
  }

  /** 按 rowid 取一行的列值，没有时返回 null */
  function get(root, rowid) {
    const want = BigInt(rowid);
    let n = root;
    for (;;) {
      const p = btreePage(n);
      if (p.type === TABLE_INTERIOR) {
        let child = p.rightChild;
        for (let i = 0; i < p.cellCount; i++) {
          const cp = p.cell(i);
          const [key] = varint(p.pg, cp + 4);
          if (want <= key) {
            child = p.dv.getUint32(cp);
            break;
          }
        }
        n = child;
      } else if (p.type === TABLE_LEAF) {
        for (let i = 0; i < p.cellCount; i++) {
          const cp = p.cell(i);
          const [, a] = smallVarint(p.pg, cp);
          const [key] = varint(p.pg, cp + a);
          if (key === want) return decodeRecord(tableLeafCell(p.pg, cp).record);
        }
        return null;
      } else throw new SqliteSnapshotChanged(`第 ${n} 页不是表 b-tree 页`);
    }
  }

  /**
   * 索引（含 WITHOUT ROWID 表）里首列等于 value 的全部记录，按索引顺序。
   * 内部页的 cell 本身也是一条记录，中序遍历：左子树、cell、下一个 cell……最后右子树。
   */
  function* indexRange(root, value) {
    // 返回 true 表示已经越过 value，可以停止
    function* walk(n) {
      const p = btreePage(n);
      if (p.type === INDEX_LEAF) {
        for (let i = 0; i < p.cellCount; i++) {
          const rec = indexCellRecord(p.pg, p.cell(i));
          const c = compareValues(rec[0], value);
          if (c > 0) return true;
          if (c === 0) yield rec;
        }
        return false;
      }
      if (p.type !== INDEX_INTERIOR) throw new SqliteSnapshotChanged(`第 ${n} 页不是索引 b-tree 页`);
      for (let i = 0; i < p.cellCount; i++) {
        const cp = p.cell(i);
        const rec = indexCellRecord(p.pg, cp + 4);
        const c = compareValues(rec[0], value);
        if (c < 0) continue;
        if (yield* walk(p.dv.getUint32(cp))) return true;
        if (c > 0) return true;
        yield rec;
      }
      return yield* walk(p.rightChild);
    }
    yield* walk(root);
  }

  /** 索引的全部记录，按索引顺序 */
  function* indexRows(root) {
    const p = btreePage(root);
    if (p.type === INDEX_INTERIOR) {
      for (let i = 0; i < p.cellCount; i++) {
        const cp = p.cell(i);
        yield* indexRows(p.dv.getUint32(cp));
        yield indexCellRecord(p.pg, cp + 4);
      }
      yield* indexRows(p.rightChild);
    } else if (p.type === INDEX_LEAF) {
      for (let i = 0; i < p.cellCount; i++) yield indexCellRecord(p.pg, p.cell(i));
    } else throw new SqliteSnapshotChanged(`第 ${root} 页不是索引 b-tree 页`);
  }

  /** sqlite_schema：[type, name, tbl_name, rootpage, sql] */
  const schema = [...rows(1)].map(([, v]) => ({ type: v[0], name: v[1], table: v[2], root: v[3], sql: v[4] }));

  /** 表或索引的根页；WITHOUT ROWID 表的根页就是它的主键索引 b-tree。不存在时返回 null */
  function rootOf(name) {
    return schema.find((s) => s.name === name && (s.type === "table" || s.type === "index"))?.root ?? null;
  }

  /** 源文件自打开以来没有变化；有变化时抛 SqliteSnapshotChanged */
  function checkUnchanged() {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (db.version && !same(db.version(), dbVersion)) throw new SqliteSnapshotChanged("数据库文件在读取过程中被改写");
    if (wal?.version && !same(wal.version(), walVersion)) throw new SqliteSnapshotChanged("WAL 在读取过程中被改写");
  }

  return { pageSize, walFrameCount: walFrames.size, schema, rootOf, rows, get, indexRange, indexRows, checkUnchanged };
}

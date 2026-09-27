/* ═══════════════════════════════════════════════════════════════
   zip.js — zero-dependency ZIP reader/writer for the browser
   Uses native CompressionStream/DecompressionStream (deflate-raw).
   No external libs. CRC32 implemented locally.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── CRC32 ─────────────────────────────────────────────── */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ── deflate / inflate via native streams ──────────────── */
  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null; // caller falls back to STORE
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* ── DOS date/time ─────────────────────────────────────── */
  function dosDateTime(d) {
    const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
    const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
    return { time, date };
  }

  /* ── READER ────────────────────────────────────────────── */
  async function readZip(buffer) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    // Find End Of Central Directory (0x06054b50) scanning back.
    let eocd = -1;
    const minEocd = Math.max(0, u8.length - 65557);
    for (let i = u8.length - 22; i >= minEocd; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a ZIP archive (no EOCD signature)');

    const entryCount = dv.getUint16(eocd + 10, true);
    let ptr = dv.getUint32(eocd + 16, true);

    const files = [];
    const dec = new TextDecoder();

    for (let n = 0; n < entryCount; n++) {
      if (dv.getUint32(ptr, true) !== 0x02014b50) throw new Error('Corrupt central directory at entry ' + n);
      const method = dv.getUint16(ptr + 10, true);
      const crcExpected = dv.getUint32(ptr + 16, true);
      const compSize = dv.getUint32(ptr + 20, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      const localOffset = dv.getUint32(ptr + 42, true);
      const name = dec.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
      ptr += 46 + nameLen + extraLen + commentLen;

      if (name.endsWith('/')) continue; // directory entry

      // Locate data via local header (its extra field len can differ).
      if (dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Corrupt local header for ' + name);
      const lNameLen = dv.getUint16(localOffset + 26, true);
      const lExtraLen = dv.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const raw = u8.subarray(dataStart, dataStart + compSize);

      let data;
      if (method === 0) data = raw.slice();
      else if (method === 8) data = await inflateRaw(raw);
      else throw new Error(`Unsupported compression method ${method} for ${name}`);

      if (crc32(data) !== crcExpected) throw new Error('CRC mismatch in ' + name);
      files.push({ name, data });
    }
    return files;
  }

  /* ── WRITER ────────────────────────────────────────────── */
  async function writeZip(entries) {
    // entries: [{ name, data:Uint8Array, date?:Date }]
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();

    for (const e of entries) {
      const nameBytes = enc.encode(e.name);
      const data = e.data;
      const { time, date } = dosDateTime(e.date || now);

      let method = 8, comp = await deflateRaw(data);
      if (comp === null || comp.length >= data.length) { method = 0; comp = data; }
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);          // version needed
      lv.setUint16(6, 0x0800, true);      // UTF-8 flag
      lv.setUint16(8, method, true);
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, comp.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);

      chunks.push(local, comp);

      central.push({ nameBytes, crc, comp: comp.length, raw: data.length, method, time, date, offset });
      offset += local.length + comp.length;
    }

    const cdStart = offset;
    for (const c of central) {
      const cd = new Uint8Array(46 + c.nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, c.method, true);
      cv.setUint16(12, c.time, true);
      cv.setUint16(14, c.date, true);
      cv.setUint32(16, c.crc, true);
      cv.setUint32(20, c.comp, true);
      cv.setUint32(24, c.raw, true);
      cv.setUint16(28, c.nameBytes.length, true);
      cv.setUint32(42, c.offset, true);
      cd.set(c.nameBytes, 46);
      chunks.push(cd);
      offset += cd.length;
    }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, offset - cdStart, true);
    ev.setUint32(16, cdStart, true);
    chunks.push(eocd);

    return new Blob(chunks, { type: 'application/zip' });
  }

  window.ForgeZip = { readZip, writeZip, crc32 };
})();

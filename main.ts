// Entry for ai-happy-01: it publishes the image in this repository to the run's
// output, after checking that the image the gate will read is whole.
//
// The image is the entry; this program is the way it reaches /output/entry.png.
// It reads ./entry.png beside itself, checks the file's magic bytes, its header
// and its end, and copies every byte of it to the output directory. Nothing is
// drawn, resized or re-encoded: two runs of this program write the same bytes.
//
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// The grader runs it with no network, one cpu, 60 s and /output as the output dir.

import { readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "entry.png");
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
const MAX_BYTES = 1024 * 1024; // the gate's own limit
const MAX_SIDE = 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

type ImageKind = "png" | "jpeg";

type ImageReport = {
  kind: ImageKind;
  bytes: number;
  width: number;
  height: number;
};

function fail(message: string): never {
  console.error(`entry: ${message}`);
  process.exit(1);
}

function size(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return fail(`cannot read ${file} — the image belongs to the repository`);
  }
}

// A PNG is whole when it starts with the magic bytes, its first chunk is IHDR
// with the width and the height, and its last chunk is IEND: the gate reads the
// file's structure, so the entry checks the same thing before it ships it.
// The gate's scorer reads every chunk with its checksum, so the entry walks the
// whole chain itself: each chunk's CRC32 must match the type and the data it
// covers, and IEND must be the last chunk, with nothing after it.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function checkChunks(buf: Buffer): void {
  let at = 8;
  let last = "";
  while (at + 12 <= buf.length) {
    const length = buf.readUInt32BE(at);
    const end = at + 12 + length;
    if (end > buf.length) fail("a PNG chunk runs past the end of the file");
    const body = buf.subarray(at + 4, at + 8 + length);
    const declared = buf.readUInt32BE(at + 8 + length);
    if (crc32(body) !== declared) {
      fail(`the PNG chunk at byte ${at} fails its checksum`);
    }
    last = body.subarray(0, 4).toString("latin1");
    at = end;
    if (last === "IEND") break;
  }
  if (at !== buf.length) fail("the PNG carries bytes after IEND");
}

function readPng(buf: Buffer): ImageReport {
  if (buf.length < 8 + 25 || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
    fail("entry.png is not a PNG");
  }
  const length = buf.readUInt32BE(8);
  const type = buf.subarray(12, 16).toString("latin1");
  if (type !== "IHDR" || length !== 13) fail("the PNG has no IHDR first");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const iend = buf.subarray(buf.length - 8, buf.length - 4).toString("latin1");
  if (iend !== "IEND") fail("the PNG ends before IEND — it is truncated");
  checkChunks(buf);
  return { kind: "png", bytes: buf.length, width, height };
}

// The gate takes a JPEG too, told apart by its first bytes and its end marker.
function readJpeg(buf: Buffer): ImageReport {
  if (buf.length < 4 || !buf.subarray(0, 3).equals(JPEG_START)) {
    fail("entry.png is not a JPEG either");
  }
  if (!buf.subarray(buf.length - 2).equals(JPEG_END)) {
    fail("the JPEG ends before its end marker");
  }
  let width = 0;
  let height = 0;
  for (let at = 2; at + 9 < buf.length; ) {
    if (buf[at] !== 0xff) break;
    const marker = buf[at + 1];
    const len = buf.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = buf.readUInt16BE(at + 5);
      width = buf.readUInt16BE(at + 7);
      break;
    }
    at += 2 + len;
  }
  if (width === 0) fail("the JPEG declares no size");
  return { kind: "jpeg", bytes: buf.length, width, height };
}

function inspect(file: string): Buffer {
  const bytes = size(file);
  if (bytes === 0) fail("entry.png is empty");
  if (bytes > MAX_BYTES) fail(`the image is ${bytes} bytes, over the 1 MiB gate`);
  const buf = readFileSync(file);
  const head = buf.subarray(0, 3);
  const report = head.equals(PNG_MAGIC.subarray(0, 3)) ? readPng(buf) : readJpeg(buf);
  if (report.width > MAX_SIDE || report.height > MAX_SIDE) {
    fail(`the image is ${report.width}x${report.height}, over ${MAX_SIDE}x${MAX_SIDE}`);
  }
  console.log(
    `entry: ${report.kind} ${report.width}x${report.height}, ${report.bytes} bytes, whole`,
  );
  return buf;
}

function main(): void {
  const image = inspect(SOURCE);
  mkdirSync(OUT_DIR, { recursive: true });
  const target = join(OUT_DIR, "entry.png");
  writeFileSync(target, image);
  console.log(`entry: wrote ${image.length} bytes to ${target}`);
}

main();

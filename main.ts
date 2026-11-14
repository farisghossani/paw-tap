// ai-happy-01: the entry is the image in this repository, and this program is
// how it reaches the grader. It reads ./entry.png beside itself, refuses it if
// the gate would, and then copies every byte of it to /output/entry.png.
//
// The gate the image has to pass is the site's: a whole PNG or JPEG, at most
// 1 MiB and at most 1024 by 1024 pixels, read by its first bytes. So this file
// walks the image's own structure — a PNG's chunk chain with each chunk's CRC,
// a JPEG's segment chain to its end marker — and stops before it ships an image
// the gate would score 0. Nothing is drawn, cropped, resized or re-encoded:
// the output is the input's bytes, so the grader's two runs write the same file.
//
// Run it outside the container with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Inside the grading container MAKEFUN_OUTPUT_DIR is unset and /output is the
// output mount. Node 22, standard library only, no network.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// The gate, in the gate's own numbers
// ---------------------------------------------------------------------------

const GATE = {
    /** gate.json (coolest-art-01's, byte for byte): max_bytes. */
    maxBytes: 1_048_576,
    /** gate.json: max_width and max_height. */
    maxSide: 1_024,
} as const;

/** The image belongs to the repository, beside this script. */
const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "entry.png");

/** The grader's output mount; MAKEFUN_OUTPUT_DIR stands in for it here. */
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

/** The name the gate reads, whatever the image's format is. */
const OUTPUT_FILE = "entry.png";

// ---------------------------------------------------------------------------
// A refusal carries the reason and the fix, so a failed run explains itself
// ---------------------------------------------------------------------------

class Refusal extends Error {
    fix: string = "";

    constructor(reason: string, fix: string) {
        super(reason);
        this.name = "refusal";
        this.fix = fix;
    }
}

function refuse(reason: string, fix: string): never {
    throw new Refusal(reason, fix);
}

// ---------------------------------------------------------------------------
// What the image turned out to be
// ---------------------------------------------------------------------------

type Kind = "png" | "jpeg";

type Image = {
    kind: Kind;
    width: number;
    height: number;
    /** Notes that do not refuse the image: the gate reads past them. */
    notes: string[];
};

// ---------------------------------------------------------------------------
// PNG: the chunk chain, each chunk with its CRC
// ---------------------------------------------------------------------------

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_END = "IEND";
const CHUNK_HEADER = 8;
const CHUNK_CRC = 4;

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

/** The CRC32 the PNG format puts after every chunk: the type and its data. */
function crc32(bytes: Buffer): number {
    let crc = 0xffff_ffff;
    for (let at = 0; at < bytes.length; at += 1) {
        crc = CRC_TABLE[(crc ^ bytes[at]!) & 0xff]! ^ (crc >>> 8);
    }
    return (crc ^ 0xffff_ffff) >>> 0;
}

/**
 * Reads a PNG the way the gate's scorer does: the magic bytes, IHDR first with
 * the width and the height, every chunk's checksum, and IEND as the last chunk.
 * A truncated file, a re-encoded one with a stale checksum, or one with bytes
 * glued after IEND is refused here rather than scored 0 later.
 */
function readPng(bytes: Buffer): Image {
    if (bytes.length < PNG_MAGIC.length + CHUNK_HEADER + 13 + CHUNK_CRC) {
        refuse(
            `entry.png is ${bytes.length} bytes, too short to hold a PNG header`,
            "replace entry.png with a whole PNG from the repository",
        );
    }
    if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
        refuse("entry.png does not start with the PNG magic bytes", "write a PNG, or a JPEG, to entry.png");
    }

    // The first chunk is the header, and it is the only place the size lives.
    const first = chunkAt(bytes, PNG_MAGIC.length);
    if (first.type !== "IHDR" || first.length !== 13) {
        refuse(
            `entry.png's first chunk is ${first.type}, not IHDR`,
            "a PNG's first chunk is IHDR: re-export the image as PNG",
        );
    }
    const width = bytes.readUInt32BE(PNG_MAGIC.length + CHUNK_HEADER);
    const height = bytes.readUInt32BE(PNG_MAGIC.length + CHUNK_HEADER + 4);

    // Walk the whole chain: a chunk whose CRC disagrees is a damaged file even
    // when its bytes still look like a PNG.
    let last = "";
    let at = PNG_MAGIC.length;
    for (;;) {
        const chunk = chunkAt(bytes, at);
        const body = bytes.subarray(at + CHUNK_HEADER - 4, at + CHUNK_HEADER + chunk.length);
        const declared = bytes.readUInt32BE(at + CHUNK_HEADER + chunk.length);
        if (crc32(body) !== declared) {
            refuse(
                `entry.png's ${chunk.type} chunk at byte ${at} fails its CRC32`,
                "the file is damaged: replace entry.png with the original export",
            );
        }
        last = chunk.type;
        at += CHUNK_HEADER + chunk.length + CHUNK_CRC;
        if (last === PNG_END) break;
        if (at >= bytes.length) {
            refuse(
                `entry.png ends after its ${last} chunk and never reaches IEND`,
                "the file is truncated: replace entry.png with the original export",
            );
        }
    }

    // A trailer after the end marker is not a fault: the gate reads every chunk
    // to IEND, and bytes past it are none of the gate's business, so they are a
    // note and not a refusal. This entry's own image has none (verified: the
    // file's last 8 bytes are IEND and its CRC), and a note keeps a file that
    // gained one visible in the run's output instead of silently shipped.
    const notes = at < bytes.length
        ? [`${bytes.length - at} bytes follow IEND and are copied as they are`]
        : [];
    return { kind: "png", width, height, notes };
}

/** One chunk at `at`: its length, its type and the end of its data. */
function chunkAt(bytes: Buffer, at: number): { length: number; type: string } {
    if (at + CHUNK_HEADER > bytes.length) {
        refuse(
            "entry.png ends in the middle of a PNG chunk header",
            "the file is truncated: replace entry.png with the original export",
        );
    }
    const length = bytes.readUInt32BE(at);
    const end = at + CHUNK_HEADER + length + CHUNK_CRC;
    if (end > bytes.length) {
        refuse(
            `entry.png's chunk at byte ${at} declares ${length} bytes and runs past the end of the file`,
            "the file is truncated: replace entry.png with the original export",
        );
    }
    return { length, type: bytes.toString("latin1", at + 4, at + CHUNK_HEADER) };
}

// ---------------------------------------------------------------------------
// JPEG: the segment chain to its end marker
// ---------------------------------------------------------------------------

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_END = Buffer.from([0xff, 0xd9]);
const JPEG_SOS = 0xda;
const JPEG_EOI = 0xd9;

/**
 * Reads a JPEG the way the house reads one (grader/judge-call.ts jpegSize): walk
 * the segments from SOI, skipping the standalone markers and any run of fill
 * bytes, until the first SOFn frame header gives the height and the width. The
 * file must also carry its end marker, or it is a truncated JPEG.
 */
function readJpeg(bytes: Buffer): Image {
    if (!bytes.subarray(0, 3).equals(JPEG_MAGIC)) {
        refuse("entry.png is neither a PNG nor a JPEG", "entry.png holds a PNG or a JPEG image");
    }
    // The end marker is the last FF D9 in the file, not necessarily its last two
    // bytes: entropy-coded data cannot hold a bare FF D9 (the encoder stuffs FF
    // as FF 00, and RSTn are FF D0..D7), so that pair is the EOI wherever it
    // sits. A file without one is truncated and refused; a file with a trailer
    // after it is whole, and the trailer is a note.
    const end = bytes.lastIndexOf(JPEG_END);
    if (end < 0) {
        refuse(
            "entry.png carries no JPEG end marker (FFD9)",
            "the file is truncated: replace entry.png with the original export",
        );
    }
    const notes = end + JPEG_END.length < bytes.length
        ? [`${bytes.length - end - JPEG_END.length} bytes follow the end marker and are copied as they are`]
        : [];

    let width = 0;
    let height = 0;
    let at = 2;
    while (at + 4 <= bytes.length) {
        if (bytes[at] !== 0xff) {
            refuse(
                `entry.png's JPEG segments break at byte ${at}`,
                "the file is damaged: replace entry.png with the original export",
            );
        }
        const marker = bytes[at + 1]!;
        if (marker === 0xff) {
            at += 1; // a fill byte before a marker
            continue;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
            at += 2; // TEM, RSTn and SOI carry no length
            continue;
        }
        if (marker === JPEG_SOS || marker === JPEG_EOI) break; // past the frame header
        const segment = bytes.readUInt16BE(at + 2);
        if (segment < 2) {
            refuse(
                `entry.png's JPEG segment at byte ${at} declares a length of ${segment}`,
                "the file is damaged: replace entry.png with the original export",
            );
        }
        // SOF0..SOF15, but DHT (C4), JPG (C8) and DAC (CC) are not frame headers.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            if (at + 9 > bytes.length) {
                refuse(
                    "entry.png's JPEG frame header runs past the end of the file",
                    "the file is truncated: replace entry.png with the original export",
                );
            }
            height = bytes.readUInt16BE(at + 5);
            width = bytes.readUInt16BE(at + 7);
            break;
        }
        at += 2 + segment;
    }

    if (width < 1 || height < 1) {
        refuse(
            "entry.png's JPEG never declares its frame size",
            "re-export entry.png as a baseline JPEG, or as a PNG",
        );
    }
    return { kind: "jpeg", width, height, notes };
}

// ---------------------------------------------------------------------------
// Reading and checking the image the gate will read
// ---------------------------------------------------------------------------

/** The file's size, with the reason named when it is not there at all. */
function sourceBytes(): Buffer {
    try {
        return readFileSync(SOURCE);
    } catch {
        refuse(
            `no image at ${SOURCE}`,
            "the image belongs to the repository: commit entry.png beside main.ts",
        );
    }
}

/**
 * The image as the gate would see it, or a refusal naming what breaks a rule.
 * The order is the gate's own: it reads the file at all, then its size, then
 * what it is, then its structure, then its pixels past the limits.
 */
function inspect(source: Buffer): Image {
    if (source.length === 0) refuse("entry.png is empty", "commit a whole image at entry.png");
    if (source.length > GATE.maxBytes) {
        refuse(
            `entry.png is ${source.length} bytes, over the gate's ${GATE.maxBytes}`,
            "compress the image, or export it at a lower quality or size",
        );
    }

    const image = source.subarray(0, 4).equals(PNG_MAGIC.subarray(0, 4))
        ? readPng(source)
        : readJpeg(source);

    if (image.width > GATE.maxSide || image.height > GATE.maxSide) {
        refuse(
            `entry.png is ${image.width}x${image.height}, over the gate's ${GATE.maxSide}x${GATE.maxSide}`,
            "resize the image to 1024 by 1024 or less",
        );
    }
    return image;
}

// ---------------------------------------------------------------------------
// Shipping it
// ---------------------------------------------------------------------------

function ship(source: Buffer): string {
    if (statSync(SOURCE).size !== source.length) {
        refuse("entry.png changed while it was being read", "run the entry against a settled checkout");
    }
    try {
        mkdirSync(OUTPUT_DIR, { recursive: true });
    } catch {
        refuse(
            `cannot make the output directory ${OUTPUT_DIR}`,
            "point MAKEFUN_OUTPUT_DIR at a writable directory",
        );
    }

    // Written straight to its final name: no temporary file in /output, which
    // the harness meters while the entry runs. The bytes are the source's, so
    // this is a copy in fact and not just in intent.
    const target = join(OUTPUT_DIR, OUTPUT_FILE);
    writeFileSync(target, source);

    // Read it back once: a copy that lost a byte is the one failure the judge
    // would see and this program would not.
    const written = readFileSync(target);
    if (!written.equals(source)) {
        refuse(
            `the bytes written to ${target} are not the image's`,
            "check the output directory for a full disk",
        );
    }
    return target;
}

function main(): void {
    const source = sourceBytes();
    const image = inspect(source);
    const digest = createHash("sha256").update(source).digest("hex");

    console.log(
        `entry: ${image.kind} ${image.width}x${image.height}, ${source.length} bytes, whole as the gate reads it`,
    );
    console.log(`entry: sha256 ${digest}`);
    for (const note of image.notes) console.log(`entry: note — ${note}`);

    const target = ship(source);
    const shipped = createHash("sha256").update(readFileSync(target)).digest("hex");
    console.log(`entry: wrote ${source.length} bytes to ${target}, byte for byte (sha256 ${shipped})`);
}

try {
    main();
} catch (error) {
    if (error instanceof Refusal) {
        console.error(`entry: ${error.message}`);
        console.error(`entry: fix — ${error.fix}`);
        process.exit(1);
    }
    throw error;
}

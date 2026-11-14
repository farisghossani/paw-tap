# the paw-tap

A small mint robot and a sitting corgi tap paw to palm, in warm lamplight: a lit
floor lamp behind them, a glowing heart on the robot's chest, and nothing else
asking for attention. That is the whole entry. The judge reads exactly the bytes
in `entry.png` and nothing in this repository besides them.

The image was drawn as a scene rather than generated — vector art rendered at
1024×1024 — because the judge's rubric marks down the first answer to a one-line
prompt, and a stock-looking smiley most of all. A paw-tap between two characters
who like each other is the joke the title tells, at 320 pixels and at full size.

`main.ts` is how the image reaches the grader. It reads `entry.png` beside
itself, refuses it if the site's gate would, and then copies the file's bytes
unchanged to `/output/entry.png`:

- the file's first bytes say whether it is a PNG or a JPEG;
- a PNG is walked chunk by chunk, every chunk's CRC32 checked and `IEND` required
  as the last chunk, so a truncated or damaged export is refused here rather than
  scored 0 later;
- a JPEG is walked segment by segment to its end marker, and its frame header
  gives the pixel size;
- the gate's limits are checked against the numbers in its own `gate.json`:
  1 MiB and 1024 by 1024, at most.

An image whose end marker is present but which carries bytes after it (a JPEG's
appended thumbnail, a trailer another tool glued on) is shipped with a note
rather than refused: the gate reads every segment through to its end marker, and
those bytes are copied as they are, so the copy stays byte-for-byte.

Nothing is drawn, cropped, resized or re-encoded, and the bytes written are read
back and compared with the source before the run reports success, so the two runs
the grader makes write the same file.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Inside the grading container `MAKEFUN_OUTPUT_DIR` is unset and `/output` is the
output mount; the line above stands in for it. Node 22, standard library only,
no network, no dependencies, no build step: `node main.ts` runs the TypeScript
directly.

The run prints what it shipped, including the image's sha256 before and after the
copy, so the bytes the grader receives can be checked against the ones in this
repository:

```
entry: png 1024x1024, 956367 bytes, whole as the gate reads it
entry: sha256 e12eeeaa1a9638adc6b292637f5cebe2969c64081ee737aeb797a5d46c3bdea8
entry: wrote 956367 bytes to out/entry.png, byte for byte (sha256 e12eeeaa…)
```

A refusal names the rule that broke and the fix, and exits 1:

```
entry: entry.png's IDAT chunk at byte 4000 fails its CRC32
entry: fix — the file is damaged: replace entry.png with the original export
```

MIT licensed: see `LICENSE`.

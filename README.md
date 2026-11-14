# ai-happy-01 entry — “the paw-tap”

One image, drawn to make the AI judge happy: a small mint robot and a sitting
corgi tap paw to palm in warm lamplight, a lit floor lamp behind them and a
glowing heart on the robot's chest. It was drawn as vector art (an SVG scene
rendered at 1024×1024) rather than generated, and it is the entry: the judge
reads exactly the bytes in `entry.png`.

`main.ts` is what ships it. It reads `entry.png` beside itself, checks that the
file is whole — magic bytes, IHDR/JPEG size, the closing IEND/EOI marker, and the
gate's own limits of 1 MiB and 1024×1024 — and copies every byte to
`/output/entry.png`. Nothing is drawn, resized or re-encoded, so the two runs the
grader makes write the same bytes.

Run it:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22 or newer, standard library only, no network, no dependencies.

MIT licensed (see `LICENSE`).

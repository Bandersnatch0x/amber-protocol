#!/usr/bin/env python3
"""Lossless PNG re-compression for tracked image assets.

Every image in this repo is either a generated brand asset or product-review
evidence, so the only transformation allowed here is one that leaves the decoded
pixels and the PNG colour type byte-for-byte identical — it re-encodes the same
pixels with a better filter/compression pass and nothing else. It refuses to
write a file whose pixels or colour type would change, which is what makes the
resulting binary diff reviewable: `git diff` cannot show you a raster, but this
can prove the raster did not move.

    python scripts/optimize-images.py                  # report only, writes nothing
    python scripts/optimize-images.py --write          # rewrite files that shrink
    python scripts/optimize-images.py --verify master  # audit a committed re-encode

`--verify` is the review tool: for every image that differs from the given ref it
decodes both sides and reports whether pixels, mode, dimensions, colour type, and
alpha survived the re-encode. Exits non-zero if anything but the encoding moved.

GIF and SVG are listed as skipped: GIF has no lossless re-encode worth doing
(re-quantising the palette changes pixels, and ImgBot's attempt at it widened a
128-colour table to 256), and hand-written SVG is already text.
"""

from __future__ import annotations

import argparse
import io
import pathlib
import subprocess
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: python -m pip install Pillow")

REPO = pathlib.Path(__file__).resolve().parent.parent
RASTER = (".png", ".gif", ".jpg", ".jpeg", ".webp")
SKIP_SUFFIXES = (".gif", ".svg")


def tracked_images() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files"],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return [line for line in out.splitlines() if line.lower().endswith(RASTER)]


def colour_type(png_bytes: bytes) -> int:
    """IHDR colour type: signature(8) + length(4) + type(4) + width/height(8) + depth(1)."""
    return png_bytes[25]


def pixels(image: Image.Image) -> bytes:
    return image.tobytes()


def reencode(original: bytes) -> bytes:
    image = Image.open(io.BytesIO(original))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True, compress_level=9)
    return buffer.getvalue()


def git_bytes(ref: str, rel: str) -> bytes:
    return subprocess.run(
        ["git", "show", f"{ref}:{rel}"],
        cwd=REPO,
        check=True,
        capture_output=True,
    ).stdout


def verify(ref: str) -> int:
    """Audit a committed re-encode: every changed image must differ only in encoding."""
    changed = subprocess.run(
        ["git", "diff", "--name-only", ref, "--"],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    changed = [p for p in changed if p.lower().endswith(RASTER)]

    bad = 0
    for rel in changed:
        old_raw, new_raw = git_bytes(ref, rel), (REPO / rel).read_bytes()
        old, new = Image.open(io.BytesIO(old_raw)), Image.open(io.BytesIO(new_raw))
        checks = {
            "pixels": pixels(old) == pixels(new),
            "mode": old.mode == new.mode,
            "dims": old.size == new.size,
            "colourType": colour_type(old_raw) == colour_type(new_raw),
        }
        if old.mode in ("RGBA", "LA"):
            checks["alpha"] = old.convert("RGBA").getchannel("A").tobytes() == new.convert(
                "RGBA"
            ).getchannel("A").tobytes()
        ok = all(checks.values())
        bad += not ok
        verdict = " ".join(f"{k}={'same' if v else 'CHANGED'}" for k, v in checks.items())
        print(
            f"  {'ok  ' if ok else 'FAIL'} {rel} "
            f"({len(old_raw) / 1024:.0f} -> {len(new_raw) / 1024:.0f} KiB): {verdict}"
        )

    print(f"\n{bad} of {len(changed)} images changed in more than their encoding")
    return 1 if bad else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="rewrite files that shrink")
    parser.add_argument("--verify", metavar="REF", help="audit changed images against a git ref")
    args = parser.parse_args()

    if args.verify:
        return verify(args.verify)

    before_total = after_total = 0
    written = skipped = 0
    images = tracked_images()
    for rel in images:
        path = REPO / rel
        original = path.read_bytes()
        before_total += len(original)

        if rel.lower().endswith(SKIP_SUFFIXES):
            after_total += len(original)
            skipped += 1
            print(f"  skip  {rel} (no lossless re-encode)")
            continue

        candidate = reencode(original)

        # The safety property, checked before anything is written.
        old_img = Image.open(io.BytesIO(original))
        new_img = Image.open(io.BytesIO(candidate))
        if pixels(old_img) != pixels(new_img) or colour_type(original) != colour_type(candidate):
            after_total += len(original)
            print(f"  REFUSE {rel}: re-encode would change pixels or colour type")
            continue

        if len(candidate) >= len(original):
            after_total += len(original)
            print(f"  keep  {rel} ({len(original) / 1024:.0f} KiB, already smallest)")
            continue

        after_total += len(candidate)
        saved = 100 * (1 - len(candidate) / len(original))
        print(
            f"  {'write' if args.write else 'could'} {rel}: "
            f"{len(original) / 1024:.0f} -> {len(candidate) / 1024:.0f} KiB ({saved:.1f}% off)"
        )
        if args.write:
            path.write_bytes(candidate)
            written += 1

    print(
        f"\n{len(images)} images: {before_total / 1024:.0f} -> {after_total / 1024:.0f} KiB "
        f"({100 * (1 - after_total / before_total):.1f}% off), {written} written, "
        f"{skipped} skipped by format"
    )
    if not args.write:
        print("(report only; pass --write to apply)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

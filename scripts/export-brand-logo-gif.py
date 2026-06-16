#!/usr/bin/env python3
"""Export Amber Protocol logo as a seamless Protocol Seal GIF."""

from __future__ import annotations

import math
import sys
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageEnhance, ImageFilter
except ImportError:
    sys.exit("Pillow is required. Run: pip install pillow")

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "brand" / "amber-protocol-logo.png"
OUT = ROOT / "assets" / "brand" / "amber-protocol-logo.gif"

SIZE = 320
FPS = 24
DURATION_MS = 2400
FRAME_MS = 1000 // FPS
FRAME_COUNT = DURATION_MS * FPS // 1000
BG = (42, 42, 42, 255)


def seamless_pulse(t: float, low: float, high: float, phase: float = 0.0) -> float:
    """Cosine loop from low to high and back; t in [0, 1)."""
    wave = 0.5 - 0.5 * math.cos(2 * math.pi * (t - phase) % 1.0)
    return low + (high - low) * wave


def fit_square(image: Image.Image, size: int, bg: tuple[int, int, int, int]) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), bg)
    image = image.convert("RGBA")
    image.thumbnail((size, size), Image.LANCZOS)
    offset = ((size - image.width) // 2, (size - image.height) // 2)
    canvas.paste(image, offset, image)
    return canvas


def build_masks(base: Image.Image) -> tuple[Image.Image, Image.Image, Image.Image]:
    """Derive soft masks for gem glow and gold sheen from source colors."""
    rgb = base.convert("RGB")
    px = rgb.load()
    w, h = rgb.size
    gem = Image.new("L", (w, h), 0)
    gold = Image.new("L", (w, h), 0)
    gem_px = gem.load()
    gold_px = gold.load()

    cx, cy = w / 2, h / 2
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            # Center-weighted gem: warm orange / amber interior
            dx = abs(x - cx) / (w * 0.22)
            dy = abs(y - cy) / (h * 0.30)
            in_gem = dx + dy < 1.35
            if in_gem and r > 95 and g > 45 and r > b + 25:
                strength = min(255, int((r - 70) * 1.1))
                gem_px[x, y] = max(gem_px[x, y], strength)

            # Gold trim: bright yellow-gold, excluding gem core
            if r > 150 and g > 110 and b < 120 and (r + g) > (b + 220):
                if not (in_gem and r > 180 and g > 90):
                    gold_px[x, y] = min(255, int((r + g) * 0.45))

    gem = gem.filter(ImageFilter.GaussianBlur(6))
    gold = gold.filter(ImageFilter.GaussianBlur(3))
    core = gem.filter(ImageFilter.GaussianBlur(2))
    return gem, gold, core


def shift_layer(
    layer: Image.Image,
    mask: Image.Image,
    offset_y: float,
    scale_y: float,
) -> Image.Image:
    """Apply a subtle vertical drift to a masked region."""
    w, h = layer.size
    region = layer.copy()
    if abs(offset_y) > 0.01 or abs(scale_y - 1.0) > 0.001:
        new_h = max(1, int(h * scale_y))
        region = region.resize((w, new_h), Image.LANCZOS)
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        y = int((h - new_h) / 2 + offset_y)
        canvas.paste(region, (0, y), region)
        region = canvas

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(region, (0, 0), mask)
    base = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    base.paste(layer, (0, 0), ImageChops.invert(mask))
    return Image.alpha_composite(base, out)


def screen_blend(bottom: Image.Image, top: Image.Image, alpha: float) -> Image.Image:
    if alpha <= 0:
        return bottom.copy()
    top = top.copy()
    top.putalpha(Image.eval(top.getchannel("A"), lambda a: int(a * alpha)))
    return Image.alpha_composite(bottom, top)


def render_frame(
    base: Image.Image,
    gem_mask: Image.Image,
    gold_mask: Image.Image,
    core_mask: Image.Image,
    t: float,
) -> Image.Image:
    glow_a = seamless_pulse(t, 0.55, 0.92, phase=0.0)
    glow_bright = seamless_pulse(t, 0.88, 1.12, phase=0.0)
    gold_a = seamless_pulse(t, 0.35, 1.0, phase=120 / DURATION_MS)
    drift = math.sin(2 * math.pi * t) * 1.5 + math.sin(4 * math.pi * t + 0.6) * 0.8
    scale_y = 0.98 + 0.06 * (0.5 - 0.5 * math.cos(2 * math.pi * t))
    core_bright = seamless_pulse(t, 0.92, 1.08, phase=0.08)

    core_layer = ImageEnhance.Brightness(base).enhance(core_bright)
    core_layer = ImageEnhance.Color(core_layer).enhance(
        0.96 + 0.12 * (core_bright - 0.92) / 0.16
    )
    shifted_core = shift_layer(core_layer, core_mask, offset_y=drift, scale_y=scale_y)
    frame = Image.composite(shifted_core, base, core_mask)

    glow_layer = frame.copy()
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(10))
    glow_layer.putalpha(gem_mask)
    glow_layer = ImageEnhance.Brightness(glow_layer).enhance(glow_bright)
    frame = screen_blend(frame, glow_layer, glow_a * 0.85)

    gold_layer = frame.copy()
    gold_layer = ImageEnhance.Brightness(gold_layer).enhance(1.2)
    gold_layer = ImageEnhance.Color(gold_layer).enhance(1.35)
    gold_layer.putalpha(gold_mask)
    frame = screen_blend(frame, gold_layer, gold_a * 0.55)

    return frame


def export_gif() -> None:
    if not SRC.exists():
        sys.exit(f"Source logo not found: {SRC}")

    source = Image.open(SRC)
    base = fit_square(source, SIZE, BG)
    gem_mask, gold_mask, core_mask = build_masks(base)

    frames: list[Image.Image] = []
    for i in range(FRAME_COUNT):
        t = i / FRAME_COUNT
        frame = render_frame(base, gem_mask, gold_mask, core_mask, t)
        frames.append(frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_MS,
        loop=0,
        optimize=True,
        disposal=2,
    )

    size_kb = OUT.stat().st_size / 1024
    print(f"Wrote {OUT} ({FRAME_COUNT} frames @ {FPS}fps, {size_kb:.1f} KB)")


if __name__ == "__main__":
    export_gif()
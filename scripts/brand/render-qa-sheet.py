#!/usr/bin/env python3
"""Render the brand QA sheet from the generated assets.

Shows the mark, the lockup, the iOS icon under Apple's mask at every system
size, the Android adaptive layers under each launcher mask, and tiny sizes, so
a change to Branding/Mark.svg can be judged before it ships.

    pip install cairosvg pillow numpy
    node scripts/brand/generate-brand-assets.mjs
    python3 scripts/brand/render-qa-sheet.py   # -> docs/mobile/icon-previews/brand-qa.png
"""
import io
from pathlib import Path

import cairosvg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/mobile/icon-previews/brand-qa.png"
FONT = ROOT / "frontend/node_modules/geist/dist/fonts/geist-sans"

PAPER = (246, 247, 245, 255)
DARK = (18, 24, 21, 255)
INK = (23, 26, 24, 255)
MUTED = (93, 101, 95, 255)
WALL = [(206, 224, 238), (238, 222, 206)]


def font(size, weight="Regular"):
    return ImageFont.truetype(str(FONT / f"Geist-{weight}.ttf"), size)


def svg(path, width=None, height=None):
    png = cairosvg.svg2png(url=str(ROOT / path), output_width=width, output_height=height)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def png(path):
    return Image.open(ROOT / path).convert("RGBA")


def superellipse(size, n=5.0):
    """Apple's continuous-corner icon shape, close enough to judge clearance."""
    s = size * 4
    y, x = np.mgrid[0:s, 0:s]
    u = np.abs((x + 0.5) / s * 2 - 1)
    v = np.abs((y + 0.5) / s * 2 - 1)
    m = ((u**n + v**n) <= 1).astype(np.uint8) * 255
    return Image.fromarray(m, "L").resize((size, size), Image.LANCZOS)


def mask_rounded(size, radius):
    m = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius * 4, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def mask_circle(size):
    m = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    return m.resize((size, size), Image.LANCZOS)


def mask_teardrop(size):
    s = size * 4
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([0, 0, s - 1, s - 1], fill=255)
    d.rectangle([s // 2, s // 2, s - 1, s - 1], fill=255)
    return m.resize((size, size), Image.LANCZOS)


def apply(img, mask):
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def ios_icon(size):
    icon = png("apps/mobile/assets/icon.png").resize((size, size), Image.LANCZOS)
    return apply(icon, superellipse(size))


def android_visible(size, fg="apps/mobile/assets/android-icon-foreground.png", bg=None):
    """Composite the adaptive layers and crop to the 72dp a launcher shows of 108dp."""
    base = png("apps/mobile/assets/android-icon-background.png") if bg is None else Image.new("RGBA", (512, 512), bg)
    layer = png(fg).resize((512, 512), Image.LANCZOS)
    if fg.endswith("monochrome.png"):
        # Themed icons: the launcher tints the monochrome layer's alpha.
        tint = Image.new("RGBA", layer.size, (22, 60, 40, 255))
        tint.putalpha(layer.getchannel("A"))
        layer = tint
    base.alpha_composite(layer)
    inset = round(512 * 18 / 108)
    return base.crop((inset, inset, 512 - inset, 512 - inset)).resize((size, size), Image.LANCZOS)


def safe_zone_overlay(img):
    """Dashed 66dp safe circle over a visible 72dp tile."""
    d = ImageDraw.Draw(img)
    s = img.size[0]
    r = s * 33 / 72  # 66dp diameter out of the 72dp shown
    c = s / 2
    for a in range(0, 360, 8):
        t0, t1 = np.radians(a), np.radians(a + 4)
        d.line([(c + r * np.cos(t0), c + r * np.sin(t0)), (c + r * np.cos(t1), c + r * np.sin(t1))], fill=(255, 80, 80, 255), width=2)
    return img


class Sheet:
    def __init__(self, width, height):
        self.img = Image.new("RGBA", (width, height), PAPER)
        self.d = ImageDraw.Draw(self.img)

    def text(self, xy, s, size=20, weight="Regular", fill=INK):
        self.d.text(xy, s, font=font(size, weight), fill=fill)

    def put(self, im, xy):
        self.img.alpha_composite(im, (int(xy[0]), int(xy[1])))

    def caption(self, x, y, s):
        self.text((x, y), s, 16, fill=MUTED)


def main():
    W = 1800
    sh = Sheet(W, 2620)
    x0 = 60
    sh.text((x0, 40), "ReviewBoost brand QA", 44, "SemiBold")
    sh.caption(x0, 100, "Everything below is rendered from the generated assets. Source: Branding/Mark.svg")

    # --- Brand
    y = 160
    sh.text((x0, y), "Brand", 28, "SemiBold")
    y += 50
    tile = 320
    white = Image.new("RGBA", (tile, tile), (255, 255, 255, 255))
    white.alpha_composite(svg("Branding/Mark.svg", height=200), ((tile - 216) // 2, 60))
    sh.put(white, (x0, y)); sh.caption(x0, y + tile + 10, "Mark on white")
    dark = Image.new("RGBA", (tile, tile), DARK)
    dark.alpha_composite(svg("Branding/Mark.svg", height=200), ((tile - 216) // 2, 60))
    sh.put(dark, (x0 + tile + 30, y)); sh.caption(x0 + tile + 30, y + tile + 10, "Mark on dark (counter shows the page)")
    lw = W - x0 * 2 - (tile + 30) * 2
    lock = Image.new("RGBA", (lw, tile // 2 - 8), (255, 255, 255, 255))
    l = svg("Branding/Logo.svg", height=90)
    lock.alpha_composite(l, ((lw - l.size[0]) // 2, (lock.size[1] - 90) // 2))
    sh.put(lock, (x0 + (tile + 30) * 2, y))
    lockd = Image.new("RGBA", (lw, tile // 2 - 8), DARK)
    ld = svg("Branding/Logo-on-dark.svg", height=90)
    lockd.alpha_composite(ld, ((lw - ld.size[0]) // 2, (lockd.size[1] - 90) // 2))
    sh.put(lockd, (x0 + (tile + 30) * 2, y + tile // 2 + 8))
    sh.caption(x0 + (tile + 30) * 2, y + tile + 10, "Horizontal lockup, light and dark")

    # --- iOS
    y += tile + 70
    sh.text((x0, y), "iOS", 28, "SemiBold")
    y += 50
    src = png("apps/mobile/assets/icon.png").resize((360, 360), Image.LANCZOS)
    sh.put(src, (x0, y)); sh.caption(x0, y + 370, "1024 source, full square (no mask)")
    masked = ios_icon(360)
    sh.put(masked, (x0 + 400, y)); sh.caption(x0 + 400, y + 370, "Under Apple's mask")

    # Home screen mock at @2x: 60pt icons on a wallpaper.
    hx = x0 + 800
    wall = Image.new("RGBA", (W - hx - x0, 360))
    wd = ImageDraw.Draw(wall)
    for i in range(wall.size[1]):
        t = i / wall.size[1]
        c = tuple(int(WALL[0][k] * (1 - t) + WALL[1][k] * t) for k in range(3)) + (255,)
        wd.line([(0, i), (wall.size[0], i)], fill=c)
    specs = [("Home Screen", 120), ("App Library", 90), ("Spotlight", 80), ("Settings", 58), ("Notification", 40)]
    cx = 30
    for label, s in specs:
        wall.alpha_composite(ios_icon(s), (cx, 200 - s))
        ImageDraw.Draw(wall).text((cx, 215), label, font=font(15), fill=INK)
        ImageDraw.Draw(wall).text((cx, 237), f"{s // 2}pt", font=font(13), fill=MUTED)
        cx += max(s, 110) + 26
    sh.put(wall, (hx, y)); sh.caption(hx, y + 370, "System sizes at @2x on a wallpaper")

    # --- Android
    y += 430
    sh.text((x0, y), "Android adaptive icon", 28, "SemiBold")
    y += 50
    size = 220
    shapes = [
        ("Circle", mask_circle(size)),
        ("Squircle", superellipse(size, 3.2)),
        ("Rounded square", mask_rounded(size, 40)),
        ("Teardrop", mask_teardrop(size)),
    ]
    ax = x0
    for label, m in shapes:
        sh.put(apply(android_visible(size), m), (ax, y)); sh.caption(ax, y + size + 10, label)
        ax += size + 36
    sh.put(apply(safe_zone_overlay(android_visible(size)), mask_rounded(size, 0)), (ax, y))
    sh.caption(ax, y + size + 10, "66dp safe zone (red)")
    ax += size + 36
    sh.put(apply(android_visible(size, "apps/mobile/assets/android-icon-monochrome.png", (214, 232, 220, 255)), mask_circle(size)), (ax, y))
    sh.caption(ax, y + size + 10, "Themed (monochrome)")

    # --- Tiny
    y += size + 70
    sh.text((x0, y), "Tiny sizes (actual pixels, then 4x to inspect)", 28, "SemiBold")
    y += 50
    tx = x0
    for s in [16, 24, 32, 40, 60]:
        ic = png("apps/mobile/assets/icon.png").resize((s, s), Image.LANCZOS)
        sh.put(ic, (tx, y))
        sh.put(ic.resize((s * 4, s * 4), Image.NEAREST), (tx, y + 80))
        mk = svg("Branding/Mark.svg", height=s)
        sh.put(mk, (tx + s + 16, y))
        sh.caption(tx, y + 80 + s * 4 + 10, f"{s}px")
        tx += max(s * 4, s * 2 + 16) + 50
    sh.img = sh.img.crop((0, 0, W, y + 80 + 240 + 60))
    sh.img.convert("RGB").save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

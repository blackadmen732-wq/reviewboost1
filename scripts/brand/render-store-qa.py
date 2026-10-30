#!/usr/bin/env python3
"""Render the store and release QA sheet from what the native builds really ship.

Reads the icons Expo prebuild writes (the Xcode AppIcon asset catalog and the
Android mipmaps), not the source PNGs, plus the Google Play listing icon, and
checks the facts the stores care about before drawing them.

    cd apps/mobile && npx expo prebuild --no-install --clean && git checkout package.json && cd ../..
    python3 scripts/brand/render-store-qa.py   # -> docs/mobile/icon-previews/store-assets-qa.png
    rm -rf apps/mobile/ios apps/mobile/android    # generated, gitignored
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from importlib import import_module  # noqa: E402

qa = import_module("render-qa-sheet")  # shares masks, fonts and layout helpers

ROOT = qa.ROOT
OUT = ROOT / "docs/mobile/icon-previews/store-assets-qa.png"
APPICON = ROOT / "apps/mobile/ios/ReviewBoost/Images.xcassets/AppIcon.appiconset"
MIPMAP = ROOT / "apps/mobile/android/app/src/main/res/mipmap-xxxhdpi"
PLAY = ROOT / "store-assets/google-play/icon-512.png"


def check_ios():
    contents = json.loads((APPICON / "Contents.json").read_text())
    [entry] = contents["images"]
    icon = Image.open(APPICON / entry["filename"])
    source = Image.open(ROOT / "apps/mobile/assets/icon.png")
    same = ImageChops.difference(icon.convert("RGB"), source.convert("RGB")).getbbox() is None
    # A baked corner would show as a non-green (or transparent) corner pixel.
    corners = [icon.getpixel(p) for p in [(0, 0), (1023, 0), (0, 1023), (1023, 1023)]]
    facts = {
        "size": icon.size == (1024, 1024),
        "no alpha channel": icon.mode == "RGB",
        "square corners (no baked radius)": all(c[:3] == (0, 168, 107) for c in corners),
        "pixels identical to assets/icon.png": same,
    }
    return icon.convert("RGBA"), facts


def check_android():
    fg = Image.open(MIPMAP / "ic_launcher_foreground.webp").convert("RGBA")
    bg = Image.open(MIPMAP / "ic_launcher_background.webp").convert("RGBA")
    mono = Image.open(MIPMAP / "ic_launcher_monochrome.webp").convert("RGBA")
    size = fg.size[0]  # 108dp at xxxhdpi = 432px
    alpha = np.array(fg.getchannel("A")) > 16
    ys, xs = np.nonzero(alpha)
    c = (size - 1) / 2
    reach = np.sqrt((xs - c) ** 2 + (ys - c) ** 2).max() / size * 108  # in dp
    bg_flat = len(np.unique(np.array(bg.convert("RGB")).reshape(-1, 3), axis=0)) == 1
    facts = {
        f"mark reaches {reach:.1f}dp from centre (safe zone 33dp)": reach <= 33,
        "background is flat #00A86B": bg_flat and bg.getpixel((0, 0))[:3] == (0, 168, 107),
        "monochrome layer present": mono.getchannel("A").getbbox() is not None,
    }
    return fg, bg, mono, facts


def check_play():
    im = Image.open(PLAY)
    facts = {
        "512 x 512": im.size == (512, 512),
        "32-bit PNG": im.mode == "RGBA",
        f"{PLAY.stat().st_size / 1024:.0f} KB (limit 1 MB)": PLAY.stat().st_size < 1024 * 1024,
        "square, no baked corners": im.getpixel((0, 0)) == (0, 168, 107, 255),
    }
    return im.convert("RGBA"), facts


def layered(fg, bg, size, tint=None, ground=None):
    base = bg.copy() if ground is None else Image.new("RGBA", fg.size, ground)
    layer = fg
    if tint:
        layer = Image.new("RGBA", fg.size, tint)
        layer.putalpha(fg.getchannel("A"))
    base.alpha_composite(layer)
    inset = round(fg.size[0] * 18 / 108)
    return base.crop((inset, inset, fg.size[0] - inset, fg.size[0] - inset)).resize((size, size), Image.LANCZOS)


def facts_block(sh, x, y, facts):
    for i, (label, ok) in enumerate(facts.items()):
        sh.text((x, y + i * 26), ("PASS  " if ok else "FAIL  ") + label, 17, "Medium", fill=(0, 122, 77, 255) if ok else (179, 58, 58, 255))
    return all(facts.values())


def main():
    ios, ios_facts = check_ios()
    fg, bg, mono, android_facts = check_android()
    play, play_facts = check_play()

    W = 1800
    sh = qa.Sheet(W, 2000)
    x0 = 60
    sh.text((x0, 40), "ReviewBoost store and release icons", 44, "SemiBold")
    sh.caption(x0, 100, "Rendered from Expo prebuild output (Xcode AppIcon catalog, Android mipmaps) and store-assets/.")

    # iOS
    y = 160
    sh.text((x0, y), "iOS production icon (AppIcon.appiconset)", 28, "SemiBold")
    y += 50
    sh.put(ios.resize((300, 300), Image.LANCZOS), (x0, y)); sh.caption(x0, y + 310, "As shipped: full square")
    sh.put(qa.apply(ios.resize((300, 300), Image.LANCZOS), qa.superellipse(300)), (x0 + 340, y)); sh.caption(x0 + 340, y + 310, "Under Apple's mask")
    wall_x = x0 + 680
    wall = Image.new("RGBA", (W - wall_x - x0, 300))
    wd = ImageDraw.Draw(wall)
    for i in range(300):
        t = i / 300
        wd.line([(0, i), (wall.size[0], i)], fill=tuple(int(qa.WALL[0][k] * (1 - t) + qa.WALL[1][k] * t) for k in range(3)) + (255,))
    cx = 30
    for label, pt in [("Home Screen", 60), ("App Library", 45), ("Spotlight", 40), ("Settings", 29), ("Notification", 20)]:
        s = pt * 2
        wall.alpha_composite(qa.apply(ios.resize((s, s), Image.LANCZOS), qa.superellipse(s)), (cx, 170 - s))
        ImageDraw.Draw(wall).text((cx, 185), label, font=qa.font(15), fill=qa.INK)
        ImageDraw.Draw(wall).text((cx, 207), f"{pt}pt @2x", font=qa.font(13), fill=qa.MUTED)
        cx += max(s, 110) + 26
    sh.put(wall, (wall_x, y))
    y += 360
    ok_ios = facts_block(sh, x0, y, ios_facts)

    # Android
    y += 140
    sh.text((x0, y), "Android adaptive icon (mipmap-xxxhdpi)", 28, "SemiBold")
    y += 50
    size = 200
    ax = x0
    for label, m in [("Circle", qa.mask_circle(size)), ("Squircle", qa.superellipse(size, 3.2)), ("Rounded square", qa.mask_rounded(size, 36)), ("Teardrop", qa.mask_teardrop(size))]:
        sh.put(qa.apply(layered(fg, bg, size), m), (ax, y)); sh.caption(ax, y + size + 10, label)
        ax += size + 34
    safe = layered(fg, bg, size)
    d = ImageDraw.Draw(safe)
    r = size * 33 / 72
    d.ellipse([size / 2 - r, size / 2 - r, size / 2 + r, size / 2 + r], outline=(255, 80, 80, 255), width=2)
    sh.put(safe, (ax, y)); sh.caption(ax, y + size + 10, "66dp safe zone (red)")
    ax += size + 34
    sh.put(qa.apply(layered(mono, bg, size, tint=(22, 60, 40, 255), ground=(214, 232, 220, 255)), qa.mask_circle(size)), (ax, y))
    sh.caption(ax, y + size + 10, "Themed (monochrome)")
    y += size + 50
    ok_android = facts_block(sh, x0, y, android_facts)

    # Google Play
    y += 120
    sh.text((x0, y), "Google Play listing icon (store-assets/google-play/icon-512.png)", 28, "SemiBold")
    y += 50
    sh.put(play.resize((256, 256), Image.LANCZOS), (x0, y)); sh.caption(x0, y + 266, "As uploaded")
    sh.put(qa.apply(play.resize((256, 256), Image.LANCZOS), qa.mask_rounded(256, 256 * 0.2)), (x0 + 290, y)); sh.caption(x0 + 290, y + 266, "As Play displays it")
    ok_play = facts_block(sh, x0 + 600, y + 20, play_facts)

    sh.img = sh.img.crop((0, 0, W, y + 320))
    sh.img.convert("RGB").save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)}")
    for name, facts in [("iOS", ios_facts), ("Android", android_facts), ("Play", play_facts)]:
        for label, ok in facts.items():
            print(f"{'PASS' if ok else 'FAIL'}  {name}: {label}")
    if not (ok_ios and ok_android and ok_play):
        sys.exit(1)


if __name__ == "__main__":
    main()

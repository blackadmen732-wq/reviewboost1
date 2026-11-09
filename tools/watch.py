#!/usr/bin/env python3
"""
Watch a video the way a person does, not from 3 stills: every shot, every second, every word, how fast things move.
Use it on every reference Mark sends and on every render of ours BEFORE Mark sees it.

    python3 tools/watch.py <video.mp4 | https://instagram.com/reel/... | tiktok/youtube link> [out_dir]
    python3 tools/watch.py compare <ours.mp4> <reference.mp4|link> [out_dir]     # side by side, same seconds
    options: --fps 4 (frames per second on the sheets)  --no-crop  --gemini (also ask Gemini to watch it, needs the key)

Writes to out_dir (default watch/<name>/, git-ignored):
  video.mp4          the file (downloaded with yt-dlp when given a link; private/login reels need cookies, see below)
  sheet-NN.png       film strips: 3 s per sheet at --fps frames/s, timestamp on every frame, the words spoken in
                     those 3 s printed under it. READ EVERY SHEET: that is the watching.
  motion.png         how much the picture changes every 1/10 s (cuts = spikes, holds = flat, moves = hills)
  WATCH.md           shot list (start, length, motion, words), pace numbers, transcript with times
  compare: compare-NN.png (ours on top, reference under, same second) and COMPARE.md (both sets of numbers)
Screen recordings are cropped to the video automatically (ffmpeg cropdetect), so phone UI doesn't count.
Instagram login (only when a reel won't download): export cookies.txt from your browser and set
MK_COOKIES=/path/cookies.txt; never paste a password in chat.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = None
for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"]:
    if os.path.exists(f):
        FONT = f


def font(size):
    return ImageFont.truetype(FONT, size) if FONT else ImageFont.load_default()


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def probe(path):
    out = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path]).stdout)
    v = next(s for s in out["streams"] if s["codec_type"] == "video")
    num, den = v.get("avg_frame_rate", "30/1").split("/")
    has_audio = any(s["codec_type"] == "audio" for s in out["streams"])
    return {"w": int(v["width"]), "h": int(v["height"]), "fps": float(num) / max(1.0, float(den)), "dur": float(out["format"]["duration"]), "audio": has_audio}


def fetch(src, out):
    """a link -> out/video.mp4 with yt-dlp; a file -> used as is"""
    if not re.match(r"https?://", src):
        return src
    dst = out / "video.mp4"
    if dst.exists():
        return str(dst)
    cmd = ["yt-dlp", "-q", "--no-warnings", "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b", "--merge-output-format", "mp4", "-o", str(dst), src]
    if os.environ.get("MK_COOKIES"):
        cmd[1:1] = ["--cookies", os.environ["MK_COOKIES"]]
    try:
        run(cmd)
    except subprocess.CalledProcessError as e:
        sys.exit(f"download failed ({e.stderr.strip()[-300:]}).\nIf it's a login-only reel: export cookies.txt from your browser and set MK_COOKIES=/path/cookies.txt")
    return str(dst)


def cropbox(path, info):
    """the video inside a screen recording (black/UI bars cut off), or None when the frame is already clean"""
    if abs(info["w"] / info["h"] - 9 / 16) < 0.01:  # a real 9:16 export (ours): dark backgrounds are not bars
        return None
    r = subprocess.run(["ffmpeg", "-v", "info", "-i", path, "-t", str(min(20, info["dur"])), "-vf", "cropdetect=24:2:0", "-f", "null", "-"], capture_output=True, text=True)
    boxes = re.findall(r"crop=(\d+:\d+:\d+:\d+)", r.stderr)
    box = None
    if boxes:
        w, h, x, y = map(int, max(set(boxes), key=boxes.count).split(":"))
        if w * h <= 0.92 * info["w"] * info["h"]:
            box = (w, h, x, y)
    # a desktop screen recording (landscape, a phone-size video in the middle of a browser): the video is the part
    # of the screen that keeps changing, so crop to the area that moves
    if info["w"] > info["h"] and (box is None or box[0] > box[1]):
        mb = motion_box(path, info)
        if mb:
            box = mb
    return f"{box[0]}:{box[1]}:{box[2]}:{box[3]}" if box else None


def motion_box(path, info):
    sm = frames(path, 2, None, height=270).mean(axis=3)
    if len(sm) < 4:
        return None
    sd = sm.std(axis=0)
    act = sd > max(6.0, float(np.percentile(sd, 99)) * 0.25)
    cols = np.where(act.mean(axis=0) > 0.15)[0]
    rows = np.where(act.mean(axis=1) > 0.15)[0]
    if len(cols) < 10 or len(rows) < 10:
        return None
    k = info["h"] / 270
    x0, x1, y0, y1 = cols[0] * k, (cols[-1] + 1) * k, rows[0] * k, (rows[-1] + 1) * k
    w, h = int(x1 - x0) // 2 * 2, int(y1 - y0) // 2 * 2
    if w * h > 0.8 * info["w"] * info["h"]:
        return None
    return (w, h, int(x0), int(y0))


def frames(path, fps, crop, height=360):
    """all frames at fps as small RGB arrays (one ffmpeg pass)"""
    vf = (f"crop={crop}," if crop else "") + f"fps={fps},scale=-2:{height}"
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True)
    probe_w = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-frames:v", "1", "-vf", vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    w = len(probe_w) // (3 * height)
    n = len(r.stdout) // (w * height * 3)
    return np.frombuffer(r.stdout[: n * w * height * 3], np.uint8).reshape(n, height, w, 3)


def transcript(path, info):
    if not info["audio"]:
        return []
    sys.path.insert(0, str(ROOT / "template" / "tools"))
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from whisper_words import words
        return words(path)
    except (SystemExit, Exception) as e:  # noqa: BLE001  whisper not installed here: frames and motion still work
        print(f"(no transcript: {e})", file=sys.stderr)
        return []


def motion(small):
    """change between consecutive frames (0..1), on grayscale"""
    g = small.mean(axis=3).astype(np.float32) / 255
    d = np.abs(np.diff(g, axis=0)).mean(axis=(1, 2))
    return np.concatenate([[0], d])


def shots(m, fps, thresh=None):
    """cut times: spikes far above the local motion"""
    if thresh is None:
        thresh = max(0.08, float(np.median(m)) * 6)
    cuts = [0.0]
    for i in range(1, len(m)):
        if m[i] > thresh and m[i] > 2.5 * max(m[max(0, i - 3):i].max(initial=0), 1e-3) and i / fps - cuts[-1] > 0.25:
            cuts.append(i / fps)
    return cuts


def words_in(ws, a, b):
    return " ".join(w["text"] for w in ws if a <= w["start"] < b)


def motion_word(v):
    return "still" if v < 0.004 else "slow" if v < 0.015 else "moving" if v < 0.04 else "fast"


def sheets(path, info, crop, fps, ws, out, prefix="sheet", secs=3, cols=None):
    big = frames(path, fps, crop, height=420)
    per = int(round(fps * secs))
    cols = cols or min(per, 6)
    rows = (per + cols - 1) // cols
    fh, fw = big.shape[1], big.shape[2]
    made = []
    for k in range(0, len(big), per):
        chunk = big[k:k + per]
        text_h = 70
        sheet = Image.new("RGB", (cols * fw, rows * (fh + 30) + text_h), (20, 22, 26))
        d = ImageDraw.Draw(sheet)
        for j, fr in enumerate(chunk):
            x, y = (j % cols) * fw, (j // cols) * (fh + 30)
            sheet.paste(Image.fromarray(fr), (x, y + 30))
            d.text((x + 6, y + 4), f"{(k + j) / fps:5.2f}s", fill=(255, 210, 120), font=font(20))
        a, b = k / fps, (k + per) / fps
        said = words_in(ws, a, b) or "(no words)"
        d.text((8, rows * (fh + 30) + 8), f"{a:.1f}-{b:.1f}s  SAID: {said}"[:160], fill=(240, 240, 240), font=font(22))
        p = out / f"{prefix}-{len(made):02d}.png"
        sheet.save(p)
        made.append(p)
    return made


def motion_png(m, fps, cuts, out, name="motion.png"):
    W, H = 1600, 260
    img = Image.new("RGB", (W, H), (20, 22, 26))
    d = ImageDraw.Draw(img)
    n = len(m)
    top = max(0.06, float(np.percentile(m, 99)))
    for i in range(1, n):
        x0, x1 = (i - 1) / n * W, i / n * W
        d.line([(x0, H - 30 - min(1, m[i - 1] / top) * (H - 50)), (x1, H - 30 - min(1, m[i] / top) * (H - 50))], fill=(255, 106, 61), width=2)
    for c in cuts[1:]:
        x = c * fps / n * W
        d.line([(x, 10), (x, H - 30)], fill=(91, 141, 239), width=1)
    for s in range(0, int(n / fps) + 1, 5):
        d.text((s * fps / n * W + 2, H - 24), f"{s}s", fill=(160, 160, 160), font=font(16))
    d.text((8, 6), "picture change per 1/10 s (orange); blue = cuts", fill=(200, 200, 200), font=font(16))
    img.save(out / name)


def study(src, out, fps=4, crop_ok=True):
    out.mkdir(parents=True, exist_ok=True)
    path = fetch(src, out)
    info = probe(path)
    crop = cropbox(path, info) if crop_ok else None
    small = frames(path, 10, crop, height=180)
    m = motion(small)
    cuts = shots(m, 10)
    try:  # exact cuts with PySceneDetect (pip install "scenedetect[opencv-headless]"); the motion spikes are the fallback
        from scenedetect import AdaptiveDetector, detect
        sd = [0.0] + [s[0].seconds for s in detect(path, AdaptiveDetector())][1:]
        if len(sd) > 1 or len(cuts) == 1:
            cuts = sd
    except Exception as e:  # noqa: BLE001
        print(f"(scenedetect not used: {e})", file=sys.stderr)
    ws = transcript(path, info)
    rows = []
    bounds = cuts + [info["dur"]]
    for i in range(len(cuts)):
        a, b = bounds[i], bounds[i + 1]
        seg = m[int(a * 10) + 1:max(int(a * 10) + 2, int(b * 10))]
        rows.append({"n": i + 1, "start": a, "len": b - a, "motion": float(seg.mean()) if len(seg) else 0.0, "said": words_in(ws, a, b)})
    lens = [r["len"] for r in rows]
    stats = {
        "length_s": round(info["dur"], 2),
        "size": f"{info['w']}x{info['h']}" + (f" (cropped to {crop})" if crop else ""),
        "shots": len(rows),
        "median_shot_s": round(float(np.median(lens)), 2),
        "cuts_per_10s": round(10 * (len(rows) - 1) / info["dur"], 2),
        "still_share": round(float((m < 0.004).mean()), 2),
        "words": len(ws),
        "words_per_min": round(60 * len(ws) / info["dur"], 1) if ws else 0,
        "first_word_s": round(ws[0]["start"], 2) if ws else None,
    }
    motion_png(m, 10, cuts, out)
    made = sheets(path, info, crop, fps, ws, out)
    md = [f"# Watch: {src}", "", "| number | value |", "|---|---|"] + [f"| {k} | {v} |" for k, v in stats.items()]
    md += ["", "## Shots", "", "| # | start | length | motion | said |", "|---|---|---|---|---|"]
    md += [f"| {r['n']} | {r['start']:.2f}s | {r['len']:.2f}s | {motion_word(r['motion'])} | {r['said'][:90]} |" for r in rows]
    md += ["", "## Words", "", " ".join(f"[{w['start']:.1f}] {w['text']}" for w in ws) or "(no speech)", ""]
    md += [f"Sheets: {len(made)} (sheet-00.png …), 3 s each at {fps} frames/s. motion.png = the pace."]
    (out / "WATCH.md").write_text("\n".join(md))
    return {"path": path, "info": info, "crop": crop, "stats": stats, "rows": rows, "words": ws, "sheets": made}


def compare(ours, ref, out, fps=4, crop_ok=True):
    a = study(ours, out / "ours", fps, crop_ok)
    b = study(ref, out / "reference", fps, crop_ok)
    n = min(len(a["sheets"]), len(b["sheets"]))
    for k in range(n):
        top, bot = Image.open(a["sheets"][k]), Image.open(b["sheets"][k])
        w = max(top.width, bot.width)
        top = top.resize((w, int(top.height * w / top.width)))
        bot = bot.resize((w, int(bot.height * w / bot.width)))
        img = Image.new("RGB", (w, top.height + bot.height + 80), (20, 22, 26))
        d = ImageDraw.Draw(img)
        d.text((10, 6), "OURS", fill=(255, 255, 255), font=font(28))
        img.paste(top, (0, 40))
        d.text((10, top.height + 44), "REFERENCE", fill=(255, 106, 61), font=font(28))
        img.paste(bot, (0, top.height + 80))
        img.save(out / f"compare-{k:02d}.png")
    keys = list(a["stats"].keys())
    md = ["# Compare: ours vs reference", "", "| number | ours | reference |", "|---|---|---|"]
    md += [f"| {k} | {a['stats'][k]} | {b['stats'][k]} |" for k in keys]
    md += ["", f"compare-00.png … compare-{n - 1:02d}.png: the same 3 seconds of each, ours on top.", "Shot lists: ours/WATCH.md and reference/WATCH.md."]
    (out / "COMPARE.md").write_text("\n".join(md))
    return md


def gemini(path, out, prompt=None):
    """optional second pair of eyes that sees the real motion: Gemini watches the whole file.
    The key lives in the environment's network secrets (header x-goog-api-key on generativelanguage.googleapis.com);
    the proxy adds it, so a dummy goes here."""
    import urllib.request
    host = "https://generativelanguage.googleapis.com"
    model = os.environ.get("MK_GEMINI_MODEL", "gemini-2.5-flash")
    key = os.environ.get("GEMINI_API_KEY", "proxy-injected")
    size = os.path.getsize(path)
    req = urllib.request.Request(f"{host}/upload/v1beta/files", method="POST", headers={"x-goog-api-key": key, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": str(size), "X-Goog-Upload-Header-Content-Type": "video/mp4", "Content-Type": "application/json"}, data=json.dumps({"file": {"display_name": Path(path).name}}).encode())
    url = urllib.request.urlopen(req).headers["X-Goog-Upload-URL"]
    up = urllib.request.Request(url, method="POST", headers={"X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "Content-Length": str(size)}, data=open(path, "rb").read())
    f = json.loads(urllib.request.urlopen(up).read())["file"]
    import time
    while f.get("state") == "PROCESSING":
        time.sleep(3)
        f = json.loads(urllib.request.urlopen(urllib.request.Request(f"{host}/v1beta/{f['name']}", headers={"x-goog-api-key": key})).read())
    prompt = prompt or ("You are a motion-design art director. Watch this short video. Give a shot-by-shot breakdown with timestamps: "
                        "what is on screen, camera move, object size in frame, lighting, text on screen, sound/music hits, and the pace. "
                        "Then list everything that looks fake, cheap, jerky or hard to read, with the exact fix.")
    body = {"contents": [{"parts": [{"file_data": {"mime_type": "video/mp4", "file_uri": f["uri"]}}, {"text": prompt}]}]}
    r = urllib.request.Request(f"{host}/v1beta/models/{model}:generateContent", method="POST", headers={"x-goog-api-key": key, "Content-Type": "application/json"}, data=json.dumps(body).encode())
    res = json.loads(urllib.request.urlopen(r).read())
    text = "".join(p.get("text", "") for p in res["candidates"][0]["content"]["parts"])
    (out / "GEMINI.md").write_text(text)
    return text


def main(argv):
    flags = {a for a in argv if a.startswith("--")}
    args = [a for a in argv if not a.startswith("--")]
    fps = 4
    if "--fps" in argv:
        fps = float(argv[argv.index("--fps") + 1])
        args.remove(argv[argv.index("--fps") + 1])
    crop_ok = "--no-crop" not in flags
    if not args:
        sys.exit(__doc__)
    if args[0] == "compare":
        out = Path(args[3]) if len(args) > 3 else ROOT / "watch" / ("compare-" + Path(args[1]).stem)
        print("\n".join(compare(args[1], args[2], out, fps, crop_ok)))
        if "--gemini" in flags:
            print(gemini(str(Path(args[1])), out))
        print(f"\n-> {out}")
        return
    src = args[0]
    name = re.sub(r"[^a-zA-Z0-9_-]+", "-", Path(src.rstrip("/")).stem if not src.startswith("http") else src.rstrip("/").split("/")[-1])[:40]
    out = Path(args[1]) if len(args) > 1 else ROOT / "watch" / name
    r = study(src, out, fps, crop_ok)
    print((out / "WATCH.md").read_text())
    if "--gemini" in flags:
        print(gemini(r["path"], out))
    print(f"\n-> {out}")


if __name__ == "__main__":
    main(sys.argv[1:])

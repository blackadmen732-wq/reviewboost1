"""Exact word timings, free and offline (whisper.cpp). Replaces the estimate from align_pauses.py.

  python3 tools/whisper_words.py public/voice-<slug>-tight.mp3 > tools/words.json
  python3 tools/make_timeline.py tools/words.json voice-<slug>-tight.mp3

Needs the extras once per machine: `bash ../tools/setup-extras.sh` (installs whisper.cpp + its small English model
outside the repo, in $EXTRAS, default ~/mk-extras). A 90 s voice takes ~40 s. make_timeline.py then matches the
heard words to the script, so a name whisper spells differently still lands on the right script word.
Prints the same list of {text, start, end} that make_timeline.py reads.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

EXTRAS = Path(os.environ.get("EXTRAS", Path.home() / "mk-extras"))
CLI = EXTRAS / "whisper.cpp" / "build" / "bin" / "whisper-cli"
MODEL = EXTRAS / "whisper.cpp" / "models" / f"ggml-{os.environ.get('WHISPER_MODEL', 'base.en')}.bin"


def words(audio: str):
    if not CLI.exists() or not MODEL.exists():
        sys.exit(f"whisper.cpp not installed: run `bash tools/setup-extras.sh` from the repo root (looked in {EXTRAS})")
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "voice.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", audio, "-ar", "16000", "-ac", "1", str(wav)], check=True)
        # no --prompt: tested with the script as a hint, whisper squeezed 14 s of words into 7 s and dropped half
        # (make_timeline.py matches the words to the script anyway, so spelling differences don't matter)
        subprocess.run([str(CLI), "-m", str(MODEL), "-f", str(wav), "-ml", "1", "-sow", "-oj", "-of", str(Path(tmp) / "out"), "-t", "2", "-np"], check=True, capture_output=True)
        data = json.loads((Path(tmp) / "out.json").read_text())
    out = []
    for seg in data["transcription"]:
        t = seg["text"].strip()
        if t:
            out.append({"text": t, "start": seg["offsets"]["from"] / 1000, "end": seg["offsets"]["to"] / 1000})
    return out


if __name__ == "__main__":
    w = words(sys.argv[1])
    print(json.dumps(w, indent=1))
    print(f"{len(w)} words, {w[0]['start']:.2f}–{w[-1]['end']:.2f} s (whisper.cpp)", file=sys.stderr)

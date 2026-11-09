---
name: watch
description: Watch a video for real (every second, every cut, every word) instead of judging from a few stills. Use for EVERY video: any reel/TikTok/YouTube link or screen recording Mark sends ("look at this", "make it like this"), every reference, and every render of ours before Mark sees it or it is posted. Also compares ours with a reference side by side.
---
# Watch (Mark's rule, Nov 8: no exceptions)

Never describe, copy or judge a video from 3–4 stills. Watch it:

```bash
python3 tools/watch.py <file.mp4|.webm | reel/TikTok/YouTube link> [out_dir]          # one video
python3 tools/watch.py compare <ours.mp4> <reference file|link> [out_dir]               # ours vs the reference
```
- Output: `WATCH.md` (shot list, pace numbers, words with times), `sheet-NN.png` (3 s per sheet, a frame every
  0.25 s, the words said under it), `motion.png`; compare adds `COMPARE.md` + `compare-NN.png` (ours on top).
- **Read every sheet in order.** That is the watching. Then write down what the video does second by second
  (hook, camera, how big the hero object is, text style, when things change) before building anything.
- Screen recordings are cropped to the video automatically (black bars, or the moving part of a desktop screen).
- Links download with yt-dlp. A login-only Instagram reel: Mark exports `cookies.txt` from his browser and you set
  `MK_COOKIES=/path/cookies.txt`. Never ask for a password. Downloaded reels are reference only, never reposted.
- Optional second judge that sees real motion: `--gemini` (needs the Gemini key in the environment's network
  secrets: host `generativelanguage.googleapis.com`, header `x-goog-api-key`).

## Our renders (before Mark, before posting)
1. `python3 tools/watch.py compare <our video> <reference> watch/<name>`
2. Run the critic (`.claude/agents/video-critic.md`; if the agent type isn't loaded, give a general-purpose agent
   that file as its instructions) on the folder; save its full answer to `watch/<name>/CRITIC.md`.
3. Fix, re-render, repeat until `SCORE: 8/10` or more. Show Mark only after it passes.
Pace numbers to compare: `still_share` (how much of the time nothing moves), `median_shot_s`, `cuts_per_10s`,
`words_per_min`, `first_word_s`.

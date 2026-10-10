# Reel editor — violet & yellow

Renders a vertical (1080×1920) reel with:

- **Liquid glass cards**: frosted, violet-tinted panels with a moving shine, a rim light and gooey violet/yellow blobs behind them, springing in with an overshoot.
- **Hook title** that springs in, then collapses into a small chip at the top.
- **Motion graphics**: yellow progress bar, twinkling sparkles, ring pulse when a card lands, light violet colour grade and vignette.
- **Subtle subtitles**: Inter SemiBold, white text on a 50%-opacity purple box, lower third.

## Usage

```bash
python3 edit_reel.py --input REEL1010.mov --timeline timeline.json --out REEL1010_edit.mp4
# quick test on the first 10 s:
python3 edit_reel.py --input REEL1010.mov --timeline timeline.json --out test.mp4 --max-seconds 10
```

Needs `ffmpeg`, Python 3, Pillow and numpy. Audio is copied from the input.

`timeline.json` (see `timeline.example.json`):

| key | meaning |
| --- | --- |
| `hook` | `tag`, `title` lines, `highlight` words (yellow), `chip` text, `collapse_at` seconds |
| `cards` | list of `{start, end, side: left/right, y, title, body}` |
| `subtitles` | path to an `.srt` file, or a list of `{start, end, text}` |
| `subtitle_y` | vertical centre of the subtitle box (px) |

## Preview

`preview/style-preview.mp4` is a 9-second style test built from a still screenshot. The full video couldn't be downloaded into the editing session. The card text is placeholder.

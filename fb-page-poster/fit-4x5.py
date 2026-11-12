#!/usr/bin/env python3
"""Fit 9:16 story-shaped slides (1080x1920) into Instagram's 4:5 feed shape (1080x1350).

    python3 fit-4x5.py OUT_DIR SLIDE.jpg[:TOP:BOTTOM] ...

Instagram feed carousels reject 9:16 images. Rather than shrinking the whole
slide (tiny text), this keeps the band TOP..BOTTOM (default 140..1560, which
holds the content of slides with empty space below), scales it to 1350px tall,
and fills the narrow side margins with a blurred copy of the same band so the
background continues. Give a wider band for slides with content near the top or
bottom, e.g. photo.jpg:30:1560. Writes OUT_DIR/<name>-4x5.jpg.
"""

import os
import sys

from PIL import Image, ImageFilter

W, H = 1080, 1350


def fit(path, top=140, bottom=1560):
    src = Image.open(path).convert('RGB')
    band = src.crop((0, top, src.width, bottom))
    scale = H / band.height
    fg = band.resize((round(band.width * scale), H), Image.LANCZOS)
    bg = band.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(40))
    bg.paste(fg, ((W - fg.width) // 2, 0))
    return bg


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for arg in sys.argv[2:]:
        path, *band = arg.split(':')
        img = fit(path, *map(int, band)) if band else fit(path)
        name = os.path.splitext(os.path.basename(path))[0]
        dest = os.path.join(out, f'{name}-4x5.jpg')
        img.save(dest, quality=92)
        print(f'Saved {dest}')


if __name__ == '__main__':
    main()

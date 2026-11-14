#!/usr/bin/env python3
"""Turn carousel slides into 9:16 Instagram Story frames (1080x1920).

    python3 make-story.py OUT_DIR SLIDE.png [SLIDE.png ...] [--label "New on our feed"]

A 4:5 slide (1080x1350) sits in the middle of the frame, clear of the
Story bar at the top and the reply bar at the bottom, on the brand gradient. The first frame gets a small label above the slide and a
"see the full post" line below it. The background is the brand gradient. Slides that are already 9:16 are copied as
they are. Writes OUT_DIR/story-01.jpg, story-02.jpg, ...
"""
import os
import sys

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

W, H = 1080, 1920
FONTS = '/usr/share/fonts/opentype/inter/'
GOLD, LAV = (239, 168, 49), (199, 190, 218)


def font(name, size):
    try:
        return ImageFont.truetype(FONTS + name, size)
    except OSError:
        return ImageFont.load_default()


def brand_bg():
    """Brand night-to-plum gradient with a soft violet glow."""
    top, bottom = (42, 22, 120), (11, 5, 24)
    bg = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(bg)
    for y in range(H):
        t = y / (H - 1)
        d.line((0, y, W, y), fill=tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(3)))
    glow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(glow).ellipse((W * 0.45, -300, W * 1.5, 700), fill=110)
    bg.paste((112, 85, 250), mask=glow.filter(ImageFilter.GaussianBlur(160)))
    return bg


def frame(path, label=None, footer=None):
    src = Image.open(path).convert('RGB')
    if src.size == (W, H):
        return src
    slide = src.resize((W, round(src.height * W / src.width)), Image.LANCZOS)
    bg = brand_bg()
    top = (H - slide.height) // 2
    shadow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(shadow).rectangle((0, top + 20, W, top + slide.height + 40), fill=150)
    bg.paste((10, 4, 30), mask=shadow.filter(ImageFilter.GaussianBlur(30)))
    bg.paste(slide, (0, top))
    d = ImageDraw.Draw(bg)
    if label:
        f = font('InterDisplay-Bold.otf', 40)
        w = d.textlength(label.upper(), font=f) + 28 * 2
        x = (W - w) / 2; y = top - 120
        d.rounded_rectangle((x, y, x + w, y + 72), 36, outline=GOLD, width=3)
        d.text((W / 2, y + 36), label.upper(), font=f, fill=GOLD, anchor='mm')
    if footer:
        d.text((W / 2, top + slide.height + 80), footer, font=font('Inter-Medium.otf', 36), fill=LAV, anchor='mm')
    return bg


def main():
    args = sys.argv[1:]
    label = None
    if '--label' in args:
        i = args.index('--label'); label = args[i + 1]; del args[i:i + 2]
    if len(args) < 2:
        sys.exit(__doc__)
    out, slides = args[0], args[1:]
    os.makedirs(out, exist_ok=True)
    for n, path in enumerate(slides, 1):
        first = n == 1
        img = frame(path, label if first else None, 'Tap through, or see the full post on our profile' if first else None)
        dest = os.path.join(out, f'story-{n:02d}.jpg')
        img.save(dest, quality=92)
        print('Saved', dest)


if __name__ == '__main__':
    main()

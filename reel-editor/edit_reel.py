#!/usr/bin/env python3
"""Violet & yellow reel editor.

Liquid glass cards, motion graphics and subtle subtitles (white text on a 50%
opacity purple box), composited frame by frame over a vertical video.

    python3 edit_reel.py --input REEL.mov --timeline timeline.json --out out.mp4
"""
import argparse
import json
import math
import re
import subprocess
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920
VIOLET = (124, 58, 237)
VIOLET_LIGHT = (167, 139, 250)
YELLOW = (255, 214, 10)
INK = (34, 10, 78)
WHITE = (255, 255, 255)
FONT_DIR = "/usr/share/fonts/opentype/inter/"

# Light violet grade so the palette ties into the footage.
GRADE = (
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
    "colorbalance=rs=0.02:gs=-0.03:bs=0.07:rm=0.01:bm=0.04,"
    "eq=contrast=1.04:saturation=1.06,vignette=PI/6"
)


# ---------------------------------------------------------------- helpers

@lru_cache(maxsize=None)
def font(name, size):
    return ImageFont.truetype(FONT_DIR + name + ".otf", size)


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def ease_out_cubic(p):
    p = clamp(p)
    return 1 - (1 - p) ** 3


def ease_in_out_cubic(p):
    p = clamp(p)
    return 4 * p ** 3 if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2


def spring(t, stiffness=8.0, freq=13.0):
    """0 -> 1 with a liquid overshoot; t in seconds since start."""
    if t <= 0:
        return 0.0
    return 1 - math.exp(-stiffness * t) * math.cos(freq * t)


def lerp(a, b, p):
    return a + (b - a) * p


@lru_cache(maxsize=64)
def rounded_mask(w, h, r):
    """Anti-aliased rounded-rect mask (drawn at 3x, downsampled)."""
    s = 3
    m = Image.new("L", (w * s, h * s), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * s - 1, h * s - 1), r * s, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def text_size(txt, fnt):
    l, t, r, b = fnt.getbbox(txt)
    return r - l, b - t, l, t


def draw_text_glow(layer, xy, txt, fnt, fill, glow=VIOLET, radius=16, glow_alpha=210):
    """Text with a soft neon glow underneath."""
    g = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    ImageDraw.Draw(g).text(xy, txt, font=fnt, fill=glow + (glow_alpha,))
    g = g.filter(ImageFilter.GaussianBlur(radius))
    layer.alpha_composite(g)
    ImageDraw.Draw(layer).text(xy, txt, font=fnt, fill=fill)


def wrap(txt, fnt, max_w):
    words, lines, cur = txt.split(), [], ""
    for w_ in words:
        trial = (cur + " " + w_).strip()
        if text_size(trial, fnt)[0] <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


def with_alpha(img, a):
    if a >= 1:
        return img
    img = img.copy()
    img.putalpha(img.getchannel("A").point(lambda v: int(v * a)))
    return img


# ---------------------------------------------------------------- liquid glass

def glass_card(frame, box, radius, t, tint=VIOLET, alpha=1.0, shine_period=4.0):
    """Frosted liquid-glass panel composited into `frame` (RGBA) in place."""
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    w, h = x1 - x0, y1 - y0
    if w < 8 or h < 8 or alpha <= 0:
        return
    pad = 40
    region = frame.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad))
    blurred = region.filter(ImageFilter.GaussianBlur(26)).crop((pad, pad, pad + w, pad + h))

    # milky violet tint + vertical sheen
    arr = np.asarray(blurred.convert("RGB")).astype(np.float32)
    grad = np.linspace(1.0, 0.0, h, dtype=np.float32)[:, None, None]
    arr = arr * 0.62 + np.array(tint, np.float32) * 0.20 + 255 * (0.10 + 0.10 * grad)

    # moving specular streak — the "liquid" shine
    ph = ((t % shine_period) / shine_period) * 2.6 - 0.8
    xs = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    ys = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    streak = np.exp(-(((xs + ys * 0.35) - ph) ** 2) / 0.006) * 0.22
    arr = arr + 255 * streak[..., None]
    panel = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert("RGBA")

    # rim light: bright top-left edge fading to violet
    rim = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(rim)
    d.rounded_rectangle((1, 1, w - 2, h - 2), radius, outline=(255, 255, 255, 150), width=3)
    rim_fade = Image.linear_gradient("L").resize((w, h)).point(lambda v: 255 - int(v * 0.65))
    rim.putalpha(Image.fromarray(np.minimum(np.asarray(rim.getchannel("A")), np.asarray(rim_fade))))
    panel.alpha_composite(rim)

    # drop shadow
    shadow = Image.new("RGBA", (w + 120, h + 120), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((60, 75, w + 60, h + 75), radius, fill=INK + (int(110 * alpha),))
    shadow = shadow.filter(ImageFilter.GaussianBlur(30))
    frame.alpha_composite(shadow, (x0 - 60, y0 - 60))

    mask = rounded_mask(w, h, int(radius))
    if alpha < 1:
        mask = mask.point(lambda v: int(v * alpha))
    panel.putalpha(mask)
    frame.alpha_composite(panel, (x0, y0))


def liquid_blobs(frame, anchor_box, t, strength=1.0):
    """Gooey metaballs (violet → yellow) orbiting a card, drawn under the glass."""
    if strength <= 0:
        return
    s = 4  # compute at quarter resolution
    gw, gh = W // s, H // s
    yy, xx = np.mgrid[0:gh, 0:gw].astype(np.float32)
    x0, y0, x1, y1 = [v / s for v in anchor_box]
    cx, cy, rw, rh = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    blobs = [  # (orbit phase, speed, radius scale, yellow mix)
        (0.0, 0.55, 1.00, 0.0), (1.7, -0.40, 0.80, 1.0), (3.1, 0.35, 0.95, 0.15),
        (4.4, -0.50, 0.70, 0.85), (5.6, 0.45, 0.60, 0.0),
    ]
    field = np.zeros_like(xx)
    ycontrib = np.zeros_like(xx)
    base_r = min(rw, rh) * 0.42 + 6
    for ph, sp, rs, ymix in blobs:
        a = ph + t * sp
        bx = cx + math.cos(a) * rw * 0.95
        by = cy + math.sin(a * 1.3) * rh * 0.95
        r = base_r * rs * (1 + 0.12 * math.sin(t * 2.1 + ph))
        f = r * r / ((xx - bx) ** 2 + (yy - by) ** 2 + 1)
        field += f
        ycontrib += f * ymix
    alpha = np.clip((field - 0.85) / 0.35, 0, 1) * 0.9 * strength
    mix = np.clip(ycontrib / (field + 1e-6), 0, 1)[..., None]
    rgb = np.array(VIOLET_LIGHT, np.float32) * (1 - mix) + np.array(YELLOW, np.float32) * mix
    rgba = np.dstack([rgb, alpha[..., None] * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA").resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(3))
    frame.alpha_composite(img)


def sparkle(draw, cx, cy, r, color):
    """Four-point star."""
    k = r * 0.22
    pts = [(cx, cy - r), (cx + k, cy - k), (cx + r, cy), (cx + k, cy + k),
           (cx, cy + r), (cx - k, cy + k), (cx - r, cy), (cx - k, cy - k)]
    draw.polygon(pts, fill=color)


def sparkles(frame, box, t, alpha=1.0, n=7, seed=3):
    if alpha <= 0:
        return
    rng = np.random.default_rng(seed)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    for i in range(n):
        u, v = rng.uniform(-0.08, 1.08), rng.choice([-0.18, 1.12]) + rng.uniform(-0.1, 0.1)
        px = x0 + u * (x1 - x0) + math.sin(t * 0.9 + i) * 10
        py = y0 + v * (y1 - y0) + math.cos(t * 0.7 + i * 2) * 8
        tw = 0.5 + 0.5 * math.sin(t * 3.2 + i * 1.9)
        col = (YELLOW if i % 3 else WHITE) + (int(235 * tw * alpha),)
        sparkle(d, px, py, 10 + 9 * tw, col)
    glow = layer.filter(ImageFilter.GaussianBlur(6))
    frame.alpha_composite(glow)
    frame.alpha_composite(layer)


def ring_pulse(frame, center, t, alpha=1.0):
    """Expanding yellow ring when a card lands."""
    if not 0 <= t <= 0.7:
        return
    p = ease_out_cubic(t / 0.7)
    r = 30 + 260 * p
    a = int(200 * (1 - p) * alpha)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(
        (center[0] - r, center[1] - r * 0.55, center[0] + r, center[1] + r * 0.55),
        outline=YELLOW + (a,), width=5)
    frame.alpha_composite(layer.filter(ImageFilter.GaussianBlur(1.5)))


def progress_bar(frame, p):
    layer = Image.new("RGBA", (W, 60), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, x1, y = 48, W - 48, 26
    d.rounded_rectangle((x0, y, x1, y + 7), 4, fill=(255, 255, 255, 70))
    xe = x0 + (x1 - x0) * clamp(p)
    if xe > x0 + 8:
        d.rounded_rectangle((x0, y, xe, y + 7), 4, fill=YELLOW + (255,))
        d.ellipse((xe - 9, y - 5, xe + 9, y + 12), fill=WHITE + (255,))
    glow = layer.filter(ImageFilter.GaussianBlur(5))
    frame.alpha_composite(glow, (0, 0))
    frame.alpha_composite(layer, (0, 0))


# ---------------------------------------------------------------- content layers

def pill(text, fnt, fg, bg, pad=(26, 12)):
    tw, th, l, t = text_size(text, fnt)
    w, h = tw + pad[0] * 2, th + pad[1] * 2
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), h // 2, fill=bg)
    d.text((pad[0] - l, pad[1] - t), text, font=fnt, fill=fg)
    return img


class Hook:
    """Big glass title card that collapses into a compact top chip."""

    BIG = (60, 140, 1020, 560)

    def __init__(self, cfg):
        self.tag = cfg.get("tag", "")
        self.lines = cfg["title"]
        self.highlight = {w.upper() for w in cfg.get("highlight", [])}
        self.start = cfg.get("start", 0.0)
        self.collapse = cfg.get("collapse_at", 3.5)
        self.chip_text = cfg.get("chip", " ".join(self.lines).title())
        self._big_layers = None
        self._chip_layer = None
        self.chip_box = None

    def big_layers(self):
        """Tag pill + one RGBA layer per title line, positioned in card coords."""
        if self._big_layers:
            return self._big_layers
        bw = self.BIG[2] - self.BIG[0]
        layers = []
        tag = pill(self.tag.upper(), font("Inter-ExtraBold", 34), INK + (255,), YELLOW + (255,))
        layers.append((tag, ((bw - tag.width) // 2, 44)))
        fnt = font("InterDisplay-Black", 104)
        y = 44 + tag.height + 26
        for line in self.lines:
            words = line.split()
            widths = [text_size(w_ + " ", fnt)[0] for w_ in words]
            total = text_size(line, fnt)[0]
            lyr = Image.new("RGBA", (bw, 140), (0, 0, 0, 0))
            x = (bw - total) // 2
            for w_, ww in zip(words, widths):
                col = YELLOW if w_.upper().strip("?!.,") in self.highlight or w_.upper() in self.highlight else WHITE
                draw_text_glow(lyr, (x, 6), w_, fnt, col + (255,), glow=VIOLET, radius=18)
                x += ww
            layers.append((lyr, (0, y)))
            y += 118
        self.big_h = y + 30
        self._big_layers = layers
        return layers

    def chip_layer(self):
        if self._chip_layer:
            return self._chip_layer
        tag = pill(self.tag.upper(), font("Inter-ExtraBold", 24), INK + (255,), YELLOW + (255,), pad=(16, 8))
        fnt = font("Inter-Bold", 34)
        tw, th, l, t = text_size(self.chip_text, fnt)
        w, h = tag.width + 18 + tw + 56, max(tag.height, th) + 40
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        img.alpha_composite(tag, (28, (h - tag.height) // 2))
        ImageDraw.Draw(img).text((28 + tag.width + 18 - l, (h - th) // 2 - t), self.chip_text, font=fnt, fill=WHITE + (255,))
        self._chip_layer = img
        cx = W // 2
        self.chip_box = (cx - w / 2, 92, cx + w / 2, 92 + h)
        return img

    def render(self, frame, t):
        lt = t - self.start
        if lt < 0:
            return
        layers = self.big_layers()
        chip = self.chip_layer()
        big = (self.BIG[0], self.BIG[1], self.BIG[2], self.BIG[1] + self.big_h)

        pc = ease_in_out_cubic((t - self.collapse) / 0.7)
        box = [lerp(a, b, pc) for a, b in zip(big, self.chip_box)]
        # spring-in scale around the centre
        s = lerp(0.82, 1.0, spring(lt)) if pc == 0 else 1.0
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        hw, hh = (box[2] - box[0]) / 2 * s, (box[3] - box[1]) / 2 * s
        box = (cx - hw, cy - hh, cx + hw, cy + hh)
        alpha = ease_out_cubic(lt / 0.35)

        liquid_blobs(frame, box, t, strength=alpha)
        glass_card(frame, box, lerp(54, (box[3] - box[1]) / 2, pc), t, alpha=alpha)
        ring_pulse(frame, (cx, cy), lt - 0.15, alpha)

        bx, by = int(box[0]), int(box[1])
        content = Image.new("RGBA", (int(box[2] - box[0]), int(box[3] - box[1])), (0, 0, 0, 0))
        big_a = 1 - clamp(pc * 2.2)
        if big_a > 0:
            ox = (content.width - (self.BIG[2] - self.BIG[0])) // 2
            oy = (content.height - self.big_h) // 2
            for i, (lyr, (lx, ly)) in enumerate(layers):
                p = ease_out_cubic((lt - 0.12 - i * 0.12) / 0.45)
                if p <= 0:
                    continue
                content.alpha_composite(with_alpha(lyr, p * big_a), (lx + ox, int(ly + oy + (1 - p) * 40)))
        chip_a = clamp((pc - 0.5) * 2)
        if chip_a > 0:
            content.alpha_composite(with_alpha(chip, chip_a),
                                    ((content.width - chip.width) // 2, (content.height - chip.height) // 2))
        clip = rounded_mask(content.width, content.height, int(lerp(54, content.height / 2, pc)))
        content.putalpha(Image.fromarray(np.minimum(np.asarray(content.getchannel("A")), np.asarray(clip))))
        frame.alpha_composite(content, (bx, by))
        sparkles(frame, box, t, alpha=alpha * (1 - pc * 0.6))


class PointCard:
    """Glass card that springs in from the side with a key point."""

    def __init__(self, cfg):
        self.start, self.end = cfg["start"], cfg["end"]
        self.side = cfg.get("side", "right")
        self.y = cfg.get("y", 1080)
        self.icon = cfg.get("icon", "sparkle")
        self.title = cfg.get("title", "")
        self.body = cfg.get("body", "")
        self.w = cfg.get("width", 640)
        self._layer = None

    def layer(self):
        if self._layer:
            return self._layer
        pad = 40
        tf, bf = font("InterDisplay-ExtraBold", 54), font("Inter-SemiBold", 36)
        tlines = wrap(self.title, tf, self.w - pad * 2 - 96)
        blines = wrap(self.body, bf, self.w - pad * 2)
        h = pad + max(80, len(tlines) * 62) + 18 + len(blines) * 48 + pad
        img = Image.new("RGBA", (self.w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # yellow icon bubble
        d.ellipse((pad, pad, pad + 76, pad + 76), fill=YELLOW + (255,))
        if self.icon in ("", "sparkle", "✦"):
            sparkle(d, pad + 38, pad + 38, 24, INK + (255,))
        else:
            fnt = font("Inter-Black", 40)
            iw, ih, il, it = text_size(self.icon, fnt)
            d.text((pad + 38 - iw / 2 - il, pad + 38 - ih / 2 - it), self.icon, font=fnt, fill=INK + (255,))
        y = pad + 4
        for ln in tlines:
            draw_text_glow(img, (pad + 96, y), ln, tf, WHITE + (255,), radius=12, glow_alpha=160)
            y += 62
        y = pad + max(80, len(tlines) * 62) + 18
        for ln in blines:
            d.text((pad, y), ln, font=bf, fill=(255, 255, 255, 225))
            y += 48
        # yellow accent bar
        d.rounded_rectangle((pad, h - 18, pad + 120, h - 11), 4, fill=YELLOW + (255,))
        self._layer = img
        return img

    def render(self, frame, t):
        if not self.start <= t <= self.end + 0.5:
            return
        lyr = self.layer()
        pin = spring(t - self.start, stiffness=7, freq=11)
        pout = ease_in_out_cubic((t - self.end) / 0.45)
        margin = 56
        rest_x = W - margin - lyr.width if self.side == "right" else margin
        off = (W - rest_x + 40) if self.side == "right" else -(rest_x + lyr.width + 40)
        x = rest_x + off * (1 - pin) + off * pout
        alpha = clamp((t - self.start) / 0.2) * (1 - pout)
        box = (x, self.y, x + lyr.width, self.y + lyr.height)
        liquid_blobs(frame, (box[0] + 60, box[1] + 40, box[2] - 60, box[3] - 40), t * 1.2, strength=alpha * 0.8)
        glass_card(frame, box, 46, t + 1.3, alpha=alpha)
        frame.alpha_composite(with_alpha(lyr, alpha), (int(x), int(self.y)))


class Subtitles:
    """Subtle captions: white text on a 50%-opacity purple box, lower third."""

    def __init__(self, cues, y=1560):
        self.cues = cues
        self.y = y
        self.fnt = font("Inter-SemiBold", 46)
        self.cache = {}

    def box_for(self, text):
        if text in self.cache:
            return self.cache[text]
        lines = wrap(text, self.fnt, 820)
        lh = 60
        tw = max(text_size(l, self.fnt)[0] for l in lines)
        px, py = 30, 16
        w, h = tw + px * 2, len(lines) * lh + py * 2 - 6
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((0, 0, w - 1, h - 1), 22, fill=VIOLET + (128,))  # 50% opacity
        for i, ln in enumerate(lines):
            lw, _, l, t = text_size(ln, self.fnt)
            d.text(((w - lw) / 2 - l, py + i * lh + 4 - t + 4), ln, font=self.fnt, fill=WHITE + (255,))
        self.cache[text] = img
        return img

    def render(self, frame, t):
        for c in self.cues:
            if c["start"] <= t < c["end"]:
                img = self.box_for(c["text"])
                p = ease_out_cubic((t - c["start"]) / 0.15)
                q = 1 - ease_out_cubic((t - (c["end"] - 0.1)) / 0.1) if t > c["end"] - 0.1 else 1
                y = self.y - img.height / 2 + (1 - p) * 10
                frame.alpha_composite(with_alpha(img, p * q), (int((W - img.width) / 2), int(y)))
                return


def parse_srt(path):
    def ts(s):
        h, m, rest = s.strip().split(":")
        sec, ms = rest.replace(".", ",").split(",")
        return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000
    cues = []
    for block in re.split(r"\n\s*\n", open(path, encoding="utf-8").read().strip()):
        lines = [l for l in block.splitlines() if l.strip()]
        idx = next(i for i, l in enumerate(lines) if "-->" in l)
        a, b = lines[idx].split("-->")
        cues.append({"start": ts(a), "end": ts(b), "text": " ".join(lines[idx + 1:])})
    return cues


# ---------------------------------------------------------------- pipeline

def probe(path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=r_frame_rate:format=duration", "-of", "json", path])
    info = json.loads(out)
    num, den = info["streams"][0]["r_frame_rate"].split("/")
    fps = float(num) / float(den)
    return min(fps, 60.0), float(info["format"]["duration"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--max-seconds", type=float, default=None, help="render only the first N seconds")
    args = ap.parse_args()

    tl = json.load(open(args.timeline, encoding="utf-8"))
    _, duration = probe(args.input)
    if args.max_seconds:
        duration = min(duration, args.max_seconds)
    fps = args.fps

    hook = Hook(tl["hook"]) if tl.get("hook") else None
    cards = [PointCard(c) for c in tl.get("cards", [])]
    subs_cfg = tl.get("subtitles", [])
    cues = parse_srt(subs_cfg) if isinstance(subs_cfg, str) else subs_cfg
    subs = Subtitles(cues, y=tl.get("subtitle_y", 1560))

    reader = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", args.input, "-t", str(duration), "-vf", GRADE + f",fps={fps}",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    writer = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-r", str(fps), "-i", "-", "-i", args.input, "-t", str(duration),
         "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", args.out],
        stdin=subprocess.PIPE)

    frame_bytes = W * H * 3
    n = 0
    while True:
        raw = reader.stdout.read(frame_bytes)
        if len(raw) < frame_bytes:
            break
        t = n / fps
        frame = Image.frombuffer("RGB", (W, H), raw).convert("RGBA")
        for card in cards:
            card.render(frame, t)
        if hook:
            hook.render(frame, t)
        subs.render(frame, t)
        progress_bar(frame, t / duration)
        writer.stdin.write(frame.convert("RGB").tobytes())
        n += 1
        if n % 60 == 0:
            print(f"  {t:6.1f}s / {duration:.1f}s", flush=True)

    writer.stdin.close()
    reader.wait()
    writer.wait()
    print(f"done: {n} frames -> {args.out}")


if __name__ == "__main__":
    main()

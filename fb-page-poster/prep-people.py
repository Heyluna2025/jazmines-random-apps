"""Normalise coach/founder cut-outs for the hero and roster layouts: clean the
alpha, fill clothing cropped at the photo's edge, even out the colour, detect
the face and place everyone at the same face size and position.

Needs: pip install rembg onnxruntime opencv-contrib-python-headless pillow,
plus OpenCV's YuNet face model (face_detection_yunet_2023mar.onnx) in MODELS.
Cut-outs come from rembg first (isnet-general-use). Run from brand/people:

    python prep-people.py MODELS '[{"name":"ann","src":"cutouts/ann-full.png","enhance":true,"strong":true}, ...]'

Per person: enhance (2x upscale, denoise, local contrast, sharpen) for small
or harsh photos, strong (stricter edge clean-up for busy backgrounds), fill
(continue clothing cut off at the left/right edge), fill_top: N (draw N px
of the head cut off at the top edge), natural (no colour or exposure
changes: keep the original skin tone), hero:false (no cover).
Writes cutouts/<name>-tile.png (684x600), -tilewide.png (918x600) and
-poster.png (1080x1350). Photos stay local: cutouts/ is git-ignored."""
import json, sys
import cv2, numpy as np
from PIL import Image, ImageFilter, ImageEnhance

M = sys.argv[1]  # models dir
det = cv2.FaceDetectorYN.create(f'{M}/yunet.onnx', '', (320, 320), 0.6)

def clean(rgba, strong=False):
    a = np.array(rgba)[:, :, 3]
    a = np.where(a < (170 if strong else 110), 0, a).astype(np.uint8)
    if strong:  # drop thin leftovers (railings, bag straps' halos) and soften the edge
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        solid = cv2.morphologyEx((a > 0).astype(np.uint8), cv2.MORPH_OPEN, k)
        solid = cv2.erode(solid, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
        a = np.where(solid > 0, 255, 0).astype(np.uint8)
        a = cv2.GaussianBlur(a, (5, 5), 0)
    n, lab, stats, _ = cv2.connectedComponentsWithStats((a > 0).astype(np.uint8), 8)
    if n > 1:
        keep = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        a[lab != keep] = 0
    arr = np.array(rgba); arr[:, :, 3] = a
    return Image.fromarray(arr)

def fill_edges(rgba, pad=260):
    """Continue clothing that runs off the left/right edge: extrapolate the
    silhouette outward and fill it by mirroring the fabric about the edge."""
    arr = np.array(rgba).astype(np.float32); h, w = arr.shape[:2]
    out = np.zeros((h, w + 2 * pad, 4), np.float32); out[:, pad:pad + w] = arr
    for side in (0, 1):
        col = arr[:, 0 if side == 0 else w - 1, 3]
        rows = np.where(col > 128)[0]
        if not len(rows): continue
        y0 = rows.min()
        for y in range(y0, h):
            ext = min(pad - 10, (y - y0) * 0.55)  # shoulder slope, easing to a sleeve
            ext = ext * (1 - 0.35 * min(1, (y - y0) / 600))
            d = int(ext)
            for k in range(1, d + 1):
                src = min(w - 1, k) if side == 0 else max(0, w - 1 - k)
                dst = pad - k if side == 0 else pad + w - 1 + k
                px = arr[y, src].copy()
                fade = 1.0 if k < d - 6 else max(0, (d - k) / 6)
                px[3] = px[3] * fade
                out[y, dst] = px
    img = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    a = img.getchannel('A').filter(ImageFilter.GaussianBlur(1.2))
    img.putalpha(a)
    return img

def fill_top(rgba, ext):
    """Draw the top of a head cut off by the photo's top edge: a dome of
    hair above the cut, textured by mirroring the hair just below it."""
    arr = np.array(rgba); h, w = arr.shape[:2]
    out = np.zeros((h + ext, w, 4), np.uint8); out[ext:] = arr
    cols = np.where(arr[0, :, 3] > 128)[0]
    if not len(cols): return rgba
    L, R = cols.min(), cols.max(); c, half = (L + R) / 2, (R - L) / 2
    for x in range(L, R + 1):
        dh = int(ext * np.sqrt(max(0.0, 1 - ((x - c) / half) ** 2)))
        for k in range(dh):
            px = arr[min(h - 1, k), x].copy()
            px[3] = int(px[3] * min(1.0, (dh - k) / 4))
            out[ext - 1 - k, x] = px
    img = Image.fromarray(out)
    img.putalpha(img.getchannel('A').filter(ImageFilter.GaussianBlur(1.5)))
    return img

def face(rgba):
    im = Image.new('RGB', rgba.size, (128, 128, 128)); im.paste(rgba, (0, 0), rgba)
    bgr = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    scale = 1.0
    if max(bgr.shape[:2]) > 1400:
        scale = 1400 / max(bgr.shape[:2]); bgr = cv2.resize(bgr, None, fx=scale, fy=scale)
    det.setInputSize((bgr.shape[1], bgr.shape[0]))
    _, faces = det.detect(bgr)
    if faces is None: raise SystemExit('no face found')
    f = max(faces, key=lambda r: r[2] * r[3])
    x, y, fw, fh = (f[:4] / scale)
    return x, y, fw, fh

def grade(rgba, fbox, enhance=False, natural=False):
    """Even out exposure (face brightness) and give everyone the same mild,
    warm, slightly punchy look."""
    rgb = rgba.convert('RGB'); a = rgba.getchannel('A')
    if enhance:
        w, h = rgb.size
        rgb = rgb.resize((w * 2, h * 2), Image.LANCZOS); a = a.resize((w * 2, h * 2), Image.LANCZOS)
        fbox = [v * 2 for v in fbox]
        # gentle denoise + local contrast (CLAHE on L) + unsharp
        bgr = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2BGR)
        if not natural:
            bgr = cv2.bilateralFilter(bgr, 7, 30, 7)
            lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
            l, aa, bb = cv2.split(lab)
            l = cv2.createCLAHE(clipLimit=1.1, tileGridSize=(8, 8)).apply(l)
            bgr = cv2.cvtColor(cv2.merge((l, aa, bb)), cv2.COLOR_LAB2BGR)
        rgb = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)).filter(
            ImageFilter.UnsharpMask(1.2, 35, 3) if natural else ImageFilter.UnsharpMask(2.2, 90, 2))
    if natural:  # keep the photo's own skin tone and exposure
        out = rgb.convert('RGBA'); out.putalpha(a)
        return out, fbox
    x, y, fw, fh = fbox
    region = np.array(rgb.crop((int(x + fw * .2), int(y + fh * .3), int(x + fw * .8), int(y + fh * .8)))).astype(np.float32) / 255
    lum = (region @ [0.299, 0.587, 0.114]).mean()
    gamma = np.clip(np.log(0.60) / np.log(max(lum, 0.05)), 0.72, 1.0)  # only ever brighten
    arr = (np.array(rgb).astype(np.float32) / 255) ** gamma
    # neutralise heavy colour casts a little (towards grey-world on the face)
    rm = region ** gamma; means = rm.reshape(-1, 3).mean(0); target = means.mean()
    gain = np.clip((target / means) ** 0.25, 0.92, 1.08)
    arr = np.clip(arr * gain, 0, 1)
    rgb = Image.fromarray((arr * 255).astype(np.uint8))
    rgb = ImageEnhance.Contrast(rgb).enhance(0.95)
    rgb = ImageEnhance.Color(rgb).enhance(1.0)
    out = rgb.convert('RGBA'); out.putalpha(a)
    return out, fbox

def place(rgba, fbox, W, H, face_h, face_top, cx, fit=None):
    x, y, fw, fh = fbox
    if fit is not None:  # whole cut-out, top of head `fit` x H from the top
        bb = rgba.getbbox(); s = H * (1 - fit) / (bb[3] - bb[1])
        img = rgba.resize((round(rgba.width * s), round(rgba.height * s)), Image.LANCZOS)
        canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        canvas.paste(img, (round(cx - (x + fw / 2) * s), round(H * fit - bb[1] * s)), img)
        return canvas
    s = face_h / fh
    img = rgba.resize((max(1, round(rgba.width * s)), max(1, round(rgba.height * s))), Image.LANCZOS)
    bb = img.getbbox()
    ox = round(cx - (x + fw / 2) * s); oy = round(face_top - y * s)
    if oy + bb[3] < H:  # body must reach the bottom edge: grow until it does
        need = (H - face_top) / (bb[3] / s - y)
        return place(rgba, fbox, W, H, face_h * (need * fh / face_h) * 1.001, face_top, cx)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0)); canvas.paste(img, (ox, oy), img)
    return canvas

people = json.loads(sys.argv[2])
for p in people:
    n = p['name']
    im = clean(Image.open(p['src']).convert('RGBA'), p.get('strong', False))
    if p.get('fill'): im = clean(fill_edges(im), True)
    if p.get('fill_top'): im = fill_top(im, p['fill_top'])
    im = im.crop(im.getbbox())
    fb = face(im)
    im, fb = grade(im, fb, p.get('enhance', False), p.get('natural', False))
    # tiles: coaches 684x600, founders 918x600 (face 34% of height, top at 17%)
    # grid tiles: coaches 684x600 (face 36% of the height, its top at 22%, so
    # there is headroom above the hair); first-row tiles 918x600 show the
    # whole cut-out with 12% headroom (founders' photos are close-ups)
    place(im, fb, 684, 600, 0.36 * 600, 0.22 * 600, 342).save(f'cutouts/{n}-tile.png')
    place(im, fb, 918, 600, 0, 0, 459, fit=0.12).save(f'cutouts/{n}-tilewide.png')
    if p.get('hero', True):
        place(im, fb, 1080, 1350, 215, 430, 540).save(f'cutouts/{n}-poster.png')
    print(n, 'face', [round(v) for v in fb])

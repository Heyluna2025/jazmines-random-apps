"""Normalise coach/founder cut-outs for the hero and roster layouts: clean the
alpha, fill clothing cropped at the photo's edge, even out the colour, detect
the face and place everyone at the same face size and position.

Needs: pip install rembg onnxruntime opencv-contrib-python-headless pillow,
plus OpenCV's YuNet face model (face_detection_yunet_2023mar.onnx) in MODELS.
Cut-outs come from rembg first (isnet-general-use). Run from brand/people:

    python prep-people.py MODELS '[{"name":"ann","src":"cutouts/ann-full.png","enhance":true,"strong":true}, ...]'

Per person: enhance (2x upscale, denoise, local contrast, sharpen) for small
or harsh photos, strong (stricter edge clean-up for busy backgrounds), fill
(continue clothing cut off at the left/right edge), hero:false (no cover).
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

def grade(rgba, fbox, enhance=False):
    """Even out exposure (face brightness) and give everyone the same mild,
    warm, slightly punchy look."""
    rgb = rgba.convert('RGB'); a = rgba.getchannel('A')
    if enhance:
        w, h = rgb.size
        rgb = rgb.resize((w * 2, h * 2), Image.LANCZOS); a = a.resize((w * 2, h * 2), Image.LANCZOS)
        fbox = [v * 2 for v in fbox]
        # gentle denoise + local contrast (CLAHE on L) + unsharp
        bgr = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2BGR)
        bgr = cv2.bilateralFilter(bgr, 7, 30, 7)
        lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
        l, aa, bb = cv2.split(lab)
        l = cv2.createCLAHE(clipLimit=1.6, tileGridSize=(8, 8)).apply(l)
        bgr = cv2.cvtColor(cv2.merge((l, aa, bb)), cv2.COLOR_LAB2BGR)
        rgb = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)).filter(ImageFilter.UnsharpMask(2.2, 90, 2))
    x, y, fw, fh = fbox
    region = np.array(rgb.crop((int(x + fw * .2), int(y + fh * .3), int(x + fw * .8), int(y + fh * .8)))).astype(np.float32) / 255
    lum = (region @ [0.299, 0.587, 0.114]).mean()
    gamma = np.clip(np.log(0.56) / np.log(max(lum, 0.05)), 0.7, 1.35)
    arr = (np.array(rgb).astype(np.float32) / 255) ** gamma
    # neutralise heavy colour casts a little (towards grey-world on the face)
    rm = region ** gamma; means = rm.reshape(-1, 3).mean(0); target = means.mean()
    gain = np.clip((target / means) ** 0.25, 0.92, 1.08)
    arr = np.clip(arr * gain, 0, 1)
    rgb = Image.fromarray((arr * 255).astype(np.uint8))
    rgb = ImageEnhance.Contrast(rgb).enhance(1.05)
    rgb = ImageEnhance.Color(rgb).enhance(0.95)
    out = rgb.convert('RGBA'); out.putalpha(a)
    return out, fbox

def place(rgba, fbox, W, H, face_h, face_top, cx):
    x, y, fw, fh = fbox
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
    im = im.crop(im.getbbox())
    fb = face(im)
    im, fb = grade(im, fb, p.get('enhance', False))
    # tiles: coaches 684x600, founders 918x600 (face 34% of height, top at 17%)
    for kind, W, H in (('tile', 684, 600), ('tilewide', 918, 600)):
        place(im, fb, W, H, 0.40 * H, 0.15 * H, W / 2).save(f'cutouts/{n}-{kind}.png')
    if p.get('hero', True):
        place(im, fb, 1080, 1350, 215, 430, 540).save(f'cutouts/{n}-poster.png')
    print(n, 'face', [round(v) for v in fb])

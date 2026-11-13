"""Make a small or noisy photo look like it came from a better camera, locally:
Real-ESRGAN x4 rebuilds detail across the whole image (then it's brought down
to 2x for a clean result), and GFPGAN restores the face, blended back at
`--face-strength` so the person still looks like themselves.

    python restore-photo.py MODELS in.png out.png [--face-strength 0.7] [--eye-strength 0.15]

MODELS must hold real_esrgan_x4.onnx and gfpgan_1.4.onnx (facefusion-assets
release models-3.0.0) and OpenCV's yunet.onnx face detector.
Needs: pip install onnxruntime opencv-contrib-python-headless pillow numpy
"""
import sys
import cv2, numpy as np, onnxruntime as ort
from PIL import Image

M, src, dst = sys.argv[1:4]
strength = float(sys.argv[sys.argv.index('--face-strength') + 1]) if '--face-strength' in sys.argv else 0.7
# eyes behind tinted glasses are where face restoration tends to invent
# things, so they get a lighter touch of their own
eye_strength = float(sys.argv[sys.argv.index('--eye-strength') + 1]) if '--eye-strength' in sys.argv else strength
opts = ort.SessionOptions(); opts.intra_op_num_threads = 4

def esrgan(rgb, tile=192, pad=12):
    sess = ort.InferenceSession(f'{M}/real_esrgan_x4.onnx', opts, providers=['CPUExecutionProvider'])
    h, w = rgb.shape[:2]; out = np.zeros((h * 4, w * 4, 3), np.float32)
    x = rgb.astype(np.float32) / 255
    for y0 in range(0, h, tile):
        for x0 in range(0, w, tile):
            ya, yb = max(0, y0 - pad), min(h, y0 + tile + pad); xa, xb = max(0, x0 - pad), min(w, x0 + tile + pad)
            t = x[ya:yb, xa:xb].transpose(2, 0, 1)[None]
            r = sess.run(None, {'input': t})[0][0].transpose(1, 2, 0)
            oy, ox = (y0 - ya) * 4, (x0 - xa) * 4
            th, tw = min(tile, h - y0) * 4, min(tile, w - x0) * 4
            out[y0 * 4:y0 * 4 + th, x0 * 4:x0 * 4 + tw] = r[oy:oy + th, ox:ox + tw]
    return (out.clip(0, 1) * 255).astype(np.uint8)

TEMPLATE = np.array([[192.98138, 239.94708], [318.90277, 240.1936], [256.63416, 314.01935],
                     [201.26117, 371.41043], [313.08905, 371.15118]], np.float32)

def restore_faces(rgb):
    det = cv2.FaceDetectorYN.create(f'{M}/yunet.onnx', '', (320, 320), 0.6)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    sc = min(1.0, 1600 / max(bgr.shape[:2])); small = cv2.resize(bgr, None, fx=sc, fy=sc)
    det.setInputSize((small.shape[1], small.shape[0])); _, faces = det.detect(small)
    if faces is None: return rgb
    sess = ort.InferenceSession(f'{M}/gfpgan_1.4.onnx', opts, providers=['CPUExecutionProvider'])
    out = rgb.astype(np.float32)
    for f in faces:
        pts = f[4:14].reshape(5, 2) / sc
        eyes = pts[:2][np.argsort(pts[:2, 0])]; mouth = pts[3:5][np.argsort(pts[3:5, 0])]
        pts = np.vstack([eyes, pts[2:3], mouth]).astype(np.float32)
        A, _ = cv2.estimateAffinePartial2D(pts, TEMPLATE, method=cv2.LMEDS)
        crop = cv2.warpAffine(rgb, A, (512, 512), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
        t = (crop.astype(np.float32) / 255 * 2 - 1).transpose(2, 0, 1)[None]
        r = sess.run(None, {'input': t})[0][0].transpose(1, 2, 0)
        r = ((r.clip(-1, 1) + 1) / 2 * 255).astype(np.uint8)
        # keep the person's real skin tone: match the restored face's colour
        # statistics (LAB mean/spread, centre of the face) to the original
        lab_r = cv2.cvtColor(r, cv2.COLOR_RGB2LAB).astype(np.float32)
        lab_o = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).astype(np.float32)
        c = (slice(150, 420), slice(140, 372))
        for k in range(3):
            mr, sr = lab_r[c][..., k].mean(), lab_r[c][..., k].std() + 1e-3
            mo, so = lab_o[c][..., k].mean(), lab_o[c][..., k].std()
            lab_r[..., k] = (lab_r[..., k] - mr) * (so / sr if k == 0 else 1) + mo
        r = cv2.cvtColor(lab_r.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)
        Ai = cv2.invertAffineTransform(A)
        back = cv2.warpAffine(r, Ai, (rgb.shape[1], rgb.shape[0]), flags=cv2.INTER_CUBIC)
        mask = np.zeros((512, 512), np.float32); cv2.ellipse(mask, (256, 290), (190, 230), 0, 0, 360, 1, -1)
        mask = cv2.GaussianBlur(mask, (0, 0), 25)
        if eye_strength < strength:
            eyes = np.zeros((512, 512), np.float32)
            for ex, ey in TEMPLATE[:2]: cv2.ellipse(eyes, (int(ex), int(ey)), (58, 38), 0, 0, 360, 1, -1)
            eyes = cv2.GaussianBlur(eyes, (0, 0), 9)
            mask = mask * (1 - eyes * (1 - eye_strength / strength))
        m = cv2.warpAffine(mask, Ai, (rgb.shape[1], rgb.shape[0]))[..., None] * strength
        out = out * (1 - m) + back * m
    return out.clip(0, 255).astype(np.uint8)

img = np.array(Image.open(src).convert('RGB'))
cache = dst + '.up.png'  # the slow upscale is cached so face tweaks re-run fast
try:
    up = np.array(Image.open(cache).convert('RGB'))
    assert up.shape[:2] == (img.shape[0] * 2, img.shape[1] * 2)
except Exception:
    up = esrgan(img)
    up = np.array(Image.fromarray(up).resize((img.shape[1] * 2, img.shape[0] * 2), Image.LANCZOS))
    Image.fromarray(up).save(cache)
Image.fromarray(restore_faces(up)).save(dst)
print('saved', dst, up.shape)

"""ZEAL cover visualizer.

Animates the layered ZEAL cover collage in time with a track and writes an MP4.
Every movement comes from deterministic audio math (FFT band energy, spectral flux,
and damped springs driven by kick and snare impulses). No AI generation is involved,
and the same inputs always produce the same video.

Needs: Python 3, numpy, opencv-python, Pillow, and ffmpeg on the PATH.
Artwork and audio are not part of this repository. See visualizer/README.md.

Example:
    python visualizer/zeal_cover_visualizer.py track.wav 0 30 out.mp4 \
        --fmt 16x9 --num 01 --title "Each One"
"""
import cv2, numpy as np, subprocess, sys, os, argparse
from PIL import Image, ImageDraw, ImageFont
cv2.setNumThreads(2)

ap = argparse.ArgumentParser()
ap.add_argument('audio'); ap.add_argument('start', type=float); ap.add_argument('dur', type=float)
ap.add_argument('out')
ap.add_argument('--fmt', default='16x9', choices=['16x9', '9x16', '1x1'])
ap.add_argument('--num', default=''); ap.add_argument('--title', default='')
ap.add_argument('--feat', default=''); ap.add_argument('--bounce', type=float, default=1.0)
ap.add_argument('--tag', default='ZEAL', help='small line under the artist name')
ap.add_argument('--artist', default='YEAHMEL')
ap.add_argument('--cover', default='assets/zeal/cover.png', help='finished square cover image')
ap.add_argument('--layers', default='assets/zeal/layers',
                help='folder of full-canvas transparent PNG layers (CROWN.png, HANDS.png, ...)')
ap.add_argument('--canvas', type=int, default=2100, help='pixel size of the square layer canvas')
ap.add_argument('--font', default='', help='path to a bold .ttf font for the title text')
ap.add_argument('--fps', type=int, default=30)
args = ap.parse_args()

A = 1080                      # art square
FPS = args.fps
DUR = args.dur
FW, FH = {'16x9': (1920, 1080), '9x16': (1080, 1920), '1x1': (1080, 1080)}[args.fmt]
AX = (FW - A) // 2
AY = {'16x9': 0, '9x16': 400, '1x1': 0}[args.fmt]
CANVAS = args.canvas
S = A / float(CANVAS)
BN = args.bounce
LAY = args.layers
COVER = args.cover
FONT_CANDIDATES = [args.font,
                   '/usr/share/fonts/truetype/roboto/unhinted/RobotoCondensed-Bold.ttf',
                   '/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf',
                   '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
                   'C:/Windows/Fonts/arialbd.ttf']
FONT = next((f for f in FONT_CANDIDATES if f and os.path.isfile(f)), None)
for path, what in [(COVER, 'cover image (--cover)'), (LAY, 'layer folder (--layers)'), (args.audio, 'audio file')]:
    if not os.path.exists(path):
        sys.exit(f'Missing {what}: {path}')


def load_font(size):
    if FONT:
        return ImageFont.truetype(FONT, size)
    return ImageFont.load_default(size)   # needs Pillow 10.1 or newer


# ---------------- audio analysis ----------------
SR = 22050
raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(args.start), '-t', str(DUR), '-i', args.audio,
                      '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
y = np.frombuffer(raw, dtype=np.float32)
nf = int(DUR * FPS)
win = 2048
freqs = np.fft.rfftfreq(win, 1 / SR)
hann = np.hanning(win)
band = lambda lo, hi: (freqs >= lo) & (freqs < hi)
bands = {'bass': band(30, 150), 'vox': band(300, 3000), 'high': band(5000, 12000)}
E = {k: np.zeros(nf) for k in bands}
flux = np.zeros(nf); prev = None
fm = band(100, 8000)
for i in range(nf):
    c = int((i / FPS) * SR)
    seg = y[max(0, c - win // 2): c + win // 2]
    if len(seg) < win:
        seg = np.pad(seg, (0, win - len(seg)))
    mag = np.abs(np.fft.rfft(seg * hann))
    for k, m in bands.items():
        E[k][i] = np.sqrt(np.mean(mag[m] ** 2))
    if prev is not None:
        flux[i] = np.sum(np.maximum(mag[fm] - prev[fm], 0))
    prev = mag


def norm(x):
    lo, hi = np.percentile(x, 10), np.percentile(x, 97)
    return np.clip((x - lo) / (hi - lo + 1e-9), 0, 1.3)


def smooth(x, a=0.6, r=0.88):
    out = np.zeros_like(x); v = 0
    for i, t in enumerate(x):
        v = t * a + v * (1 - a) if t > v else v * r + t * (1 - r)
        out[i] = v
    return out


nb = norm(E['bass'])
bass = smooth(nb, 0.8, 0.82)
vox = smooth(norm(E['vox']), 0.5, 0.8)
high = smooth(norm(E['high']), 0.7, 0.75)
hit = smooth(norm(flux), 0.9, 0.7)
energy = smooth(norm(E['bass'] + E['vox'] + E['high']), 0.4, 0.92)
kick = np.maximum(np.diff(nb, prepend=nb[0]), 0)       # rising edges of the bass = kick impulses
snare = np.maximum(np.diff(norm(flux), prepend=0), 0)


class Spring:
    def __init__(self, k=380.0, c=11.0):
        self.k, self.c, self.x, self.v = k, c, 0.0, 0.0

    def step(self, imp, dt=1.0 / FPS):
        for _ in range(3):
            self.v += (-self.k * self.x - self.c * self.v) * (dt / 3)
            self.x += self.v * (dt / 3)
        self.v += imp
        return self.x


# ---------------- artwork ----------------
cover_full = cv2.imread(COVER)
if cover_full is None:
    sys.exit(f'Could not read cover image: {COVER}')
cover = cv2.resize(cover_full, (A, A), interpolation=cv2.INTER_AREA)


def load_layer(name):
    path = os.path.join(LAY, name + '.png')
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None or im.ndim != 3 or im.shape[2] != 4:
        sys.exit(f'Missing or non-transparent layer: {path}')
    im = im[:CANVAS, :CANVAS]
    if im.shape[0] < CANVAS or im.shape[1] < CANVAS:
        pad = np.zeros((CANVAS, CANVAS, 4), np.uint8); pad[:im.shape[0], :im.shape[1]] = im; im = pad
    return im


def sprite(name):
    im = load_layer(name)
    ys, xs = np.where(im[:, :, 3] > 8)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop = im[y0:y1, x0:x1]
    sz = (max(1, int(round(crop.shape[1] * S))), max(1, int(round(crop.shape[0] * S))))
    return dict(img=cv2.resize(crop, sz, interpolation=cv2.INTER_AREA), x=x0 * S, y=y0 * S, w=sz[0], h=sz[1])


SP = {n: sprite(n) for n in ['CROWN', 'TOUNGE', 'WORLD_ON_FIRE', 'CROSS', 'BULLETS', 'HANDS']}
base = cover.copy()
erase = np.zeros((A, A), np.uint8)
for n in ['CROWN', 'TOUNGE', 'WORLD_ON_FIRE', 'CROSS', 'BULLETS']:
    s = SP[n]; x, y_ = int(round(s['x'])), int(round(s['y']))
    a = (s['img'][:, :, 3] > 8).astype(np.uint8) * 255
    h, w = a.shape
    erase[y_:y_ + h, x:x + w] |= a[:A - y_, :A - x]
base = cv2.inpaint(base, cv2.dilate(erase, np.ones((7, 7), np.uint8)), 5, cv2.INPAINT_TELEA)

amp_by = {'FLOWERS': 1.0, 'MUSHROOMS': 1.0, 'CARDS': 0.6, 'CARDS_2': 0.6, 'CLOUDS': 0.9,
          'ROSES': 0.7, 'ROSES_2': 0.7, 'WATER_WAVE': 0.8, 'BLUE_WAVE': 0.6}
regions = {}
for n, amp in amp_by.items():
    m = cv2.resize((load_layer(n)[:, :, 3] > 8).astype(np.float32), (A, A), interpolation=cv2.INTER_AREA)
    regions[n] = cv2.GaussianBlur(m, (0, 0), 14) * amp
gx, gy = np.meshgrid(np.arange(A, dtype=np.float32), np.arange(A, dtype=np.float32))


def draw(frame, s, M3, flame=None):
    img = s['img']; h, w = img.shape[:2]
    corners = np.array([[0, 0, 1], [w, 0, 1], [0, h, 1], [w, h, 1]], np.float32).T
    pts = (M3 @ corners).T; pad = 6
    x0 = max(0, int(pts[:, 0].min()) - pad); x1 = min(A, int(pts[:, 0].max()) + pad)
    y0 = max(0, int(pts[:, 1].min()) - pad); y1 = min(A, int(pts[:, 1].max()) + pad)
    if x1 <= x0 or y1 <= y0:
        return
    M = M3.copy(); M[0, 2] -= x0; M[1, 2] -= y0
    src = img
    if flame is not None:
        yy = np.arange(h, dtype=np.float32)[:, None]; xx = np.arange(w, dtype=np.float32)[None, :]
        wt = np.clip(1 - yy / (h * 0.5), 0, 1) ** 1.3
        dx = flame['amp'] * wt * (np.sin(yy * 0.09 + flame['t'] * 9.0) + 0.5 * np.sin(yy * 0.23 - flame['t'] * 15.0))
        dy = -flame['lift'] * wt * (0.5 + 0.5 * np.sin(xx * 0.2 + flame['t'] * 11.0))
        src = cv2.remap(img, (xx + dx).astype(np.float32) + 0 * yy, (yy + dy).astype(np.float32) + 0 * xx,
                        cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    out = cv2.warpAffine(src, M, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    a = out[:, :, 3:4].astype(np.float32) / 255.0
    roi = frame[y0:y1, x0:x1].astype(np.float32)
    frame[y0:y1, x0:x1] = (roi * (1 - a) + out[:, :, :3].astype(np.float32) * a).astype(np.uint8)


def xform(s, cx, cy, sx=1.0, sy=1.0, rot=0.0, tx=0.0, ty=0.0):
    px, py = s['w'] * cx, s['h'] * cy
    c, sn = np.cos(np.radians(rot)), np.sin(np.radians(rot))
    R = np.array([[c * sx, -sn * sy], [sn * sx, c * sy]], np.float32)
    t = np.array([s['x'] + px + tx, s['y'] + py + ty], np.float32) - R @ np.array([px, py], np.float32)
    return np.hstack([R, t[:, None]])


# ---------------- backdrop + text ----------------
def make_backdrop():
    if args.fmt == '1x1':
        return None
    sc = max(FW, FH) / A
    big = cv2.resize(cover_full, (int(1400 * sc), int(1400 * sc)), interpolation=cv2.INTER_AREA)
    # crop the most colourful part (bottom) so the backdrop carries collage colour
    cx = big.shape[1] // 2
    x0 = max(0, cx - FW // 2); y0 = max(0, big.shape[0] - FH) if args.fmt == '16x9' else max(0, big.shape[0] // 2 - FH // 2)
    bd = big[y0:y0 + FH, x0:x0 + FW]
    if bd.shape[:2] != (FH, FW):
        bd = cv2.resize(bd, (FW, FH))
    bd = cv2.GaussianBlur(bd, (0, 0), 38)
    hsv = cv2.cvtColor(bd, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * 1.9, 0, 255)
    hsv[:, :, 2] = (hsv[:, :, 2] / 255.0) ** 2.4 * 255 * 0.62
    bd = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)
    yy, xx = np.mgrid[0:FH, 0:FW].astype(np.float32)
    vig = 1 - 0.55 * (((xx - FW / 2) / (FW / 2)) ** 2 + ((yy - FH / 2) / (FH / 2)) ** 2) / 2
    return bd * np.clip(vig, 0.3, 1)[:, :, None]


def fit_font(text, maxw, start, minsize=40):
    size = start
    while size > minsize:
        f = load_font(size)
        if f.getlength(text) <= maxw:
            return f
        size -= 4
    return load_font(minsize)


def tracked(d, xy, text, font, fill, track=0, anchor='l'):
    """draw text with letter-spacing; anchor l/m/r on x."""
    total = sum(font.getlength(ch) + track for ch in text) - track
    x, yv = xy
    if anchor == 'm': x -= total / 2
    elif anchor == 'r': x -= total
    for ch in text:
        d.text((x, yv), ch, font=font, fill=fill)
        x += font.getlength(ch) + track


def make_text():
    im = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cream = (240, 228, 205, 255); dim = (240, 228, 205, 150); gold = (232, 190, 130, 255)
    title = args.title.upper()
    if args.fmt == '9x16':
        tracked(d, (FW / 2, 205), args.artist.upper(), load_font(92), cream, 10, 'm')
        tracked(d, (FW / 2, 318), args.tag, load_font(34), gold, 6, 'm')
        yb = AY + A + 36
        if args.num:
            tracked(d, (FW / 2, yb), f'TRACK {args.num}', load_font(32), dim, 8, 'm')
        f = fit_font(title, 960, 130)
        tracked(d, (FW / 2, yb + 44), title, f, cream, 4, 'm')
        if args.feat:
            tracked(d, (FW / 2, yb + 44 + f.size + 16), args.feat.upper(), load_font(38), gold, 5, 'm')
    elif args.fmt == '16x9':
        pw = AX - 70
        tracked(d, (60, 70), args.artist.upper(), load_font(64), cream, 8, 'l')
        tracked(d, (60, 148), args.tag, load_font(26), gold, 5, 'l')
        if args.num:
            tracked(d, (60, 760), f'TRACK {args.num}', load_font(28), dim, 7, 'l')
        words = title.split(); lines = []; cur = ''
        f = load_font(92)
        for w_ in words:
            t = (cur + ' ' + w_).strip()
            if f.getlength(t) <= pw: cur = t
            else:
                lines.append(cur); cur = w_
        lines.append(cur)
        size = 92
        while any(load_font(size).getlength(l) > pw for l in lines) and size > 40:
            size -= 4
        f = load_font(size)
        yy = 800
        for l in lines:
            d.text((60, yy), l, font=f, fill=cream); yy += int(size * 1.0)
        if args.feat:
            tracked(d, (60, yy + 10), args.feat.upper(), load_font(28), gold, 4, 'l')
        # right panel
        tracked(d, (FW - 60, 70), 'ZEAL', load_font(64), cream, 8, 'r')
        tracked(d, (FW - 60, 148), 'THE MIXTAPE', load_font(26), gold, 5, 'r')
    a = np.array(im)
    return a[:, :, :3][:, :, ::-1].copy(), a[:, :, 3].astype(np.float32) / 255.0


backdrop = make_backdrop()
txt_rgb, txt_a = make_text()
txt_rgb = txt_rgb.astype(np.float32)

# ---------------- render ----------------
os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
af = (f'volume=-2.5dB,alimiter=limit=0.84:attack=5:release=60:level=disabled,'
      f'afade=t=in:st=0:d=0.3,afade=t=out:st={DUR - 1.0}:d=1.0')
ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{FW}x{FH}',
                       '-r', str(FPS), '-i', '-', '-ss', str(args.start), '-t', str(DUR), '-i', args.audio,
                       '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
                       '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-af', af, '-shortest', args.out],
                      stdin=subprocess.PIPE)

rng = np.random.default_rng(7)
sp = {k: Spring() for k in ['crown', 'mouth', 'globe', 'cross', 'hands', 'bob']}
sp['bob'] = Spring(260.0, 12.0)
bullet_sp = Spring(520.0, 9.0)

for i in range(nf):
    t = i / FPS
    b, v, h, ht, en = bass[i], vox[i], high[i], hit[i], energy[i]
    kk = min(kick[i], 1.0) * BN
    ss = min(snare[i], 1.0) * BN
    cr = sp['crown'].step(kk * 2.4); mo = sp['mouth'].step(kk * 1.2 + v * 0.0)
    gl = sp['globe'].step(kk * 1.6); cs = sp['cross'].step(ss * 2.2 * rng.choice([-1, 1]))
    hd = sp['hands'].step(kk * 1.4); bob = sp['bob'].step(kk * 1.8)
    bl = bullet_sp.step(ss * 3.0)

    sway = 3.0 + 9.0 * en * BN
    dx = np.zeros((A, A), np.float32); dy = np.zeros((A, A), np.float32)
    for n, m in regions.items():
        ph = (sum(map(ord, n)) % 100) / 100 * 6.28
        dx += m * sway * np.sin(gy * 0.012 + t * 2.2 + ph)
        dy += m * sway * 0.7 * np.sin(gx * 0.010 + t * 1.7 + ph)
    zoom = 1.0 + 0.016 * b * BN + 0.035 * bob
    ty_bob = 16.0 * bob
    mx = (gx - A / 2) / zoom + A / 2 + dx
    my = (gy - A / 2) / zoom + A / 2 + dy + ty_bob
    art = cv2.remap(base, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    s = SP['CROWN']      # hop + squash/stretch on every kick
    draw(art, s, xform(s, 0.5, 1.0, 1 - 0.07 * cr + 0.03 * b, 1 + 0.20 * cr + 0.05 * b, 3.0 * np.sin(t * 1.6) + 5 * cr, 0, -26 * cr - 6 * b))
    s = SP['TOUNGE']     # jaw drops on the vocal, bounces on the kick
    draw(art, s, xform(s, 0.5, 0.15, 1 + 0.04 * v + 0.05 * mo, 1 + 0.13 * v + 0.10 * mo, 0, 0, 6 * mo))
    s = SP['WORLD_ON_FIRE']
    draw(art, s, xform(s, 0.5, 0.9, 1 - 0.04 * gl + 0.04 * b, 1 + 0.12 * gl + 0.05 * b, 4 * np.sin(t * 1.1), 0, -10 * gl),
         flame=dict(amp=3 + 11 * (0.4 * h + 0.6 * en), lift=4 + 12 * h, t=t))
    s = SP['CROSS']
    draw(art, s, xform(s, 0.5, 0.5, 1 + 0.07 * h + 0.06 * abs(cs), 1 + 0.07 * h + 0.06 * abs(cs), 6 * np.sin(t * 1.3) + 22 * cs, 0, 0))
    s = SP['BULLETS']
    jx, jy = rng.normal(0, 1, 2) * 5 * ht * BN
    draw(art, s, xform(s, 0.5, 0.5, 1 + 0.07 * ht + 0.12 * abs(bl), 1 + 0.07 * ht + 0.12 * abs(bl), 14 * bl + rng.normal() * 5 * ht, jx, jy))
    s = SP['HANDS']      # grow-only so the printed hands stay covered
    g = 1.014 + 0.03 * (0.6 * b + 0.4 * v) + 0.045 * max(hd, 0)
    draw(art, s, xform(s, 0.5, 0.5, g, g, 0, 0, 0))

    if ht > 0.55:
        k = (ht - 0.55) * 0.12
        art = cv2.addWeighted(art, 1 - k, np.full_like(art, 255), k, 0)

    if backdrop is None:
        frame = art
    else:
        fr = backdrop * (1.0 + 0.30 * b * BN + 0.15 * max(bob, 0))
        frame = np.clip(fr, 0, 255).astype(np.uint8)
        frame[AY:AY + A, AX:AX + A] = art
    fa = min(1.0, t / 0.8) * min(1.0, (DUR - t) / 0.8)
    if args.title:
        al = (txt_a * fa)[:, :, None]
        frame = (frame.astype(np.float32) * (1 - al) + txt_rgb * al).astype(np.uint8)
    ff.stdin.write(frame.tobytes())
    if i % 100 == 0:
        print('frame', i, '/', nf, flush=True)
ff.stdin.close(); ff.wait()
print('done')

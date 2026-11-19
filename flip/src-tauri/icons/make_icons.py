"""Generate the Flip app icon set.

Artwork: a deep navy rounded tile with a split flip card - two cyan-to-blue
leaves hinged on a dark bar. Drawn fresh at every size so it stays crisp and
the small sizes keep the hinge readable.

Run from this folder:  python make_icons.py

The Android launcher set is written to icons/android and then installed into
gen/android/app/src/main/res, so a rebuilt project keeps Flip's icon instead of
the Tauri template art that `tauri android init` drops in.
"""

import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).parent
GEN_RES = HERE.parent / "gen" / "android" / "app" / "src" / "main" / "res"
BASE = 1024

TILE_TOP = (16, 27, 58, 255)
TILE_BOTTOM = (5, 9, 22, 255)
TILE_GLOW = (26, 42, 86, 255)

BAR = (7, 11, 26, 255)
KNOB = (43, 52, 78, 255)
KNOB_LIGHT = (62, 74, 106, 255)

CARD_A = (112, 232, 235)  # cyan
CARD_B = (31, 101, 255)  # blue


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def rounded_mask(size, radius):
    """A rounded square alpha mask for the tile itself."""
    scale = 4
    big = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    return big.resize((size, size), Image.LANCZOS)


def tile(size):
    """The background: a dark rounded square with a soft centre glow."""
    small = 48
    grad = Image.new("RGB", (small, small))
    px = grad.load()
    for y in range(small):
        base = lerp(TILE_TOP, TILE_BOTTOM, y / (small - 1))
        px_row = [lerp(base, TILE_GLOW, 0) for _ in range(small)]
        px_row = [px_row[0]] * small
        for x in range(small):
            px[x, y] = px_row[x]

    # radial lift towards the middle, so the tile is not a flat slab
    glow = Image.new("L", (small, small), 0)
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((small * 0.12, small * 0.06, small * 0.88, small * 0.72), fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(small * 0.16))
    lit = Image.composite(Image.new("RGB", (small, small), TILE_GLOW), grad, glow)

    img = lit.resize((size, size), Image.BICUBIC).convert("RGBA")
    img.putalpha(rounded_mask(size, int(size * 0.222)))
    return img


def gradient_tile(size, start, end, horizontal=False):
    """A small gradient stretched to size; cheap and smooth."""
    small = 32
    grad = Image.new("RGB", (small, small))
    px = grad.load()
    for y in range(small):
        for x in range(small):
            t = (x / (small - 1)) if horizontal else ((x + y) / (2 * (small - 1)))
            px[x, y] = lerp(start, end, t)
    return grad.resize((size, size), Image.BICUBIC)


def leaf(size, quad, radius, start, end, horizontal=False):
    """A rounded parallelogram filled with a diagonal gradient."""
    big = size * 4
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).polygon([(x * big, y * big) for x, y in quad], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(big * radius * 0.42))
    mask = mask.point(lambda v: 255 if v > 128 else 0)
    mask = mask.resize((size, size), Image.LANCZOS)

    fill = gradient_tile(size, start, end, horizontal)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(fill, (0, 0), mask)
    return out


def card(size):
    """The flip card on a transparent canvas, no tile behind it."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")

    # The upper leaf leans left as it goes down; the lower one mirrors the lean.
    top = [
        (0.245, 0.222),
        (0.815, 0.222),
        (0.735, 0.476),
        (0.165, 0.476),
    ]
    bottom = [
        (0.215, 0.505),
        (0.785, 0.505),
        (0.705, 0.759),
        (0.135, 0.759),
    ]

    img.alpha_composite(leaf(size, top, 0.055, CARD_A, CARD_B))
    img.alpha_composite(
        leaf(size, bottom, 0.055, (44, 108, 255), (118, 231, 234), horizontal=True)
    )

    # hinge bar, drawn over the leaves so it reads as the fold
    bar = (0.150, 0.473, 0.800, 0.512)
    draw.rounded_rectangle(
        (
            bar[0] * size,
            bar[1] * size,
            bar[2] * size,
            bar[3] * size,
        ),
        radius=size * 0.021,
        fill=BAR,
    )

    # the two hinge knobs
    for cx in (0.172, 0.778):
        cy = 0.4925
        r = 0.049
        draw.ellipse(
            (
                (cx - r) * size,
                (cy - r) * size,
                (cx + r) * size,
                (cy + r) * size,
            ),
            fill=KNOB,
        )
        draw.ellipse(
            (
                (cx - r * 0.62) * size,
                (cy - r * 0.72) * size,
                (cx + r * 0.34) * size,
                (cy + r * 0.24) * size,
            ),
            fill=KNOB_LIGHT,
        )

    return img


def draw_icon(size):
    img = tile(size)
    img.alpha_composite(card(size))
    return img


ANDROID_DENSITIES = [
    ("mdpi", 48, 108),
    ("hdpi", 72, 162),
    ("xhdpi", 96, 216),
    ("xxhdpi", 144, 324),
    ("xxxhdpi", 192, 432),
]

ANDROID_BG = "#101B3A"

ADAPTIVE_ICON = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <background android:drawable="@color/ic_launcher_background"/>
</adaptive-icon>
"""

COLOURS = """<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">{background}</color>
</resources>
"""


def android_icons():
    """The launcher set: legacy square and round PNGs plus an adaptive icon.

    The adaptive foreground keeps only the flip card, drawn small enough to
    survive the 66% safe zone every launcher masks to, over a navy background.
    """
    master = draw_icon(BASE)
    art = card(BASE)
    art = art.crop(art.getbbox())

    base = HERE / "android"
    for density, legacy, adaptive in ANDROID_DENSITIES:
        folder = base / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)

        square = master.resize((legacy, legacy), Image.LANCZOS)
        square.save(folder / "ic_launcher.png")

        mask = Image.new("L", (legacy * 4, legacy * 4), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, legacy * 4 - 1, legacy * 4 - 1), fill=255)
        circle = square.copy()
        circle.putalpha(mask.resize((legacy, legacy), Image.LANCZOS))
        circle.save(folder / "ic_launcher_round.png")

        target = int(adaptive * 0.62)
        scale = min(target / art.width, target / art.height)
        leaf = art.resize(
            (round(art.width * scale), round(art.height * scale)), Image.LANCZOS
        )
        canvas = Image.new("RGBA", (adaptive, adaptive), (0, 0, 0, 0))
        canvas.alpha_composite(
            leaf, ((adaptive - leaf.width) // 2, (adaptive - leaf.height) // 2)
        )
        canvas.save(folder / "ic_launcher_foreground.png")

    anydpi = base / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        (anydpi / name).write_text(ADAPTIVE_ICON, encoding="utf-8")

    colours = base / "values"
    colours.mkdir(parents=True, exist_ok=True)
    (colours / "ic_launcher_background.xml").write_text(
        COLOURS.format(background=ANDROID_BG), encoding="utf-8"
    )
    print("wrote the android launcher set")
    install_into_project(base)


def install_into_project(base):
    """Copy the set into the generated Android project, when there is one."""
    if not GEN_RES.is_dir():
        print("no generated android project yet; icons/android is ready for it")
        return

    for density, _, _ in ANDROID_DENSITIES:
        name = f"mipmap-{density}"
        shutil.copytree(base / name, GEN_RES / name, dirs_exist_ok=True)
    shutil.copytree(
        base / "mipmap-anydpi-v26", GEN_RES / "mipmap-anydpi-v26", dirs_exist_ok=True
    )

    values = GEN_RES / "values"
    values.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(
        base / "values" / "ic_launcher_background.xml",
        values / "ic_launcher_background.xml",
    )
    print(f"installed the android icons into {GEN_RES}")


def main():
    master = draw_icon(BASE)
    master.save(HERE / "icon.png")

    sizes = [16, 24, 32, 48, 64, 128, 256, 512]
    for size in sizes:
        icon = draw_icon(size) if size >= 64 else master.resize((size, size), Image.LANCZOS)
        if size == 256:
            icon.save(HERE / "128x128@2x.png")
        icon.save(HERE / f"{size}x{size}.png")

    # Windows Store style tiles, all square and full bleed
    for name, size in [
        ("Square30x30Logo.png", 30),
        ("Square44x44Logo.png", 44),
        ("Square71x71Logo.png", 71),
        ("Square89x89Logo.png", 89),
        ("Square107x107Logo.png", 107),
        ("Square142x142Logo.png", 142),
        ("Square150x150Logo.png", 150),
        ("Square284x284Logo.png", 284),
        ("Square310x310Logo.png", 310),
        ("StoreLogo.png", 50),
    ]:
        master.resize((size, size), Image.LANCZOS).save(HERE / name)

    # A multi-resolution .ico, each frame drawn at its own size.
    frames = [draw_icon(size) for size in (16, 24, 32, 48, 64, 128, 256)]
    frames[-1].save(
        HERE / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)],
    )
    android_icons()
    print("wrote icon.png, %d PNG sizes, store tiles, icon.ico and android" % len(sizes))


if __name__ == "__main__":
    main()

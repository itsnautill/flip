"""Generate the Flip app icon set.

Artwork: a deep navy rounded tile with a split flip card - two cyan-to-blue
leaves hinged on a dark bar. Drawn fresh at every size so it stays crisp and
the small sizes keep the hinge readable.

Run from this folder:  python make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).parent
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


def draw_icon(size):
    img = tile(size)
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
    print("wrote icon.png, %d PNG sizes, store tiles and icon.ico" % len(sizes))


if __name__ == "__main__":
    main()

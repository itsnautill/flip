"""Generate the Flip app icon set.

Artwork: charcoal rounded tile with three horizontal lines — cream, rust,
cream — vertically symmetrical about the middle line. This is the only icon
design now; it is drawn fresh at every size so it stays crisp.

Run from this folder:  python make_icons.py
"""

import io
import struct
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps

HERE = Path(__file__).parent
BASE = 1024

BG = (52, 50, 51, 255)
CREAM = (246, 240, 221, 255)
RUST = (176, 81, 28, 255)

LEFT_X = 0.158
RIGHT_X = 0.845
# Fractions of the tile height, measured from the middle.
OFFSETS = (-0.235, 0.0, 0.235)
WIDTH = 0.075  # line thickness as a fraction of the tile


def stroke(draw, x1, y1, x2, y2, width, fill):
    draw.line((x1, y1, x2, y2), fill=fill, width=max(1, round(width)))
    r = width / 2
    for cx, cy in ((x1, y1), (x2, y2)):
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill)


def draw_icon(edge: int) -> Image.Image:
    ss = 8 if edge <= 128 else 4
    size = edge * ss
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=round(0.219 * size), fill=BG
    )

    draw = ImageDraw.Draw(img)
    width = WIDTH * size
    for offset in OFFSETS:
        rust = offset == 0.0
        stroke(
            draw,
            LEFT_X * size,
            (0.5 + offset) * size,
            RIGHT_X * size,
            (0.5 + offset) * size,
            width * (1.25 if rust else 1.0),
            RUST if rust else CREAM,
        )
    return img.resize((edge, edge), Image.LANCZOS)


def dib_payload(im: Image.Image) -> bytes:
    """32bpp bottom-up DIB plus AND mask: what Windows expects below 256px."""
    im = im.convert("RGBA")
    width, height = im.size
    pixels = im.load()
    xor = bytearray()
    for y in range(height - 1, -1, -1):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            xor += bytes((b, g, r, a))
    mask_stride = ((width + 31) // 32) * 4
    and_mask = bytes(mask_stride * height)
    header = struct.pack(
        "<IiiHHIIiiII", 40, width, height * 2, 1, 32, 0, len(xor) + len(and_mask), 0, 0, 0, 0
    )
    return header + bytes(xor) + and_mask


def write_ico(path: Path, images) -> None:
    payloads = []
    for im in images:
        if im.width >= 256:
            buffer = io.BytesIO()
            im.save(buffer, format="PNG")
            payloads.append(buffer.getvalue())
        else:
            payloads.append(dib_payload(im))

    header = struct.pack("<HHH", 0, 1, len(images))
    entries = b""
    offset = 6 + 16 * len(payloads)
    for im, payload in zip(images, payloads):
        entries += struct.pack(
            "<BBBBHHII",
            0 if im.width >= 256 else im.width,
            0 if im.height >= 256 else im.height,
            0,
            0,
            1,
            32,
            len(payload),
            offset,
        )
        offset += len(payload)
    path.write_bytes(header + entries + b"".join(payloads))


def main() -> None:
    master = draw_icon(BASE)
    master.save(HERE / "icon.png")

    for edge in (16, 24, 32, 48, 64, 128, 256, 512):
        draw_icon(edge).save(HERE / f"{edge}x{edge}.png")
    draw_icon(256).save(HERE / "128x128@2x.png")

    for edge in (30, 44, 71, 89, 107, 142, 150, 284, 310):
        draw_icon(edge).save(HERE / f"Square{edge}x{edge}Logo.png")
    draw_icon(50).save(HERE / "StoreLogo.png")

    write_ico(
        HERE / "icon.ico",
        [draw_icon(edge) for edge in (16, 24, 32, 48, 64, 128, 256)],
    )

    flipped = ImageOps.flip(master)
    diff = ImageChops.difference(master.convert("RGB"), flipped.convert("RGB"))
    mean = sum(sum(ch.get_flattened_data()) for ch in diff.split()) / (3 * BASE * BASE)
    print(f"symmetry mean delta {mean:.3f}")

    with Image.open(HERE / "icon.ico") as check:
        print("ico frames:", sorted(check.info.get("sizes", [])))
    print("wrote icon set to", HERE)


if __name__ == "__main__":
    main()

"""Regenerate the included PNG icons using only Python's standard library."""
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "icons"
BG = (20, 23, 22)
ACCENT = (185, 217, 177)


def inside(x, y, left, top, width, height, radius):
    if not (left <= x < left + width and top <= y < top + height):
        return False
    cx = min(max(x, left + radius), left + width - radius)
    cy = min(max(y, top + radius), top + height - radius)
    return math.hypot(x - cx, y - cy) <= radius


def color(x, y):
    result = BG
    for left in (112, 212, 312):
        if inside(x, y, left, 126, 88, 260, 10):
            result = ACCENT
    for left in (178, 278):
        if inside(x, y, left, 126, 56, 155, 6):
            result = BG
    return result


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


for size, name in [(180, "apple-touch-icon"), (192, "icon-192"), (512, "icon-512")]:
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)  # PNG scanline filter
        for x in range(size):
            samples = [color((x + dx) * 512 / size, (y + dy) * 512 / size)
                       for dx in (0.25, 0.75) for dy in (0.25, 0.75)]
            pixels.extend(round(sum(c[i] for c in samples) / 4) for i in range(3))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(pixels, 9)) + chunk(b"IEND", b"")
    (ROOT / f"{name}.png").write_bytes(png)
    print(f"{name}.png: {len(png)} bytes")

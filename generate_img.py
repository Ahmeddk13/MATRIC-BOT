#!/usr/bin/env python3
"""
Generate AI image with custom text overlay and send to Telegram.

Usage:
  python3 generate_img.py "Team A vs Team B"              # VS image
  python3 generate_img.py --text "عيش اللحظة"             # custom text
  python3 generate_img.py --text "البث المباشر" --bg "sports stadium"
  python3 generate_img.py --text "Hello World" --lang en  # English
"""

import argparse
import io
import os
import random
import sys
import requests
from PIL import Image, ImageDraw, ImageFont

# Telegram config (from facebook_scraper.py defaults)
TELEGRAM_BOT_TOKEN = "8617922374:AAG_CD5GeRHcbLvBKyhgd-Fke8g_Z4I0bDQ"
TELEGRAM_CHAT_ID = "5806630118"

FONTS = {
    "ar": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "en": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
}


def get_best_font(lang: str):
    path = FONTS.get(lang, FONTS["en"])
    if os.path.exists(path):
        return path
    for p in FONTS.values():
        if os.path.exists(p):
            return p
    return None


def generate_background(width: int = 1024, height: int = 768) -> bytes:
    """Generate a beautiful gradient background using Pillow — no API needed."""
    import random
    from PIL import ImageDraw

    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Color palettes
    palettes = [
        [(10, 10, 40), (40, 10, 80), (80, 20, 60), (20, 40, 80)],       # space / night
        [(10, 40, 20), (20, 80, 40), (40, 120, 60), (10, 60, 30)],       # nature / green
        [(10, 20, 50), (20, 40, 100), (60, 80, 160), (30, 50, 120)],     # ocean / blue
        [(60, 10, 10), (120, 30, 20), (180, 60, 30), (80, 20, 15)],      # sunset / warm
        [(20, 20, 30), (50, 30, 60), (80, 40, 80), (40, 25, 50)],        # purple / moody
        [(10, 30, 20), (20, 60, 40), (15, 90, 60), (10, 50, 30)],        # teal / modern
    ]

    palette = random.choice(palettes)
    steps = 60

    for i in range(steps):
        ratio = i / steps
        next_ratio = (i + 1) / steps

        # Pick two colors and interpolate
        ci = int(ratio * (len(palette) - 1))
        ci_next = min(ci + 1, len(palette) - 1)
        local_ratio = (ratio * (len(palette) - 1)) - ci

        c1 = palette[ci]
        c2 = palette[ci_next]
        r = int(c1[0] + (c2[0] - c1[0]) * local_ratio)
        g = int(c1[1] + (c2[1] - c1[1]) * local_ratio)
        b = int(c1[2] + (c2[2] - c1[2]) * local_ratio)

        y0 = int(height * ratio)
        y1 = int(height * next_ratio)
        draw.rectangle([0, y0, width, y1], fill=(r, g, b, 255))

    # Add subtle diagonal lines / texture
    for _ in range(15):
        x1 = random.randint(0, width)
        y1 = random.randint(0, height)
        x2 = x1 + random.randint(-200, 200)
        y2 = y1 + random.randint(-200, 200)
        alpha = random.randint(5, 20)
        draw.line([(x1, y1), (x2, y2)], fill=(255, 255, 255, alpha), width=1)

    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def split_text_to_lines(text: str, font, max_width: int, draw) -> list:
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = (current + " " + word).strip()
        if draw.textlength(test, font=font) <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    if not lines:
        lines = [text]
    return lines


def generate_image(text: str, background_prompt: str = None, lang: str = "ar") -> bytes:
    bg_data = generate_background()
    img = Image.open(io.BytesIO(bg_data)).convert("RGBA")
    w, h = img.size

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    font_path = get_best_font(lang)
    font_size = max(40, int(h * 0.06))
    try:
        if font_path:
            font = ImageFont.truetype(font_path, font_size)
        else:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    max_text_width = int(w * 0.85)
    lines = split_text_to_lines(text, font, max_text_width, draw)

    line_height = font_size + 12
    total_text_height = len(lines) * line_height
    box_y = int((h - total_text_height) / 2) - 20

    # Draw semi-transparent background
    bx = int(w * 0.05)
    bw = int(w * 0.9)
    by = box_y - 15
    bh = total_text_height + 40
    draw.rectangle([bx, by, bx + bw, by + bh], fill=(0, 0, 0, 180))

    # Draw each line centered
    for i, line in enumerate(lines):
        lw = draw.textlength(line, font=font)
        tx = (w - lw) / 2
        ty = box_y + i * line_height
        draw.text((tx, ty), line, font=font, fill=(255, 255, 255))

    final = Image.alpha_composite(img, overlay).convert("RGB")
    buf = io.BytesIO()
    final.save(buf, "JPEG", quality=92)
    return buf.getvalue()


def send_telegram(image_data: bytes, caption: str = ""):
    if not image_data:
        print("  [!] No image data to send", file=sys.stderr)
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
    files = {"photo": ("image.jpg", image_data, "image/jpeg")}
    data = {"chat_id": TELEGRAM_CHAT_ID}
    if caption:
        data["caption"] = caption
    try:
        resp = requests.post(url, data=data, files=files, timeout=30)
        if resp.ok:
            print(f"  [+] Sent to Telegram chat {TELEGRAM_CHAT_ID}")
            return True
        else:
            print(f"  [!] Telegram error: {resp.text}", file=sys.stderr)
            return False
    except Exception as e:
        print(f"  [!] Failed: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(description="Generate AI image with text and send to Telegram")
    parser.add_argument("text", nargs="?", help="Text to display (e.g. 'Team A vs Team B')")
    parser.add_argument("--text", dest="text2", help="Text to display (alt)")
    parser.add_argument("--bg", help="Background prompt (default: sports stadium)")
    parser.add_argument("--lang", default="ar", choices=["ar", "en"], help="Language for font")

    args = parser.parse_args()
    text = args.text or args.text2
    if not text:
        print("Provide text. Usage:")
        print('  python3 generate_img.py "Team A vs Team B"')
        sys.exit(1)

    print(f"  [*] Generating image for: {text}")
    print(f"  [*] Background: {args.bg or 'sports stadium'}")

    image_data = generate_image(text, background_prompt=args.bg, lang=args.lang)
    if not image_data:
        print("  [X] Image generation failed", file=sys.stderr)
        sys.exit(1)

    size_kb = len(image_data) / 1024
    print(f"  [*] Image generated: {size_kb:.0f} KB")

    if send_telegram(image_data, caption=text[:200]):
        print("  [+] Done!")
    else:
        print("  [X] Failed to send to Telegram", file=sys.stderr)


if __name__ == "__main__":
    main()

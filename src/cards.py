"""Renders toast, bubble and chat-thread PNGs with alpha for cwmeditor overlays."""
import argparse
import json
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")


def font(size, bold=False):
    names = ["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]
    for name in names:
        path = os.path.join(FONT_DIR, name)
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def load_icon(path, size):
    if not path or not os.path.exists(path):
        return None
    icon = Image.open(path).convert("RGBA")
    return icon.resize((size, size), Image.LANCZOS)


def wrap(draw, text, face, max_width):
    lines, current = [], ""
    for word in text.split():
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=face) <= max_width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def gradient_card(width, height, radius, top, bottom, border, border_width=2):
    card = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    # Vertical gradient clipped to a rounded rectangle.
    gradient = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    pixels = gradient.load()
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(width):
            pixels[x, y] = (*color, 255)

    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, width - 1, height - 1], radius=radius, fill=255)
    card.paste(gradient, (0, 0), mask)

    # Soft shadow behind the card.
    shadow = Image.new("RGBA", (width + 40, height + 40), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [20, 24, width + 19, height + 25], radius=radius, fill=(0, 0, 0, 150)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(9))

    out = Image.new("RGBA", (width + 40, height + 40), (0, 0, 0, 0))
    out.alpha_composite(shadow, (0, 0))
    out.alpha_composite(card, (20, 20))

    draw = ImageDraw.Draw(out)
    draw.rounded_rectangle(
        [20, 20, width + 19, height + 19],
        radius=radius,
        outline=border,
        width=border_width,
    )
    # Thin top highlight for a little glass.
    draw.line([30, 22, width + 9, 22], fill=(255, 255, 255, 38), width=1)
    return out, (20, 20)


def draw_toast(args):
    width = args.width
    pad = max(14, width // 30)
    label_face = font(max(11, width // 44), bold=True)
    text_face = font(max(20, width // 20), bold=True)
    meta_face = font(max(10, width // 52), bold=False)
    accent = hex_rgb(args.accent)
    border = hex_rgb(args.border)

    icon_size = int(text_face.size * 1.7)
    icon = load_icon(args.icon, icon_size)
    left = pad + pad // 2 + (icon_size + pad if icon else 0)

    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    lines = wrap(probe, args.text, text_face, width - left - pad - 8)

    line_height = int(text_face.size * 1.22)
    label_height = int(label_face.size * 1.7) if args.label else 0
    text_block = label_height + line_height * len(lines)
    content = max(text_block, icon_size if icon else 0)
    height = pad * 2 + content

    card, offset = gradient_card(
        width, height, max(14, width // 26), (24, 24, 38), (10, 10, 18), border
    )
    draw = ImageDraw.Draw(card)
    ox, oy = offset

    # Accent bar on the left edge.
    draw.rounded_rectangle(
        [ox + 6, oy + pad // 2, ox + 6 + max(4, width // 130), oy + height - pad // 2],
        radius=3,
        fill=accent,
    )

    if icon:
        card.alpha_composite(icon, (ox + pad + 4, oy + (height - icon_size) // 2))

    y = oy + pad + max(0, (content - text_block) // 2)
    if args.label:
        draw.text((ox + left, y), " ".join(args.label.upper()), font=label_face, fill=accent)
        y += label_height
    for line in lines:
        draw.text((ox + left, y), line, font=text_face, fill=(255, 255, 255, 255))
        y += line_height

    draw.text(
        (ox + width - pad - 4, oy + pad - 1),
        "now",
        font=meta_face,
        fill=(150, 150, 170, 255),
        anchor="ra",
    )

    card.save(args.out)
    return card.size


def bubble_image(width, text, name, icon_path, accent_hex, border_hex, radius=None):
    pad = max(12, width // 24)
    name_face = font(max(10, width // 38), bold=True)
    text_face = font(max(18, width // 17), bold=False)
    meta_face = font(max(9, width // 46), bold=False)
    accent = hex_rgb(accent_hex)
    border = hex_rgb(border_hex)

    icon_size = int(text_face.size * 1.5)
    icon = load_icon(icon_path, icon_size)
    left = pad + (icon_size + pad if icon else 0)

    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    lines = wrap(probe, text, text_face, width - left - pad - 8)

    line_height = int(text_face.size * 1.24)
    name_height = int(name_face.size * 1.7) if name else 0
    text_block = name_height + line_height * len(lines)
    content = max(text_block, icon_size if icon else 0)
    height = pad * 2 + content

    card, (ox, oy) = gradient_card(
        width, height, radius or max(16, width // 14), (26, 26, 40), (12, 12, 20), border
    )
    draw = ImageDraw.Draw(card)

    if icon:
        card.alpha_composite(icon, (ox + pad, oy + (height - icon_size) // 2))

    y = oy + pad + max(0, (content - text_block) // 2)
    if name:
        draw.text((ox + left, y), name.upper(), font=name_face, fill=accent)
        y += name_height
    for line in lines:
        draw.text((ox + left, y), line, font=text_face, fill=(255, 255, 255, 255))
        y += line_height

    draw.text(
        (ox + width - pad, oy + pad - 1),
        "now",
        font=meta_face,
        fill=(150, 150, 170, 255),
        anchor="ra",
    )
    return card


def draw_bubble(args):
    card = bubble_image(
        args.width,
        args.text,
        args.label or None,
        args.icon,
        args.accent,
        args.border,
    )
    card.save(args.out)
    return card.size


def draw_chat(args):
    spec = json.load(open(args.spec, encoding="utf-8"))
    width = int(spec.get("width", args.width))
    gap = int(spec.get("gap", 10))
    angles = spec.get("angles", [-2.2, 1.6, -1.2, 2.0, -1.6])
    palette = spec.get("palette", ["#35E0FF", "#FF2D95", "#B27BFF", "#FFD166", "#59F7A3"])
    messages = spec["messages"][:5]

    cards = []
    for i, message in enumerate(messages):
        bubble = bubble_image(
            width,
            message["text"],
            message.get("name", f"viewer{i + 1}"),
            message.get("icon"),
            message.get("accent", palette[i % len(palette)]),
            message.get("border", palette[(i + 1) % len(palette)]),
        )
        angle = angles[i % len(angles)]
        rotated = bubble.rotate(angle, resample=Image.BICUBIC, expand=True)
        cards.append(rotated)

    canvas_width = max(c.width for c in cards) + 24
    canvas_height = sum(c.height for c in cards) + gap * (len(cards) - 1) + 24
    files = []
    y = 12
    placements = []
    for i, card in enumerate(cards):
        x = canvas_width - card.width - 12
        placements.append((x, y))
        y += card.height + gap

    for i, card in enumerate(cards):
        canvas = Image.new("RGBA", (canvas_width, canvas_height), (0, 0, 0, 0))
        canvas.alpha_composite(card, placements[i])
        file = f"{args.out}-{i}.png"
        canvas.save(file)
        files.append(file)

    print(
        json.dumps(
            {
                "canvas": {"w": canvas_width, "h": canvas_height},
                "files": files,
            }
        )
    )
    return (canvas_width, canvas_height)


def heavy_font(size):
    for name in ["ariblk.ttf", "segoeuib.ttf", "arialbd.ttf"]:
        path = os.path.join(FONT_DIR, name)
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return font(size, bold=True)


def mono_font(size):
    for name in ["consola.ttf", "consolab.ttf", "cour.ttf"]:
        path = os.path.join(FONT_DIR, name)
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return font(size)


def spec_args(args):
    return json.load(open(args.spec, encoding="utf-8"))


def finish(card, args):
    card.save(args.out)
    print(json.dumps({"files": [args.out], "canvas": {"w": card.size[0], "h": card.size[1]}}))


def draw_keycap(args):
    spec = spec_args(args)
    keys = spec.get("keys", ["Ctrl", "Shift", "P"])
    accent = hex_rgb(spec.get("accent", "#35E0FF"))
    border = hex_rgb(spec.get("border", "#FF2D95"))
    key_h = int(spec.get("height", max(56, int(spec.get("width", args.width) * 0.2))))
    pad = 16
    gap = 12

    faces = [heavy_font(int(key_h * 0.4)) for _ in keys]
    widths = []
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    for key, face in zip(keys, faces):
        widths.append(max(key_h, int(probe.textlength(key, font=face)) + pad * 2))

    total_w = sum(widths) + gap * (len(keys) - 1)
    canvas = Image.new("RGBA", (total_w + 40, key_h + 50), (0, 0, 0, 0))
    x = 20
    for key, face, width in zip(keys, faces, widths):
        key_img = Image.new("RGBA", (width, key_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(key_img)
        draw.rounded_rectangle(
            [0, 0, width - 1, key_h - 1],
            radius=14,
            fill=(26, 26, 40, 255),
            outline=border,
            width=3,
        )
        draw.rounded_rectangle([2, 2, width - 3, key_h // 2], radius=12, fill=(255, 255, 255, 12))
        draw.text(
            (width // 2, key_h // 2),
            key,
            font=face,
            fill=(255, 255, 255, 255),
            anchor="mm",
        )
        shadow = Image.new("RGBA", (width, key_h), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            [0, 0, width - 1, key_h - 1], radius=14, fill=(0, 0, 0, 140)
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(6))
        canvas.alpha_composite(shadow, (x + 3, 26))
        canvas.alpha_composite(key_img, (x, 20))
        x += width + gap
    finish(canvas, args)


def draw_command(args):
    spec = spec_args(args)
    width = int(spec.get("width", args.width))
    command = spec.get("command", "npm i opencode")
    label = spec.get("label", "terminal")
    pad = max(14, width // 26)
    dot_face = mono_font(max(12, width // 40))
    cmd_face = mono_font(max(16, width // 24))
    accent = hex_rgb(spec.get("accent", "#59F7A3"))

    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    lines = wrap(probe, f"$ {command}", cmd_face, width - pad * 2)
    line_h = int(cmd_face.size * 1.35)
    height = pad * 2 + line_h * len(lines) + int(cmd_face.size * 0.9)

    card, (ox, oy) = gradient_card(
        width, height, 16, (18, 22, 26), (8, 10, 12), hex_rgb(spec.get("border", "#35E0FF"))
    )
    draw = ImageDraw.Draw(card)
    draw.ellipse([ox + pad, oy + pad - 2, ox + pad + 9, oy + pad + 7], fill=accent)
    draw.text((ox + pad + 18, oy + pad - 4), label, font=dot_face, fill=(160, 170, 180, 255))
    y = oy + pad + int(cmd_face.size * 0.9)
    for line in lines:
        draw.text((ox + pad, y), line, font=cmd_face, fill=(235, 245, 240, 255))
        y += line_h
    finish(card, args)


def draw_stamp(args):
    spec = spec_args(args)
    text = spec.get("text", "BROKEN").upper()
    color = hex_rgb(spec.get("color", "#FF2D95"))
    angle = float(spec.get("angle", -8))
    size = int(spec.get("size", 110))
    face = heavy_font(size)

    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    width = int(probe.textlength(text, font=face)) + 60
    height = size + 46
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rectangle([4, 4, width - 5, height - 5], outline=color, width=6)
    draw.rectangle([16, 16, width - 17, height - 17], outline=color, width=2)
    draw.text((width // 2, height // 2), text, font=face, fill=color, anchor="mm")

    rotated = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
    canvas = Image.new("RGBA", (rotated.width + 20, rotated.height + 20), (0, 0, 0, 0))
    canvas.alpha_composite(rotated, (10, 10))
    finish(canvas, args)


def draw_stat(args):
    spec = spec_args(args)
    value = str(spec.get("value", "42"))
    label = spec.get("label", "errors").upper()
    width = int(spec.get("width", args.width))
    accent = hex_rgb(spec.get("accent", "#FF2D95"))
    value_face = heavy_font(int(width * 0.34))
    label_face = font(max(14, width // 22), bold=True)

    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    value_w = int(probe.textlength(value, font=value_face))
    height = int(value_face.size * 1.05) + int(label_face.size * 2.1)
    canvas_w = max(width, value_w + 40)

    card, (ox, oy) = gradient_card(
        canvas_w, height, 18, (22, 22, 34), (10, 10, 16), hex_rgb(spec.get("border", "#35E0FF"))
    )
    draw = ImageDraw.Draw(card)
    draw.text(
        (ox + canvas_w // 2, oy + int(value_face.size * 0.52)),
        value,
        font=value_face,
        fill=accent,
        anchor="mm",
    )
    draw.text(
        (ox + canvas_w // 2, oy + int(value_face.size * 1.02)),
        " ".join(label),
        font=label_face,
        fill=(230, 230, 240, 255),
        anchor="ma",
    )
    finish(card, args)


def draw_chapter(args):
    spec = spec_args(args)
    width = int(spec.get("width", args.width))
    part = spec.get("part", "PART 2").upper()
    title = spec.get("title", "where it breaks")
    pad = max(16, width // 24)
    part_face = font(max(12, width // 34), bold=True)
    title_face = heavy_font(max(22, width // 13))
    accent = hex_rgb(spec.get("accent", "#35E0FF"))

    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    lines = wrap(probe, title, title_face, width - pad * 2 - 18)
    line_h = int(title_face.size * 1.15)
    height = pad * 2 + int(part_face.size * 1.8) + line_h * len(lines)

    card, (ox, oy) = gradient_card(
        width, height, 16, (20, 20, 32), (8, 8, 14), hex_rgb(spec.get("border", "#FF2D95"))
    )
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle(
        [ox + 8, oy + pad, ox + 8 + max(5, width // 90), oy + height - pad],
        radius=3,
        fill=accent,
    )
    draw.text((ox + pad + 14, oy + pad), " ".join(part), font=part_face, fill=accent)
    y = oy + pad + int(part_face.size * 1.8)
    for line in lines:
        draw.text((ox + pad + 14, y), line, font=title_face, fill=(255, 255, 255, 255))
        y += line_h
    finish(card, args)


def draw_notification(args):
    spec = spec_args(args)
    width = int(spec.get("width", args.width))
    app = spec.get("app", "System")
    title = spec.get("title", "Low disk space")
    body = spec.get("body", "You are running out of space.")
    icon_path = spec.get("icon")
    pad = max(14, width // 26)
    app_face = font(max(10, width // 40), bold=False)
    title_face = font(max(16, width // 24), bold=True)
    body_face = font(max(12, width // 32), bold=False)

    icon_size = int(title_face.size * 2)
    icon = load_icon(icon_path, icon_size)
    left = pad + icon_size + pad if icon else pad

    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    title_lines = wrap(probe, title, title_face, width - left - pad)
    body_lines = wrap(probe, body, body_face, width - left - pad)
    line_title = int(title_face.size * 1.25)
    line_body = int(body_face.size * 1.3)
    text_h = int(app_face.size * 1.6) + line_title * len(title_lines) + line_body * len(body_lines)
    height = pad * 2 + max(text_h, icon_size)

    card, (ox, oy) = gradient_card(
        width, height, 18, (28, 28, 42), (14, 14, 22), hex_rgb(spec.get("border", "#35E0FF"))
    )
    draw = ImageDraw.Draw(card)
    if icon:
        card.alpha_composite(icon, (ox + pad, oy + (height - icon_size) // 2))
    y = oy + pad
    draw.text((ox + left, y), app, font=app_face, fill=(170, 170, 190, 255))
    y += int(app_face.size * 1.6)
    for line in title_lines:
        draw.text((ox + left, y), line, font=title_face, fill=(255, 255, 255, 255))
        y += line_title
    for line in body_lines:
        draw.text((ox + left, y), line, font=body_face, fill=(200, 200, 214, 255))
        y += line_body
    finish(card, args)


def draw_checklist(args):
    spec = spec_args(args)
    width = int(spec.get("width", args.width))
    title = spec.get("title", "SETUP").upper()
    items = spec.get("items", [])
    pad = max(14, width // 26)
    title_face = font(max(11, width // 34), bold=True)
    item_face = font(max(13, width // 26), bold=True)
    accent = hex_rgb(spec.get("accent", "#35E0FF"))

    line_h = int(item_face.size * 1.7)
    height = pad * 2 + int(title_face.size * 2) + line_h * len(items)

    card, (ox, oy) = gradient_card(
        width, height, 16, (20, 20, 32), (9, 9, 15), hex_rgb(spec.get("border", "#FF2D95"))
    )
    draw = ImageDraw.Draw(card)
    draw.text((ox + pad, oy + pad), " ".join(title), font=title_face, fill=accent)
    y = oy + pad + int(title_face.size * 2)
    for item in items:
        text = item.get("text", "")
        done = bool(item.get("done"))
        box = int(item_face.size * 0.9)
        draw.rounded_rectangle(
            [ox + pad, y + 2, ox + pad + box, y + 2 + box],
            radius=4,
            outline=(90, 90, 110, 255) if not done else accent,
            width=2,
        )
        if done:
            draw.line(
                [ox + pad + 4, y + 2 + box // 2, ox + pad + box // 2, y + box - 1, ox + pad + box - 2, y + 3],
                fill=accent,
                width=3,
            )
        draw.text(
            (ox + pad + box + 10, y),
            text,
            font=item_face,
            fill=(235, 235, 245, 255) if done else (140, 140, 158, 255),
        )
        y += line_h
    finish(card, args)


def draw_progress(args):
    spec = spec_args(args)
    width = int(spec.get("width", args.width))
    label = spec.get("label", "installing")
    frames = int(spec.get("frames", 5))
    accent = hex_rgb(spec.get("accent", "#35E0FF"))
    pad = max(12, width // 26)
    label_face = font(max(12, width // 28), bold=True)
    pct_face = font(max(12, width // 28), bold=True)
    bar_h = max(12, width // 26)
    height = pad * 2 + int(label_face.size * 1.6) + bar_h

    files = []
    for i in range(frames):
        pct = round((i + 1) / frames, 2)
        card, (ox, oy) = gradient_card(
            width, height, 14, (18, 18, 28), (8, 8, 14), hex_rgb(spec.get("border", "#FF2D95"))
        )
        draw = ImageDraw.Draw(card)
        draw.text((ox + pad, oy + pad), label.upper(), font=label_face, fill=(220, 220, 235, 255))
        draw.text(
            (ox + width - pad, oy + pad),
            f"{int(pct * 100)}%",
            font=pct_face,
            fill=accent,
            anchor="ra",
        )
        y = oy + pad + int(label_face.size * 1.6)
        draw.rounded_rectangle(
            [ox + pad, y, ox + width - pad, y + bar_h],
            radius=bar_h // 2,
            fill=(40, 40, 56, 255),
        )
        fill_w = int((width - pad * 2) * pct)
        if fill_w > 2:
            draw.rounded_rectangle(
                [ox + pad, y, ox + pad + fill_w, y + bar_h],
                radius=bar_h // 2,
                fill=accent,
            )
        file = f"{args.out}-{i}.png"
        card.save(file)
        files.append(file)
    print(json.dumps({"files": files, "canvas": {"w": width + 40, "h": height + 40}}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--kind",
        choices=[
            "toast", "bubble", "chat", "keycap", "command", "stamp",
            "stat", "chapter", "notification", "checklist", "progress",
        ],
        required=True,
    )
    parser.add_argument("--text", default="")
    parser.add_argument("--out", required=True)
    parser.add_argument("--label", default="")
    parser.add_argument("--icon", default="")
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--accent", default="#35E0FF")
    parser.add_argument("--border", default="#FF2D95")
    parser.add_argument("--side", choices=["left", "right"], default="left")
    parser.add_argument("--spec", default="")
    args = parser.parse_args()

    handlers = {
        "toast": draw_toast,
        "bubble": draw_bubble,
        "chat": draw_chat,
        "keycap": draw_keycap,
        "command": draw_command,
        "stamp": draw_stamp,
        "stat": draw_stat,
        "chapter": draw_chapter,
        "notification": draw_notification,
        "checklist": draw_checklist,
        "progress": draw_progress,
    }
    handlers[args.kind](args)


if __name__ == "__main__":
    main()

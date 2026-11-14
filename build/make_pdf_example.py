#!/usr/bin/env python3
"""Make data/examples/hearn-whitmore-2026/practice-pages.pdf: two pages laid out as a scanned paper would be, with
Figures 1b and 3c of the examples on them, for the walkthrough "A figure in a PDF".

The pages are pictures (as the pages of a scan are), at 200 dots per inch, with a little grey in the paper, and the
second turned by 0.7 degrees, as a page on a scanner often is. The text on them is ours: it says what the pages are
for, not what the paper says.

Run:  python3 build/make_pdf_example.py      (needs Pillow, and the DejaVu fonts if they are there)
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
EX = os.path.join(os.path.dirname(HERE), "data", "examples", "hearn-whitmore-2026")
DPI = 200
W, H = int(8.27 * DPI), int(11.69 * DPI)  # A4


def font(name, size):
    for d in ("/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu", "/Library/Fonts"):
        p = os.path.join(d, name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


SERIF = font("DejaVuSerif.ttf", 30)
BOLD = font("DejaVuSerif-Bold.ttf", 40)
SMALL = font("DejaVuSerif.ttf", 26)
ITALIC = font("DejaVuSerif-Italic.ttf", 26)


def paragraph(draw, text, x, y, width, f, gap=10):
    words, line = text.split(), ""
    for w in words:
        trial = (line + " " + w).strip()
        if draw.textlength(trial, font=f) > width and line:
            draw.text((x, y), line, font=f, fill=(30, 30, 30))
            y += f.size + gap
            line = w
        else:
            line = trial
    if line:
        draw.text((x, y), line, font=f, fill=(30, 30, 30))
        y += f.size + gap
    return y


def page(title, paras, figure, caption, number):
    img = Image.new("RGB", (W, H), (250, 249, 245))
    d = ImageDraw.Draw(img)
    m = int(0.9 * DPI)
    y = m
    if title:
        y = paragraph(d, title, m, y, W - 2 * m, BOLD, 14) + 30
    for p in paras[:1]:
        y = paragraph(d, p, m, y, W - 2 * m, SERIF) + 24
    fig = Image.open(os.path.join(EX, figure)).convert("RGB")
    # (the figure as printed: no wider than the text, centred)
    scale = min(1.0, (W - 2 * m) / fig.width)
    fig = fig.resize((int(fig.width * scale), int(fig.height * scale)), Image.LANCZOS)
    img.paste(fig, ((W - fig.width) // 2, y))
    y += fig.height + 20
    y = paragraph(d, caption, m, y, W - 2 * m, ITALIC) + 30
    for p in paras[1:]:
        y = paragraph(d, p, m, y, W - 2 * m, SERIF) + 24
    d.text((W // 2, H - m // 2), str(number), font=SMALL, fill=(60, 60, 60), anchor="mm")
    return img


def main():
    p1 = page(
        "Practice pages: two figures of Hearn and Whitmore (2026), laid out as a scanned paper would be",
        [
            "These pages are not the paper. They were made for the Digitiser workbench, to practise taking a figure "
            "out of a PDF: choose the page, draw it as a picture, crop it to the figure and digitise it. The figures "
            "are those of the examples, so what you read from them can be compared with the values they show.",
            "Each bar is the difference in the average number of births in one month, 1975-2015 against "
            "1955-1974, in per cent; the error bars are one bootstrap standard error. The values are in "
            "figure-1b.known.csv, beside the figure, among the examples.",
        ],
        "figure-1b.png",
        "Figure 1b. The percentage difference in average monthly births, 1975-2015 against 1955-1974.",
        1,
    )
    p2 = page(
        "",
        [
            "On this page the figure is a forest plot: a dot for each ten-year window, at the circular standard "
            "deviation of the peak phase of its births, with grey confidence intervals. The page was put on the "
            "scanner a little askew, as pages often are, so straighten the picture before you digitise it.",
            "The values are in figure-3c.known.csv, beside the figure, among the examples.",
        ],
        "figure-3c.png",
        "Figure 3c. The circular standard deviation of the peak phase, for each ten-year window.",
        2,
    )
    # the second page a little askew, and both slightly soft, as a scan is
    p2 = p2.rotate(0.7, resample=Image.BICUBIC, expand=False, fillcolor=(250, 249, 245))
    pages = [p.filter(ImageFilter.GaussianBlur(0.4)) for p in (p1, p2)]
    out = os.path.join(EX, "practice-pages.pdf")
    pages[0].save(out, "PDF", resolution=DPI, save_all=True, append_images=pages[1:], quality=88)
    print(out, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()

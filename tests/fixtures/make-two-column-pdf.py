"""Generates tests/fixtures/two-column.pdf, a small IEEE-style paper.

It contains every layout problem tests/pdf-layout.test.ts checks for: a large
title, two text columns, a sentence that runs from the bottom of the left column
to the top of the right one, words hyphenated across lines, numbered section
headings, a figure whose axis tick labels are loose text, a caption, a running
header, page numbers, and a numbered reference list.

    python3 tests/fixtures/make-two-column-pdf.py   (needs: pip install reportlab)
"""

from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = Path(__file__).with_name("two-column.pdf")
W, H = letter
MARGIN = 54
GUTTER = 18
COL_W = (W - 2 * MARGIN - GUTTER) / 2
LEFT, RIGHT = MARGIN, MARGIN + COL_W + GUTTER
BODY, LEADING = 10, 12


def chrome(c, page):
    c.setFont("Times-Italic", 8)
    c.drawString(MARGIN, H - 30, "PREPRINT - UNDER REVIEW AT A CONFERENCE")
    c.setFont("Times-Roman", 9)
    c.drawCentredString(W / 2, 30, str(page))


def lines(c, x, y, rows, font="Times-Roman", size=BODY):
    """Draws pre-broken lines; returns the y below the last one."""
    c.setFont(font, size)
    for row in rows:
        c.drawString(x, y, row)
        y -= LEADING
    return y


def heading(c, x, y, text, font="Times-Roman"):
    c.setFont(font, BODY)
    c.drawCentredString(x + COL_W / 2, y, text)
    return y - LEADING - 4


c = canvas.Canvas(str(OUT), pagesize=letter)
c.setTitle("")  # no metadata title: it has to be read from the page

# ---------- Page 1 ----------
chrome(c, 1)
c.setFont("Times-Bold", 20)
c.drawCentredString(W / 2, H - 80, "Counting Drones with Two LiDARs")
c.setFont("Times-Roman", 11)
c.drawCentredString(W / 2, H - 100, "Ada Example and Ben Sample")

top = H - 140
y = top
y = lines(c, LEFT, y, [
    "Abstract—We present a dataset for counting drones",
    "with two LiDAR sensors. Both sensors were calibrated",
    "against a motion capture system before recording.",
], font="Times-Bold", size=9)
y -= 8
y = heading(c, LEFT, y, "I. INTRODUCTION")
y = lines(c, LEFT, y, [
    "Small drones are hard to see in sparse point clouds.",
    "Our rig mounts a spinning sensor and a solid-state",
    "sensor side by side. The extrinsic cali-",
    "bration between them was estimated with GICP on",
    "ten stacked frames. This paragraph continues into",
    "the next column because the column ends here and",
])
y -= 6
# Figure: a box with loose axis tick labels, then its caption.
c.rect(LEFT + 20, 200, COL_W - 40, 120)
c.setFont("Helvetica", 6)
for i, tick in enumerate(["0", "10", "20", "30"]):
    c.drawString(LEFT + 20 + i * 60, 190, tick)
for i, tick in enumerate(["0.0", "0.5", "1.0"]):
    c.drawString(LEFT + 6, 200 + i * 55, tick)
c.setFont("Times-Roman", 8)
c.drawString(LEFT, 170, "Fig. 1: Tracking error of both sensors over time.")

y = top
y = lines(c, RIGHT, y, [
    "the sentence finishes at the top of the right one.",
    "Each recording lasts about two minutes.",
])
y -= 6
y = heading(c, RIGHT, y, "A. Sensor Setup", font="Times-Italic")
y = lines(c, RIGHT, y, [
    "The spinning sensor has 64 channels and a range of",
    "120 m. The solid-state sensor reaches 450 m with a",
    "narrower field of view. Data were stored as rosbag",
    "files with hardware time synchronization.",
])

c.showPage()

# ---------- Page 2 ----------
chrome(c, 2)
y = H - 80
y = heading(c, LEFT, y, "II. RESULTS")
y = lines(c, LEFT, y, [
    "The solid-state sensor tracked the drone in 100%",
    "of the sequences, the spinning sensor in 62%. Dense",
    "point clouds matter more than range for small targets.",
])
y -= 6
y = heading(c, LEFT, y, "REFERENCES")
c.setFont("Times-Roman", 8)
refs = [
    "[1] A. Example, “A survey of drone detection,” Journal of",
    "     Examples, vol. 1, pp. 1–10, 2021.",
    "[2] B. Sample and C. Person, “Point cloud tracking,” in",
    "     Proc. Conference on Samples, 2022.",
]
for row in refs:
    c.drawString(LEFT, y, row)
    y -= 10

c.showPage()
c.save()
print(f"wrote {OUT}")

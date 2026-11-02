"""
make_deck.py - build deck/Adaptive_NAT_Review.pptx (the review slides) from demo/data.js.

Runs tools/make_deck_assets.py (charts + deck/slides.json) and lays the slides out
with python-pptx. Screenshots of the live demo come from `node tools/deck_shots.mjs`.

Run from the repository root:  python tools/make_deck.py
"""
import json
import os
import runpy

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Pt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
runpy.run_path(os.path.join(ROOT, "tools", "make_deck_assets.py"), run_name="__main__")
with open(os.path.join(ROOT, "deck", "slides.json"), encoding="utf-8") as fh:
    SPEC = json.load(fh)
ASSETS = SPEC["assets"]
OUT = os.path.join(ROOT, "deck", "Adaptive_NAT_Review.pptx")

C = lambda h: RGBColor.from_string(h.lstrip("#"))  # noqa: E731
INK, INK2, MUTED, OURS, OURS_INK = C("#0b0b0b"), C("#44433f"), C("#6b6963"), C("#2a78d6"), C("#1c5cab")
ICE, ICE_INK, CARD, WHITE, GRID = C("#eb6834"), C("#b5461a"), C("#f1f0ec"), C("#ffffff"), C("#e1e0d9")
FONT = "Segoe UI"
W, H, L = 960, 540, 54


def txt(slide, text, l, t, w, h, size, color, bold=False, align=PP_ALIGN.LEFT):
    tb = slide.shapes.add_textbox(Pt(l), Pt(t), Pt(w), Pt(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    for i, line in enumerate(str(text).split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        r = p.add_run()
        r.text = line
        r.font.name, r.font.size, r.font.bold = FONT, Pt(size), bold
        r.font.color.rgb = color
    return tb


def bullets(slide, items, l, t, w, h, size=15):
    tb = txt(slide, "\n".join(items), l, t, w, h, size, INK2)
    for p in tb.text_frame.paragraphs:
        p.space_after = Pt(5)
        pPr = p._p.get_or_add_pPr()
        pPr.set("marL", str(Pt(16)))
        pPr.set("indent", str(-Pt(16)))
        clr = etree.SubElement(pPr, qn("a:buClr"))
        etree.SubElement(clr, qn("a:srgbClr")).set("val", "2A78D6")
        etree.SubElement(pPr, qn("a:buChar")).set("char", "•")
    return tb


def box(slide, l, t, w, h, fill, shape=MSO_SHAPE.ROUNDED_RECTANGLE):
    s = slide.shapes.add_shape(shape, Pt(l), Pt(t), Pt(w), Pt(h))
    s.fill.solid()
    s.fill.fore_color.rgb = fill
    s.line.fill.background()
    s.shadow.inherit = False
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        s.adjustments[0] = 0.06
    return s


def line(slide, x1, y1, x2, y2, color=OURS, width=3):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Pt(x1), Pt(y1), Pt(x2), Pt(y2))
    c.line.color.rgb = color
    c.line.width = Pt(width)


def pic(slide, name, l, t, max_w, max_h):
    path = os.path.join(ASSETS, name)
    iw, ih = Image.open(path).size
    w = min(max_w, max_h * iw / ih)
    h = w * ih / iw
    slide.shapes.add_picture(path, Pt(l + (max_w - w) / 2), Pt(t), Pt(w), Pt(h))


def head(slide, sd, n):
    if sd.get("kicker"):
        txt(slide, sd["kicker"].upper(), L, 26, W - 2 * L, 18, 11, MUTED, True)
    txt(slide, sd["title"], L, 44, W - 2 * L, 40, 28, INK, True)
    line(slide, L, 88, L + 56, 88)
    txt(slide, str(n), W - L - 40, H - 26, 40, 14, 10, MUTED, align=PP_ALIGN.RIGHT)


def foot(slide, text):
    if text:
        txt(slide, text, L, H - 64, W - 2 * L - 50, 38, 11, MUTED)


def table(slide, tb, l, t, w, size=12):
    nr, nc = len(tb["rows"]) + 1, len(tb["head"])
    gf = slide.shapes.add_table(nr, nc, Pt(l), Pt(t), Pt(w), Pt(20 * nr))
    tbl = gf.table
    gf._element.graphic.graphicData.tbl.tblPr.find(qn("a:tableStyleId")).text = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"
    tbl.first_row = tbl.horz_banding = False
    for r in range(nr):
        tbl.rows[r].height = Pt(19)
        for c in range(nc):
            cell = tbl.cell(r, c)
            v = tb["head"][c] if r == 0 else tb["rows"][r - 1][c]
            cell.margin_left = cell.margin_right = Pt(5)
            cell.margin_top = cell.margin_bottom = Pt(3)
            tf = cell.text_frame
            p = tf.paragraphs[0]
            p.alignment = PP_ALIGN.LEFT if c == 0 else PP_ALIGN.RIGHT
            run = p.add_run()
            run.text = str(v)
            run.font.name, run.font.size, run.font.bold = FONT, Pt(size), (r == 0 or c == 0)
            run.font.color.rgb = MUTED if r == 0 else INK
            tcPr = cell._tc.get_or_add_tcPr()
            lnB = etree.Element(qn("a:lnB"), w=str(Pt(0.75)))
            etree.SubElement(etree.SubElement(lnB, qn("a:solidFill")), qn("a:srgbClr")).set("val", "E1E0D9")
            tcPr.insert(0, lnB)
            cell.fill.solid()
            cell.fill.fore_color.rgb = CARD if r == 0 else WHITE
    return gf


prs = Presentation()
prs.slide_width, prs.slide_height = Pt(W), Pt(H)
blank = prs.slide_layouts[6]
for n, sd in enumerate(SPEC["slides"], 1):
    s = prs.slides.add_slide(blank)
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = WHITE
    lay = sd["layout"]
    if lay in ("title", "end"):
        box(s, 0, 0, 14, H, OURS, MSO_SHAPE.RECTANGLE)
        y = 150 if lay == "title" else 175
        txt(s, sd["title"], L, y, W - 2 * L, 60, 44, INK, True)
        txt(s, sd["subtitle"], L, y + 62, W - 2 * L, 36, 24, INK2)
        line(s, L, y + 112, L + 80, y + 112)
        for i, ln in enumerate(sd["lines"]):
            txt(s, ln, L, y + 130 + 28 * i, W - 2 * L, 24, 16, INK2)
        if lay == "title":
            box(s, L, H - 53, 12, 12, OURS, MSO_SHAPE.RECTANGLE)
            txt(s, "Our agent", L + 18, H - 56, 120, 16, 12, INK2)
            box(s, L + 110, H - 53, 12, 12, ICE, MSO_SHAPE.RECTANGLE)
            txt(s, "Standard ICE baseline", L + 128, H - 56, 200, 16, 12, INK2)
    elif lay == "stats":
        head(s, sd, n)
        k, gap = len(sd["stats"]), 14
        tw = (W - 2 * L - (k - 1) * gap) / k
        for i, st in enumerate(sd["stats"]):
            x, y = L + i * (tw + gap), 112
            box(s, x, y, tw, 250, CARD)
            txt(s, st["label"], x + 14, y + 14, tw - 28, 44, 13, INK2, True)
            txt(s, "Ours", x + 14, y + 80, tw - 28, 16, 12, OURS_INK, True)
            txt(s, st["ours"], x + 14, y + 96, tw - 28, 56, 40, OURS, True)
            txt(s, st["iceName"], x + 14, y + 172, tw - 28, 16, 12, ICE_INK, True)
            txt(s, st["ice"], x + 14, y + 188, tw - 28, 36, 24, ICE_INK, True)
        txt(s, sd["foot"], L, 384, W - 2 * L, 60, 13, MUTED)
        txt(s, "All values measured. ICE = ICE-style baseline in simulation, the aioice library on real routers; "
               "“blocks” = port-block detection.", L, 452, W - 2 * L, 20, 11, MUTED)
    elif lay == "image":
        head(s, sd, n)
        pic(s, sd["image"], L, 100, W - 2 * L, 300)
        bullets(s, sd["bullets"], L, 414, W - 2 * L, 100, 15)
    elif lay == "cards":
        head(s, sd, n)
        y = 104
        if sd.get("formula"):
            txt(s, sd["formula"], L, 100, W - 2 * L, 40, 26, INK, True, PP_ALIGN.CENTER)
            y = 152
        k = len(sd["cards"])
        cols = sd.get("cols", k)
        rows, gap = -(-k // cols), 14
        cw = (W - 2 * L - (cols - 1) * gap) / cols
        ch = ((390 if sd.get("bullets") else 470) - y - (rows - 1) * gap) / rows
        for i, cd in enumerate(sd["cards"]):
            x, cy = L + (i % cols) * (cw + gap), y + (i // cols) * (ch + gap)
            box(s, x, cy, cw, ch, CARD)
            txt(s, cd["head"], x + 14, cy + 12, cw - 28, 22, 15 if rows > 1 else 17, C(cd["color"]) if cd.get("color") else INK, True)
            txt(s, cd["body"], x + 14, cy + 42, cw - 28, ch - 52, 13 if rows > 1 else 14, INK2)
        if sd.get("bullets"):
            bullets(s, sd["bullets"], L, 404, W - 2 * L, 100, 13)
    elif lay == "chart":
        head(s, sd, n)
        pic(s, sd["image"], L, 100, W - 2 * L, 340)
        foot(s, sd["foot"])
    elif lay == "chart_table":
        head(s, sd, n)
        pic(s, sd["image"], L - 10, 104, 420, 330)
        table(s, sd["table"], 480, 110, W - 480 - L, 12)
        foot(s, sd["foot"])
    elif lay == "two_col":
        head(s, sd, n)
        cw = (W - 2 * L - 20) / 2
        for col, x in ((sd["left"], L), (sd["right"], L + cw + 20)):
            box(s, x, 108, cw, 370, CARD)
            txt(s, col["head"], x + 16, 122, cw - 32, 24, 18, INK, True)
            bullets(s, col["items"], x + 16, 158, cw - 32, 310, 15)
    if sd.get("notes"):
        s.notes_slide.notes_text_frame.text = sd["notes"]

prs.save(OUT)
print(f"wrote {os.path.relpath(OUT, ROOT)} ({len(prs.slides)} slides)")

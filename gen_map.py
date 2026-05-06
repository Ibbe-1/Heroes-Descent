"""
Top-down dungeon temple map generator — 1920×1080
Theme: Ancient Dungeon Temple
"""

from PIL import Image, ImageDraw, ImageFilter
import random, math

random.seed(42)
W, H = 1920, 1080

# ── Palette ─────────────────────────────────────────────────────────────────
WALL         = (28, 21, 14)
STONE        = (106, 96, 80)
STONE_DARK   = (72, 65, 53)
STONE_PALE   = (148, 134, 114)
LAVA_CORE    = (252, 52, 2)
LAVA_MID     = (208, 100, 8)
LAVA_GLOW    = (255, 78, 18)
WATER_DEEP   = (16, 44, 132)
WATER_MID    = (32, 82, 180)
WATER_LIGHT  = (72, 138, 228)
PIT_DARK     = (8, 5, 3)
GRASS_BASE   = (42, 80, 26)
GRASS_LIGHT  = (64, 110, 42)
VINE_CLR     = (26, 54, 16)
ROCK_DARK    = (65, 58, 48)
ROCK_LIGHT   = (95, 87, 72)
MACH_GREY    = (66, 76, 86)
MACH_DARK    = (40, 48, 56)
PIPE_CLR     = (86, 98, 108)
PIPE_DARK    = (52, 62, 70)
CONSOLE_CLR  = (20, 30, 40)
LIGHT_WARM   = (255, 226, 128)
LIGHT_COOL   = (118, 162, 255)
RUNE_BLUE    = (68, 148, 252)
RUNE_TEAL    = (32, 208, 188)
RUNE_PURPLE  = (156, 76, 252)
GOLD         = (192, 158, 42)
GOLD_DARK    = (126, 96, 18)
CRIMSON      = (172, 16, 16)
CRIMSON_MID  = (218, 42, 32)
WOOD         = (92, 56, 20)
WOOD_LIGHT   = (124, 78, 32)

# ── Room floor areas (inner bounds) ─────────────────────────────────────────
rooms = {
    'entrance': (50,  50,  430, 350),
    'lava':     (480, 50,  860, 350),
    'water':    (910, 50,  1290,350),
    'archive':  (1340,50,  1870,350),
    'garden':   (50,  400, 430, 700),
    'machines': (480, 400, 1290,700),
    'armory':   (1340,400, 1870,700),
    'boss':     (50,  750, 860, 1030),
    'vault':    (910, 750, 1290,1030),
    'exit':     (1340,750, 1870,1030),
}

# ── Corridors (in the 50px wall gaps between rooms) ─────────────────────────
corridors = [
    # top row — horizontal
    (430, 178, 480, 222),
    (860, 178, 910, 222),
    (1290,178, 1340,222),
    # col-1 — vertical
    (215, 350, 265, 400),
    (215, 700, 265, 750),
    # col-2/machines — vertical
    (645, 350, 695, 400),
    (645, 700, 695, 750),
    # col-3/machines — vertical
    (1075,350, 1125,400),
    (1075,700, 1125,750),
    # col-4 — vertical
    (1578,350, 1632,400),
    (1578,700, 1632,750),
    # bottom row — horizontal
    (860, 866, 910, 914),
    (1290,866, 1340,914),
]

floor_colors = {
    'entrance': STONE,
    'lava':     STONE_DARK,
    'water':    STONE,
    'archive':  STONE_PALE,
    'garden':   GRASS_BASE,
    'machines': MACH_GREY,
    'armory':   STONE_DARK,
    'boss':     STONE_DARK,
    'vault':    STONE_PALE,
    'exit':     STONE,
}

# ── Helpers ──────────────────────────────────────────────────────────────────
def glow(d, cx, cy, radius, inner, base, steps=6):
    for i in range(steps, 0, -1):
        r = max(1, int(radius * i / steps))
        t = i / steps
        c = tuple(int(base[j]*t + inner[j]*(1-t)) for j in range(3))
        d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=c)
    d.ellipse([cx-3, cy-3, cx+3, cy+3], fill=inner)

def tile_floor(d, x1, y1, x2, y2, base, ts):
    tc = tuple(max(0, c-20) for c in base)
    for x in range(x1, x2, ts):
        d.line([(x, y1), (x, y2)], fill=tc, width=1)
    for y in range(y1, y2, ts):
        d.line([(x1, y), (x2, y)], fill=tc, width=1)

def blend(c1, c2, t):
    return tuple(int(c1[j]*(1-t) + c2[j]*t) for j in range(3))

# ── Canvas ───────────────────────────────────────────────────────────────────
img = Image.new('RGB', (W, H), WALL)
draw = ImageDraw.Draw(img)

# ── Add subtle noise/texture to wall background ───────────────────────────────
for _ in range(8000):
    wx = random.randint(0, W-1)
    wy = random.randint(0, H-1)
    v = random.randint(18, 40)
    img.putpixel((wx, wy), (v, int(v*0.85), int(v*0.65)))

draw = ImageDraw.Draw(img)

# ── 1. Room floors ───────────────────────────────────────────────────────────
for name, (x1, y1, x2, y2) in rooms.items():
    draw.rectangle([x1, y1, x2, y2], fill=floor_colors[name])

# ── 2. Tile grids ────────────────────────────────────────────────────────────
tile_sz = {
    'entrance':44, 'lava':36, 'water':34, 'archive':28,
    'garden':0,    'machines':24, 'armory':36,
    'boss':48,     'vault':26,  'exit':36,
}
for name, (x1, y1, x2, y2) in rooms.items():
    ts = tile_sz[name]
    if ts:
        tile_floor(draw, x1, y1, x2, y2, floor_colors[name], ts)

# ── 3. Corridors ─────────────────────────────────────────────────────────────
for cx1, cy1, cx2, cy2 in corridors:
    draw.rectangle([cx1, cy1, cx2, cy2], fill=STONE_DARK)
    tile_floor(draw, cx1, cy1, cx2, cy2, STONE_DARK, 22)

# ═══════════════════════════════════════════════════════════════════════════
#  ROOM DECORATIONS
# ═══════════════════════════════════════════════════════════════════════════

# ── ROOM 1: ENTRANCE HALL ────────────────────────────────────────────────────
x1, y1, x2, y2 = rooms['entrance']
cx, cy = (x1+x2)//2, (y1+y2)//2

# Ornate floor medallion
for i, r in enumerate(range(115, 5, -22)):
    col = GOLD_DARK if i % 2 == 0 else STONE_DARK
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], outline=col, width=2)
# Radial spokes
for ang in range(0, 360, 30):
    rad = math.radians(ang)
    ex = int(cx + 108 * math.cos(rad))
    ey = int(cy + 108 * math.sin(rad))
    draw.line([(cx, cy), (ex, ey)], fill=GOLD_DARK, width=1)
draw.ellipse([cx-14, cy-14, cx+14, cy+14], fill=GOLD, outline=GOLD_DARK, width=2)

# 4 pillars
for px, py in [(x1+55,y1+55),(x2-55,y1+55),(x1+55,y2-55),(x2-55,y2-55)]:
    glow(draw, px, py, 32, LIGHT_WARM, STONE)
    draw.ellipse([px-18, py-18, px+18, py+18], fill=STONE_PALE, outline=STONE_DARK, width=2)
    draw.ellipse([px-10, py-10, px+10, py+10], fill=ROCK_DARK)

# Wall torches (both sides)
for tx, ty in [(x1+18,cy-50),(x1+18,cy+50),(x2-18,cy-50),(x2-18,cy+50)]:
    glow(draw, tx, ty, 30, LIGHT_WARM, STONE, steps=7)
    draw.rectangle([tx-3, ty-8, tx+3, ty+8], fill=ROCK_DARK)
    draw.ellipse([tx-4, ty-13, tx+4, ty-5], fill=LIGHT_WARM)

# Entry steps (leading toward corridor)
for i in range(4):
    shade = blend(STONE_DARK, STONE_PALE, i/4)
    draw.rectangle([x2-12-i*6, cy-25+i*2, x2+i*3, cy+25-i*2], fill=shade)

# ── ROOM 2: LAVA CAVERN ──────────────────────────────────────────────────────
x1, y1, x2, y2 = rooms['lava']

# Lava pool (inaccessible — nearly fills room)
lx1, ly1, lx2, ly2 = x1+48, y1+42, x2-48, y2-42

# Heat glow spreading onto walkable floor
for step in range(6, 0, -1):
    gx1 = max(x1, lx1-step*12); gy1 = max(y1, ly1-step*10)
    gx2 = min(x2, lx2+step*12); gy2 = min(y2, ly2+step*10)
    t = step / 7
    gc = blend(LAVA_MID, STONE_DARK, t + 0.55)
    draw.rectangle([gx1, gy1, gx2, gy2], fill=gc)

# Lava base
draw.rectangle([lx1, ly1, lx2, ly2], fill=LAVA_CORE)

# Lava surface blobs
for bx, by, bw, bh in [
    ((lx1+lx2)//2-25, (ly1+ly2)//2, 90, 45),
    ((lx1+lx2)//2+45, (ly1+ly2)//2-18, 65, 32),
    (lx1+65, (ly1+ly2)//2+12, 55, 28),
]:
    draw.ellipse([bx-bw, by-bh, bx+bw, by+bh], fill=LAVA_MID)

# Hotspots
for _ in range(14):
    hx = random.randint(lx1+12, lx2-12)
    hy = random.randint(ly1+12, ly2-12)
    draw.ellipse([hx-9, hy-6, hx+9, hy+6], fill=LAVA_GLOW)
    draw.ellipse([hx-4, hy-3, hx+4, hy+3], fill=(255, 218, 118))

# Rocks on narrow lava ledge
for _ in range(20):
    side = random.randint(0, 3)
    if side == 0:   rx, ry = random.randint(lx1, lx2), random.randint(ly1-14, ly1+2)
    elif side == 1: rx, ry = random.randint(lx1, lx2), random.randint(ly2-2, ly2+14)
    elif side == 2: rx, ry = random.randint(lx1-14, lx1+2), random.randint(ly1, ly2)
    else:           rx, ry = random.randint(lx2-2, lx2+14), random.randint(ly1, ly2)
    rw = random.randint(5, 13); rh = random.randint(4, 9)
    draw.ellipse([rx-rw, ry-rh, rx+rw, ry+rh], fill=ROCK_DARK, outline=ROCK_LIGHT, width=1)

# Floor cracks on walkable ledges
for _ in range(14):
    cx_ = random.choice([random.randint(x1+5, lx1-8), random.randint(lx2+8, x2-5)])
    cy_ = random.randint(y1+5, y2-5)
    l = random.randint(14, 38)
    ang = random.uniform(0, 2*math.pi)
    draw.line([(cx_, cy_), (int(cx_+l*math.cos(ang)), int(cy_+l*math.sin(ang)))], fill=WALL, width=1)

# ── ROOM 3: WATER CANAL ──────────────────────────────────────────────────────
x1, y1, x2, y2 = rooms['water']
wcy = (y1+y2)//2
canal_h = 58

# Canal stone banks
draw.rectangle([x1+28, wcy-canal_h-9, x2-28, wcy+canal_h+9], fill=ROCK_DARK)
# Water
draw.rectangle([x1+28, wcy-canal_h, x2-28, wcy+canal_h], fill=WATER_DEEP)

# Water shimmer stripes
for i in range(9):
    wx = x1 + 55 + i * ((x2-x1-90)//9)
    draw.line([(wx, wcy-14), (wx+22, wcy+6)], fill=WATER_LIGHT, width=1)
draw.rectangle([x1+32, wcy-4, x2-32, wcy+4], fill=WATER_MID)

# Underwater glows
for _ in range(6):
    ux = random.randint(x1+35, x2-35)
    uy = wcy + random.randint(-canal_h+12, canal_h-12)
    glow(draw, ux, uy, 16, WATER_LIGHT, WATER_DEEP, steps=4)

# Two stone bridges
for bx_start in [x1+95, x1+255]:
    bx2 = bx_start + 58
    draw.rectangle([bx_start, wcy-canal_h-7, bx2, wcy+canal_h+7], fill=STONE_PALE)
    draw.line([(bx_start, wcy-canal_h-7), (bx2, wcy-canal_h-7)], fill=STONE_DARK, width=3)
    draw.line([(bx_start, wcy+canal_h+7), (bx2, wcy+canal_h+7)], fill=STONE_DARK, width=3)
    for bpy in range(wcy-canal_h-4, wcy+canal_h+4, 11):
        draw.line([(bx_start+3, bpy), (bx2-3, bpy)], fill=STONE_DARK, width=1)

# Top-wall rune alcoves
for ax in [x1+72, x1+188, x1+305]:
    draw.rectangle([ax, y1+6, ax+40, y1+34], fill=STONE_DARK)
    draw.ellipse([ax+10, y1+7, ax+30, y1+28], fill=RUNE_BLUE)
    glow(draw, ax+20, y1+17, 14, RUNE_BLUE, STONE, steps=4)

# ── ROOM 4: ARCHIVE / LIBRARY ────────────────────────────────────────────────
x1, y1, x2, y2 = rooms['archive']
tcx, tcy = (x1+x2)//2, (y1+y2)//2

# Left bookshelf
draw.rectangle([x1+5, y1+18, x1+42, y2-18], fill=WOOD)
for by in range(y1+22, y2-18, 12):
    bc = random.choice([(172,36,36),(36,72,162),(36,132,56),(132,108,36),(116,48,148)])
    draw.rectangle([x1+7, by, x1+40, by+9], fill=bc)
    draw.line([(x1+5, by), (x1+42, by)], fill=WOOD_LIGHT, width=1)

# Right bookshelf
draw.rectangle([x2-42, y1+18, x2-5, y2-18], fill=WOOD)
for by in range(y1+22, y2-18, 12):
    bc = random.choice([(172,36,36),(36,72,162),(36,132,56),(132,108,36)])
    draw.rectangle([x2-40, by, x2-7, by+9], fill=bc)

# Top shelf
draw.rectangle([x1+48, y1+4, x2-48, y1+44], fill=WOOD)
for bx in range(x1+52, x2-52, 15):
    bc = random.choice([(172,36,36),(36,72,162),(36,132,56),(132,108,36)])
    draw.rectangle([bx, y1+6, bx+12, y1+42], fill=bc)

# Reading table
draw.rectangle([tcx-92, tcy-58, tcx+92, tcy+58], fill=WOOD_LIGHT, outline=WOOD, width=2)
draw.rectangle([tcx-88, tcy-54, tcx+88, tcy+54], fill=WOOD)
# Open book
draw.rectangle([tcx-46, tcy-24, tcx+46, tcy+24], fill=(226, 210, 180))
draw.line([(tcx, tcy-24), (tcx, tcy+24)], fill=ROCK_DARK, width=2)
for ly in range(tcy-18, tcy+18, 5):
    draw.line([(tcx+4, ly), (tcx+42, ly)], fill=(118,96,68), width=1)
    draw.line([(tcx-42, ly), (tcx-4, ly)], fill=(118,96,68), width=1)

# Candles on table
for cx_, cy_ in [(tcx-72, tcy-8), (tcx+72, tcy-8), (tcx-72, tcy+8), (tcx+72, tcy+8)]:
    glow(draw, cx_, cy_, 24, LIGHT_WARM, STONE_PALE, steps=6)
    draw.rectangle([cx_-2, cy_-10, cx_+2, cy_+6], fill=(212,188,146))
    draw.ellipse([cx_-4, cy_-15, cx_+4, cy_-8], fill=LIGHT_WARM)

# Floor rune circles
for rx_, ry_ in [(x1+78, y2-68), (x2-98, y2-68), (x1+78, y1+68), (x2-98, y1+68)]:
    draw.ellipse([rx_-30, ry_-30, rx_+30, ry_+30], outline=RUNE_PURPLE, width=2)
    draw.ellipse([rx_-16, ry_-16, rx_+16, ry_+16], outline=RUNE_BLUE, width=1)
    draw.ellipse([rx_-5,  ry_-5,  rx_+5,  ry_+5], fill=RUNE_PURPLE)

# ── ROOM 5: GARDEN / NATURE ──────────────────────────────────────────────────
x1, y1, x2, y2 = rooms['garden']

# Dirt paths
draw.rectangle([x1+108, y1, x1+162, y2], fill=(85, 65, 40))
draw.rectangle([x1, y1+118, x2, y1+172], fill=(85, 65, 40))

# Grass tufts
for _ in range(65):
    gx = random.randint(x1+5, x2-5)
    gy = random.randint(y1+5, y2-5)
    if x1+103 <= gx <= x1+167 or y1+113 <= gy <= y1+177:
        continue
    draw.line([(gx, gy), (gx+random.randint(-5,5), gy-random.randint(6,15))], fill=GRASS_LIGHT, width=1)

# Rocks
for rx_, ry_ in [(x1+38,y1+58),(x2-46,y1+48),(x1+48,y2-52),(x2-38,y2-44),(x1+28,y1+185),(x2-34,y1+222)]:
    rw = random.randint(10, 20); rh = random.randint(7, 14)
    draw.ellipse([rx_-rw, ry_-rh, rx_+rw, ry_+rh], fill=ROCK_LIGHT, outline=ROCK_DARK, width=1)

# 4 trees (corner circles)
for tx, ty, tr in [(x1+54,y1+54,30),(x2-56,y1+56,26),(x1+54,y2-56,28),(x2-50,y2-50,30)]:
    for r in range(tr, 7, -5):
        t = (tr - r) / tr
        gc = blend(GRASS_BASE, VINE_CLR, t * 0.5)
        draw.ellipse([tx-r, ty-r, tx+r, ty+r], fill=gc)
    draw.ellipse([tx-8, ty-8, tx+8, ty+8], fill=(55, 36, 15))

# Small pond
pond_cx, pond_cy = x1+205, y1+225
draw.ellipse([pond_cx-40, pond_cy-24, pond_cx+40, pond_cy+24], fill=WATER_DEEP, outline=ROCK_DARK, width=2)
draw.ellipse([pond_cx-32, pond_cy-17, pond_cx+32, pond_cy+17], fill=WATER_MID)
glow(draw, pond_cx, pond_cy, 10, WATER_LIGHT, WATER_MID, steps=3)

# Vine dots on walls
for vy in range(y1+25, y2-25, 28):
    draw.ellipse([x1+3, vy-5, x1+12, vy+5], fill=VINE_CLR)
    draw.ellipse([x2-12, vy-5, x2-3, vy+5], fill=VINE_CLR)

# ── ROOM 6: MACHINES / WORKSHOP ──────────────────────────────────────────────
x1, y1, x2, y2 = rooms['machines']

# 4 generator units in corners
for gx, gy in [(x1+22,y1+22),(x2-102,y1+22),(x1+22,y2-102),(x2-102,y2-102)]:
    draw.rectangle([gx, gy, gx+80, gy+80], fill=MACH_DARK, outline=PIPE_CLR, width=2)
    draw.rectangle([gx+8, gy+8, gx+72, gy+72], fill=CONSOLE_CLR)
    draw.ellipse([gx+22, gy+22, gx+58, gy+58], fill=(28,158,28), outline=PIPE_CLR, width=1)
    draw.ellipse([gx+32, gy+32, gx+48, gy+48], fill=(18,218,48))
    for sv in range(3):
        draw.rectangle([gx+10+sv*22, gy+2, gx+24+sv*22, gy+7], fill=PIPE_CLR)

# Pipe network
mcx, mcy = (x1+x2)//2, (y1+y2)//2
pipe_routes = [
    ((x1+108, y1+62), (x2-108, y1+62)),
    ((x1+108, y2-62), (x2-108, y2-62)),
    ((x1+108, y1+62), (x1+108, y2-62)),
    ((x2-108, y1+62), (x2-108, y2-62)),
    ((mcx, y1+62),    (mcx, y2-62)),
    ((x1+108, mcy),   (x2-108, mcy)),
]
for (px1,py1),(px2,py2) in pipe_routes:
    draw.line([(px1,py1),(px2,py2)], fill=PIPE_CLR, width=10)
    draw.line([(px1,py1),(px2,py2)], fill=PIPE_DARK, width=4)
    jx, jy = (px1+px2)//2, (py1+py2)//2
    draw.rectangle([jx-6,jy-6,jx+6,jy+6], fill=PIPE_CLR, outline=PIPE_DARK, width=1)

# Control consoles
for cx_, cy_ in [(mcx-85,y1+148),(mcx+85,y1+148),(mcx-85,y2-148),(mcx+85,y2-148),(mcx,mcy)]:
    draw.rectangle([cx_-34,cy_-24,cx_+34,cy_+24], fill=CONSOLE_CLR, outline=PIPE_CLR, width=1)
    for bj in range(-2, 3):
        bc = random.choice([(178,26,26),(26,165,26),(198,172,22),(26,92,198)])
        draw.ellipse([cx_+bj*10-4,cy_-16,cx_+bj*10+4,cy_-7], fill=bc)
    draw.rectangle([cx_-24,cy_-2,cx_+24,cy_+16], fill=(28,72,28))
    draw.line([(cx_-20,cy_+5),(cx_+20,cy_+5)], fill=(48,198,48), width=1)
    draw.line([(cx_-20,cy_+11),(cx_+8,cy_+11)], fill=(48,198,48), width=1)

# Blue glow lights on pipes
for lx,ly in [(x1+108,mcy),(x2-108,mcy),(mcx,y1+62),(mcx,y2-62)]:
    glow(draw, lx, ly, 20, LIGHT_COOL, MACH_GREY, steps=5)

# ── ROOM 7: ARMORY ───────────────────────────────────────────────────────────
x1, y1, x2, y2 = rooms['armory']
acx, acy = (x1+x2)//2, (y1+y2)//2

# Weapon racks — both side walls
for rack_x in [x1+6, x2-46]:
    draw.rectangle([rack_x, y1+22, rack_x+40, y2-22], fill=WOOD, outline=ROCK_DARK)
    for wy in range(y1+32, y2-22, 30):
        draw.line([(rack_x+4,wy),(rack_x+36,wy)], fill=ROCK_LIGHT, width=2)
        wx_ = rack_x+20
        draw.line([(wx_, wy-13),(wx_, wy+13)], fill=(152,155,168), width=2)
        draw.polygon([(wx_-5,wy-13),(wx_+5,wy-13),(wx_,wy-22)], fill=(152,155,168))
        draw.line([(wx_-8,wy-5),(wx_+8,wy-5)], fill=GOLD, width=2)

# Shield display — top wall
draw.rectangle([x1+52, y1+4, x2-52, y1+50], fill=WOOD)
for sx in range(x1+80, x2-60, 68):
    draw.ellipse([sx-24, y1+7, sx+24, y1+47], fill=(85,65,28), outline=GOLD, width=2)
    draw.ellipse([sx-15, y1+13, sx+15, y1+41], fill=CRIMSON)
    draw.line([(sx, y1+7),(sx, y1+47)], fill=GOLD, width=1)
    draw.line([(sx-24, y1+27),(sx+24, y1+27)], fill=GOLD, width=1)

# Central armor stand
draw.rectangle([acx-24, acy-58, acx+24, acy+62], fill=MACH_GREY, outline=GOLD, width=1)
draw.ellipse([acx-22, acy-80, acx+22, acy-40], fill=MACH_GREY, outline=GOLD, width=1)
draw.rectangle([acx-30, acy-8, acx+30, acy+22], fill=STONE_DARK, outline=GOLD)

# Glowing rune pedestal beneath armor
for r in range(44, 4, -8):
    t = (44-r)/44
    rc = blend(STONE_DARK, RUNE_TEAL, t)
    draw.ellipse([acx-r, acy+68-r, acx+r, acy+68+r], fill=rc)
draw.ellipse([acx-8, acy+60, acx+8, acy+76], fill=RUNE_TEAL)

# Wall torches
for tx, ty in [(x1+28,y1+28),(x2-28,y1+28),(x1+28,y2-28),(x2-28,y2-28)]:
    glow(draw, tx, ty, 30, LIGHT_WARM, STONE_DARK, steps=7)
    draw.rectangle([tx-3, ty-10, tx+3, ty+6], fill=ROCK_DARK)
    draw.ellipse([tx-4, ty-15, tx+4, ty-6], fill=LIGHT_WARM)

# ── ROOM 8: BOSS CHAMBER ─────────────────────────────────────────────────────
x1, y1, x2, y2 = rooms['boss']
bcx, bcy = (x1+x2)//2, (y1+y2)//2

# Grand concentric ring pattern (crimson + gold)
for i, r in enumerate(range(188, 8, -28)):
    col = CRIMSON if i % 2 == 0 else GOLD_DARK
    draw.ellipse([bcx-r, bcy-r, bcx+r, bcy+r], outline=col, width=2)

# Cross + diagonals in gold
draw.line([(bcx-192, bcy),(bcx+192, bcy)], fill=GOLD_DARK, width=2)
draw.line([(bcx, bcy-132),(bcx, bcy+132)], fill=GOLD_DARK, width=2)
for ang in [45, 135]:
    rad = math.radians(ang)
    dx, dy = int(175*math.cos(rad)), int(118*math.sin(rad))
    draw.line([(bcx-dx,bcy-dy),(bcx+dx,bcy+dy)], fill=GOLD_DARK, width=1)

# Central VOID PIT (inaccessible)
pit_r = 48
for r in range(pit_r+22, 0, -4):
    t = r/(pit_r+22)
    pc = blend(PIT_DARK, STONE_DARK, t)
    draw.ellipse([bcx-r, bcy-r, bcx+r, bcy+r], fill=pc)
# Red glow rim of pit
for r in range(pit_r+26, pit_r+6, -4):
    t = (r - pit_r - 6) / 20
    rim_c = blend(CRIMSON_MID, STONE_DARK, t)
    draw.ellipse([bcx-r, bcy-r, bcx+r, bcy+r], outline=rim_c, width=1)

# 6 grand pillars
for px, py in [(x1+48,y1+48),(x2-48,y1+48),(x1+48,y2-48),(x2-48,y2-48),(x1+48,bcy),(x2-48,bcy)]:
    glow(draw, px, py, 34, (198,96,28), STONE_DARK, steps=6)
    draw.ellipse([px-22, py-22, px+22, py+22], fill=STONE_PALE, outline=GOLD, width=2)
    draw.ellipse([px-11, py-11, px+11, py+11], fill=WALL)

# 4 crimson brazier lights
for tx, ty in [(x1+18,y1+18),(x2-18,y1+18),(x1+18,y2-18),(x2-18,y2-18)]:
    glow(draw, tx, ty, 44, CRIMSON_MID, STONE_DARK, steps=7)
    draw.ellipse([tx-6, ty-6, tx+6, ty+6], fill=CRIMSON)

# ── ROOM 9: RESTRICTED VAULT ─────────────────────────────────────────────────
x1, y1, x2, y2 = rooms['vault']
bar_color = (148, 112, 24)
bar_w = 7

# Iron bars — horizontal rails
for rail_y in [y1+14, (y1+y2)//2, y2-14]:
    draw.rectangle([x1+22, rail_y-bar_w//2, x2-22, rail_y+bar_w//2], fill=bar_color)

# Iron bars — vertical posts
for bx in range(x1+26, x2-22, 26):
    draw.rectangle([bx-bar_w//2, y1+14, bx+bar_w//2, y2-14], fill=bar_color)

# Dark interior behind bars
draw.rectangle([x1+28, y1+20, x2-28, y2-20], fill=(78, 72, 58))
tile_floor(draw, x1+28, y1+20, x2-28, y2-20, (78, 72, 58), 22)

# Treasure chests inside
for cx_, cy_ in [(x1+100,(y1+y2)//2-18),(x1+195,(y1+y2)//2+18),(x1+292,(y1+y2)//2-10)]:
    draw.rectangle([cx_-20,cy_-13,cx_+20,cy_+13], fill=(108,60,16), outline=GOLD, width=2)
    draw.rectangle([cx_-20,cy_-13,cx_+20,cy_-2],  fill=(84,46,12))
    draw.ellipse([cx_-6, cy_-9, cx_+6, cy_+4], fill=GOLD)
    glow(draw, cx_, cy_, 16, GOLD, (78,72,58), steps=4)

# X marks at bars corners (restricted)
for sx, sy in [(x1+12,y1+5),(x2-12,y1+5),(x1+12,y2-5),(x2-12,y2-5)]:
    draw.ellipse([sx-11,sy-11,sx+11,sy+11], fill=CRIMSON)
    draw.line([(sx-6,sy-6),(sx+6,sy+6)], fill=(252,248,200), width=2)
    draw.line([(sx+6,sy-6),(sx-6,sy+6)], fill=(252,248,200), width=2)

# ── ROOM 10: EXIT HALL ───────────────────────────────────────────────────────
x1, y1, x2, y2 = rooms['exit']
ecx, ecy = (x1+x2)//2, (y1+y2)//2

# Stone path leading to portal
path_cx = x2-44
draw.rectangle([path_cx-30, y1+5, path_cx+30, y2-5], fill=STONE_PALE)
tile_floor(draw, path_cx-30, y1+5, path_cx+30, y2-5, STONE_PALE, 22)

# Column pairs flanking the path
for col_y in [y1+62, y1+168, y1+272]:
    for off in [-52, 52]:
        cx_ = path_cx + off
        draw.rectangle([cx_-13, col_y-34, cx_+13, col_y+34], fill=STONE_PALE, outline=STONE_DARK)
        draw.rectangle([cx_-16, col_y-38, cx_+16, col_y-28], fill=STONE_DARK)
        draw.rectangle([cx_-16, col_y+28, cx_+16, col_y+38], fill=STONE_DARK)

# Rune trail on path toward portal
for rx_ in range(x1+65, path_cx-10, 48):
    glow(draw, rx_, ecy, 14, RUNE_TEAL, STONE, steps=4)
    draw.ellipse([rx_-5, ecy-5, rx_+5, ecy+5], fill=RUNE_TEAL)

# EXIT PORTAL (right wall glow)
portal_cx, portal_cy = x2-22, ecy
for r in range(58, 4, -8):
    t = 1 - r/62
    gc = blend(STONE, RUNE_BLUE, t)
    draw.ellipse([portal_cx-r, portal_cy-r, portal_cx+r, portal_cy+r], fill=gc)
draw.ellipse([portal_cx-18, portal_cy-18, portal_cx+18, portal_cy+18], fill=LIGHT_COOL)
glow(draw, portal_cx, portal_cy, 65, LIGHT_COOL, STONE, steps=8)

# Decorative side glyphs
for rx_, ry_ in [(x1+52,ecy-65),(x1+52,ecy+65),(x1+128,ecy-65),(x1+128,ecy+65)]:
    draw.ellipse([rx_-9, ry_-9, rx_+9, ry_+9], outline=RUNE_BLUE, width=1)
    draw.line([(rx_-6,ry_),(rx_+6,ry_)], fill=RUNE_BLUE, width=1)
    draw.line([(rx_,ry_-6),(rx_,ry_+6)], fill=RUNE_BLUE, width=1)

# ═══════════════════════════════════════════════════════════════════════════
#  CORRIDOR DETAILS
# ═══════════════════════════════════════════════════════════════════════════
# Redraw corridors clean (over any decoration bleed)
for cx1, cy1, cx2, cy2 in corridors:
    draw.rectangle([cx1, cy1, cx2, cy2], fill=STONE_DARK)
    tile_floor(draw, cx1, cy1, cx2, cy2, STONE_DARK, 22)
    # Edge shadow inside corridor
    mid_x, mid_y = (cx1+cx2)//2, (cy1+cy2)//2
    glow(draw, mid_x, mid_y, 8, blend(STONE_DARK,(0,0,0),0.3), STONE_DARK, steps=3)

# ═══════════════════════════════════════════════════════════════════════════
#  GLOBAL WALL EDGE SHADOWS (each room's inner border dark vignette)
# ═══════════════════════════════════════════════════════════════════════════
for name, (x1, y1, x2, y2) in rooms.items():
    base = floor_colors[name]
    shadow = blend(base, WALL, 0.62)
    thick = 10
    # Top/bottom
    for i in range(thick):
        t = i/thick
        c = blend(shadow, base, t)
        draw.line([(x1+i, y1+i),(x2-i, y1+i)], fill=c, width=1)
        draw.line([(x1+i, y2-i),(x2-i, y2-i)], fill=c, width=1)
    # Left/right
    for i in range(thick):
        t = i/thick
        c = blend(shadow, base, t)
        draw.line([(x1+i, y1+i),(x1+i, y2-i)], fill=c, width=1)
        draw.line([(x2-i, y1+i),(x2-i, y2-i)], fill=c, width=1)

# ── Final smooth pass ────────────────────────────────────────────────────────
img = img.filter(ImageFilter.SMOOTH)
img = img.filter(ImageFilter.SMOOTH)

# ── Save ─────────────────────────────────────────────────────────────────────
import os
_here = os.path.dirname(os.path.abspath(__file__))
out   = os.path.join(_here, 'frontend', 'public', 'assets', 'dungeon_map.png')
if not os.path.isdir(os.path.dirname(out)):
    raise FileNotFoundError(f"Assets directory not found: {os.path.dirname(out)}")
img.save(out)
print(f"Saved: {out}  ({W}x{H})")

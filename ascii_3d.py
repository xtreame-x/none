"""
ascii_3d.py  -  Elemental Game: Immersive ASCII 3D Renderer
============================================================
Pure greyscale, shadow-cast, textured raycaster.
Shadows: horizontal wall hits = lit, vertical hits = 60% dark (classic Wolfenstein trick).
Characters: .,;:^*`'" + block elements — no harsh #@& symbols.

Controls:
  W/S / Up-Down  -> Move
  A/D / Left-Right -> Turn
  ENTER          -> Toggle mouse look
  SPACE          -> Sprint
  M              -> Toggle minimap
  ESC            -> Quit
"""

import pygame as pg
import math, sys, random
import numpy as np

# ── Display ──────────────────────────────────────────────────────────────────
WIN_W, WIN_H = 1280, 720
FPS          = 60
FONT_SIZE    = 11          # smaller = more columns = objects look smaller

# ── Raycasting ───────────────────────────────────────────────────────────────
FOV        = math.radians(78)   # wider angle → objects smaller, more scene visible
HALF_FOV   = FOV / 2
MAX_DEPTH  = 20
MOUSE_SENS = 0.002
SCALE      = 0.82              # extra shrink on projection height (< 1 = smaller)

# ── Greyscale only ───────────────────────────────────────────────────────────
def grey(v):
    v = max(0, min(255, int(v)))
    return (v, v, v)

def qgrey(v, steps=16):
    """Quantise brightness to `steps` levels for cache efficiency."""
    s = 255 // steps
    q = round(v / 255 * steps) * s
    return grey(q)

# ── Character palettes (dense → sparse, no harsh chars) ──────────────────────
#   Wall:  block fades into punctuation into nothing
WALL_CHARS  = list('█▓▒░|;:,.\'^"`  ')   # 15 levels
#   Floor: sparse dots near feet, nothing far
FLOOR_CHARS = list('.,\'` ')              # 5 levels
#   Ceiling: barely visible, near-blank
CEIL_CHARS  = list(' `\'.;')              # 5 levels
#   Enemy: dense near, ghostly far
ENEMY_CHARS = list('▓▒░;:.')             # 6 levels

# Shadow multipliers (classic Wolfenstein technique)
SHADOW_H = 1.00    # horizontal wall face — lit
SHADOW_V = 0.58    # vertical   wall face — in shadow

# ── Map ───────────────────────────────────────────────────────────────────────
MAP_DATA = [
    "######################",
    "#....................#",
    "#..####..........##.#",
    "#....................#",
    "#....#...####....#..#",
    "#....#...#..#....#..#",
    "#........#..#.......#",
    "#....##..####....##.#",
    "#....................#",
    "#...#...E........#..#",
    "#...#...........##..#",
    "#....................#",
    "#..##....E...##.....#",
    "#....................#",
    "#....####........#..#",
    "#....................#",
    "#....................#",
    "######################",
]
MAP_W    = len(MAP_DATA[0])
MAP_H    = len(MAP_DATA)
WALL_SET = {(c, r) for r, row in enumerate(MAP_DATA)
            for c, ch in enumerate(row) if ch == '#'}
ENEMY_STARTS = [(c + 0.5, r + 0.5) for r, row in enumerate(MAP_DATA)
                for c, ch in enumerate(row) if ch == 'E']


# ── Player ────────────────────────────────────────────────────────────────────
class Player:
    SPEED      = 4.0
    SPRINT_MUL = 1.8
    ROT_SPEED  = 2.2

    def __init__(self):
        self.x     = 2.5
        self.y     = 2.5
        self.angle = 0.3

    def update(self, dt, keys, mouse_dx):
        self.angle += mouse_dx * MOUSE_SENS
        self.angle %= 2 * math.pi
        if keys[pg.K_LEFT]  or keys[pg.K_a]: self.angle -= self.ROT_SPEED * dt
        if keys[pg.K_RIGHT] or keys[pg.K_d]: self.angle += self.ROT_SPEED * dt
        spd = self.SPEED * (self.SPRINT_MUL if keys[pg.K_SPACE] else 1.0) * dt
        sin_a, cos_a = math.sin(self.angle), math.cos(self.angle)
        dx = dy = 0
        if keys[pg.K_w] or keys[pg.K_UP]:
            dx += cos_a * spd; dy += sin_a * spd
        if keys[pg.K_s] or keys[pg.K_DOWN]:
            dx -= cos_a * spd; dy -= sin_a * spd
        if (int(self.x + dx), int(self.y)) not in WALL_SET: self.x += dx
        if (int(self.x), int(self.y + dy)) not in WALL_SET: self.y += dy
        self.x = max(0.5, min(MAP_W - 0.5, self.x))
        self.y = max(0.5, min(MAP_H - 0.5, self.y))


# ── Enemy ────────────────────────────────────────────────────────────────────
class Enemy:
    def __init__(self, x, y):
        self.x   = x
        self.y   = y
        self.hp  = 3
        self.bob = random.uniform(0, math.pi * 2)

    def update(self, dt):
        self.bob = (self.bob + dt * 2) % (math.pi * 2)

    @property
    def alive(self): return self.hp > 0


# ── Glyph cache ───────────────────────────────────────────────────────────────
class GlyphCache:
    def __init__(self, font):
        self._font  = font
        self._cache = {}

    def get(self, char, color):
        key = (char, color)
        if key not in self._cache:
            self._cache[key] = self._font.render(char, False, color)
        return self._cache[key]


# ── Numpy DDA Raycaster — returns depths + shadow types ──────────────────────
def raycast(ox, oy, angle, num_rays):
    """
    Returns: depths (list of float), shadows (list of float: SHADOW_H or SHADOW_V)
    Horizontal grid hit = lit face (SHADOW_H)
    Vertical   grid hit = dark face (SHADOW_V)
    """
    ray_angles = (angle - HALF_FOV + 1e-6) + np.arange(num_rays) * (FOV / num_rays)
    sin_a = np.sin(ray_angles)
    cos_a = np.cos(ray_angles)

    # ── Horizontal intersections ──────────────────────────────────────────────
    y_hor    = np.where(sin_a >= 0, np.floor(oy)+1.0, np.ceil(oy)-1.0)
    dy_h     = np.where(sin_a >= 0, 1.0, -1.0)
    sin_safe = np.where(np.abs(sin_a) < 1e-9, 1e-9, sin_a)
    depth_h  = (y_hor - oy) / sin_safe
    x_hor    = ox + depth_h * cos_a
    dd_h     = np.abs(1.0 / sin_safe)
    dx_h     = dd_h * cos_a
    hit_h    = np.zeros(num_rays, dtype=bool)

    for _ in range(MAX_DEPTH):
        mask = ~hit_h
        if not mask.any(): break
        ix = x_hor[mask].astype(int);  iy = y_hor[mask].astype(int)
        new_hits = np.array([(x, y) in WALL_SET for x, y in zip(ix, iy)])
        idx = np.where(mask)[0]
        hit_h[idx[new_hits]] = True
        go = idx[~new_hits]
        x_hor[go] += dx_h[go]; y_hor[go] += dy_h[go]; depth_h[go] += dd_h[go]

    # ── Vertical intersections ────────────────────────────────────────────────
    x_vert   = np.where(cos_a >= 0, np.floor(ox)+1.0, np.ceil(ox)-1.0)
    dx_v     = np.where(cos_a >= 0, 1.0, -1.0)
    cos_safe = np.where(np.abs(cos_a) < 1e-9, 1e-9, cos_a)
    depth_v  = (x_vert - ox) / cos_safe
    y_vert   = oy + depth_v * sin_a
    dd_v     = np.abs(1.0 / cos_safe)
    dy_v     = dd_v * sin_a
    hit_v    = np.zeros(num_rays, dtype=bool)

    for _ in range(MAX_DEPTH):
        mask = ~hit_v
        if not mask.any(): break
        ix = x_vert[mask].astype(int); iy = y_vert[mask].astype(int)
        new_hits = np.array([(x, y) in WALL_SET for x, y in zip(ix, iy)])
        idx = np.where(mask)[0]
        hit_v[idx[new_hits]] = True
        go = idx[~new_hits]
        x_vert[go] += dx_v[go]; y_vert[go] += dy_v[go]; depth_v[go] += dd_v[go]

    # ── Combine — pick closer hit, record which face ──────────────────────────
    use_vert  = depth_v < depth_h
    depths    = np.where(use_vert, depth_v, depth_h)
    depths   *= np.cos(angle - ray_angles)           # fisheye fix
    depths    = np.maximum(0.05, depths)
    shadows   = np.where(use_vert, SHADOW_V, SHADOW_H)  # V=dark, H=lit

    return depths.tolist(), shadows.tolist()


# ── Enemy projection ──────────────────────────────────────────────────────────
def project_enemies(player, enemies, depths, cols, rows, sdist):
    sprites = []
    half_r  = rows // 2
    for e in enemies:
        if not e.alive: continue
        dx   = e.x - player.x;  dy = e.y - player.y
        dist = math.hypot(dx, dy)
        if dist < 0.2: continue
        sang = math.atan2(dy, dx) - player.angle
        while sang >  math.pi: sang -= 2*math.pi
        while sang < -math.pi: sang += 2*math.pi
        if abs(sang) > HALF_FOV * 1.2: continue
        col_c    = int((sang + HALF_FOV) / FOV * cols)
        sprite_h = int(sdist * SCALE / (dist + 0.01))
        sprite_w = max(2, sprite_h // 2)
        bob_off  = int(math.sin(e.bob) * 1.5)
        top      = half_r - sprite_h // 2 + bob_off
        bot      = top + sprite_h
        sprites.append({'dist':dist,'col':col_c,'w':sprite_w,'top':top,'bot':bot})
    sprites.sort(key=lambda s: -s['dist'])
    return sprites


# ── Main renderer ─────────────────────────────────────────────────────────────
class ASCIIWorld:
    def __init__(self):
        pg.init()
        self.screen   = pg.display.set_mode((WIN_W, WIN_H),
                                             pg.HWSURFACE | pg.DOUBLEBUF)
        pg.display.set_caption('Elemental - ASCII 3D World')
        self.clock    = pg.time.Clock()
        self.font     = pg.font.SysFont('Consolas', FONT_SIZE)
        test          = self.font.render('#', False, (255,255,255))
        self.cw       = test.get_width()
        self.ch       = test.get_height()
        self.cols     = WIN_W // self.cw
        self.rows     = WIN_H // self.ch
        self.half_r   = self.rows // 2
        self.sdist    = (self.cols / 2) / math.tan(HALF_FOV)
        self.glyphs   = GlyphCache(self.font)
        self.player   = Player()
        self.enemies  = [Enemy(ex, ey) for ex, ey in ENEMY_STARTS]
        self.show_map = True
        self.mouse_cap= False

    def handle_events(self):
        mdx = 0
        for event in pg.event.get():
            if event.type == pg.QUIT: pg.quit(); sys.exit()
            if event.type == pg.KEYDOWN:
                if event.key == pg.K_ESCAPE:  pg.quit(); sys.exit()
                if event.key == pg.K_m:       self.show_map = not self.show_map
                if event.key == pg.K_RETURN:
                    self.mouse_cap = not self.mouse_cap
                    pg.event.set_grab(self.mouse_cap)
                    pg.mouse.set_visible(not self.mouse_cap)
            if event.type == pg.MOUSEMOTION and self.mouse_cap:
                mdx = event.rel[0]
        return mdx

    def draw_column(self, col, depth, shadow):
        """
        Render one vertical screen column in greyscale.
        shadow: SHADOW_H (lit) or SHADOW_V (dark face) — simulates directional light.
        Wall rows get per-row vertical gradient (top-lit, bottom-shadowed).
        """
        wall_h   = int(self.sdist * SCALE / depth)
        wall_top = max(0, self.half_r - wall_h // 2)
        wall_bot = min(self.rows, self.half_r + wall_h // 2)
        x_px     = col * self.cw
        span     = max(1, wall_bot - wall_top)

        # ── Ceiling — near-black, barely visible ─────────────────────────────
        for row in range(wall_top):
            dist_ratio = (self.half_r - row) / max(1, self.half_r)
            idx  = min(len(CEIL_CHARS)-1, int(dist_ratio * len(CEIL_CHARS)))
            v    = int(dist_ratio * 22)          # very dark, max ~22
            g_s  = self.glyphs.get(CEIL_CHARS[idx], qgrey(v))
            self.screen.blit(g_s, (x_px, row * self.ch))

        # ── Wall — greyscale + top-lit vertical gradient + face shadow ────────
        for row in range(wall_top, wall_bot):
            v_ratio = (row - wall_top) / span    # 0=top, 1=bottom
            # Depth fade: near = bright (200), far = dark (18)
            base    = (1.0 - min(1.0, depth / MAX_DEPTH)) * 200 + 18
            # Top-lit: top = 100%, bottom = 50%
            base   *= (1.0 - v_ratio * 0.50)
            # Shadow face multiplier
            base   *= shadow
            # Char: dense near top, sparse near bottom + at distance
            char_t  = min(1.0, (depth / MAX_DEPTH) * 0.65 + v_ratio * 0.35)
            cidx    = min(len(WALL_CHARS)-1, int(char_t * len(WALL_CHARS)))
            g_s     = self.glyphs.get(WALL_CHARS[cidx], qgrey(base))
            self.screen.blit(g_s, (x_px, row * self.ch))

        # ── Floor — dark, sparse dots ──────────────────────────────────────────
        for row in range(wall_bot, self.rows):
            dist_ratio = (row - self.half_r) / max(1, self.half_r)
            idx  = min(len(FLOOR_CHARS)-1, int(dist_ratio * len(FLOOR_CHARS)))
            v    = int(dist_ratio * 38)          # very dark ground
            g_s  = self.glyphs.get(FLOOR_CHARS[idx], qgrey(v))
            self.screen.blit(g_s, (x_px, row * self.ch))

    def draw_enemies(self, sprites, wall_depths):
        for sp in sprites:
            dist = sp['dist']
            v    = max(10, int((1 - min(1.0, dist/8)) * 160))
            sidx = min(len(ENEMY_CHARS)-1, int(dist/8 * len(ENEMY_CHARS)))
            eg_s = self.glyphs.get(ENEMY_CHARS[sidx], qgrey(v))
            for dc in range(-sp['w']//2, sp['w']//2):
                c = sp['col'] + dc
                if not (0 <= c < self.cols): continue
                if dist >= wall_depths[c]: continue
                x_px = c * self.cw
                for row in range(max(0, sp['top']), min(self.rows, sp['bot'])):
                    self.screen.blit(eg_s, (x_px, row * self.ch))

    def draw_minimap(self):
        TILE  = 7
        ox    = WIN_W - MAP_W * TILE - 8
        oy    = 8
        # Dark transparent overlay
        s = pg.Surface((MAP_W*TILE, MAP_H*TILE), pg.SRCALPHA)
        s.fill((0,0,0,160))
        self.screen.blit(s, (ox, oy))
        for r, row in enumerate(MAP_DATA):
            for c, ch in enumerate(row):
                col = (90,90,90) if ch=='#' else (25,25,25)
                pg.draw.rect(self.screen, col, (ox+c*TILE, oy+r*TILE, TILE-1, TILE-1))
        # Player
        px = int(ox + self.player.x * TILE)
        py = int(oy + self.player.y * TILE)
        pg.draw.circle(self.screen, (220,220,220), (px, py), 3)
        for a in [self.player.angle - HALF_FOV, self.player.angle + HALF_FOV]:
            pg.draw.line(self.screen, (180,180,180), (px,py),
                         (px+int(math.cos(a)*20), py+int(math.sin(a)*20)))
        # Enemies
        for e in self.enemies:
            if e.alive:
                pg.draw.circle(self.screen, (200,200,200),
                               (int(ox+e.x*TILE), int(oy+e.y*TILE)), 2)

    def draw_hud(self, fps):
        hf    = pg.font.SysFont('Consolas', 14, bold=True)
        alive = sum(1 for e in self.enemies if e.alive)
        for i, line in enumerate([
            f'FPS:{fps:.0f}  {self.cols}x{self.rows} chars  Enemies:{alive}',
            'WASD=Move  ENTER=Mouse  M=Map  ESC=Quit',
        ]):
            self.screen.blit(hf.render(line, True, (160,160,160)),
                             (10, WIN_H - (2-i)*18 - 5))
        # Crosshair (simple grey dot)
        cx, cy = WIN_W//2, WIN_H//2
        pg.draw.line(self.screen,(130,130,130),(cx-6,cy),(cx+6,cy))
        pg.draw.line(self.screen,(130,130,130),(cx,cy-6),(cx,cy+6))

    def run(self):
        while True:
            dt      = self.clock.tick(FPS) / 1000.0
            mdx     = self.handle_events()
            keys    = pg.key.get_pressed()
            self.player.update(dt, keys, mdx)
            for e in self.enemies: e.update(dt)

            depths, shadows = raycast(self.player.x, self.player.y,
                                      self.player.angle, self.cols)
            self.screen.fill((0,0,0))

            for col in range(self.cols):
                self.draw_column(col, depths[col], shadows[col])

            sprites = project_enemies(self.player, self.enemies, depths,
                                      self.cols, self.rows, self.sdist)
            self.draw_enemies(sprites, depths)
            if self.show_map: self.draw_minimap()
            self.draw_hud(self.clock.get_fps())
            pg.display.flip()


if __name__ == '__main__':
    ASCIIWorld().run()

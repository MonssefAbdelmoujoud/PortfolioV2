// The ASCII koi pond behind the page: koi, little fish schools, wake dots, and food you drop with a click,
// drawn on the full-screen <canvas id="ocean">. Self-contained; it only listens to
// the "themechange" event and reads the --veil variable that ui.js sets.
(() => {
  // ── grid & helpers ────────────────────────────────────────────────
  const CW = 10, CH = 12;          // cell size in CSS px
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  function hash(x, y, z) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const canvas = document.getElementById("ocean");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, cols = 0, rows = 0, dpr = 1;
  let energy = new Float32Array(0);   // wake field, one value per cell
  let occ = new Uint8Array(0);        // cells covered by a koi this frame
  let ambient = new Float32Array(0);  // per-cell twinkle phase, <0 = no dot
  let time = 0;

  // ── theme ─────────────────────────────────────────────────────────
  const THEMES = {
    dark: {
      bg: "#0b0b0c", grid: "rgba(255,255,255,0.028)", dot: [190, 190, 190], wake: [220, 190, 80],
      fish: [220, 220, 220], edge: "rgba(205,205,205,0.35)", eye: 8,
      // koi skin colours; koiShade = [darkest, range] multiplier for the lighting
      koi: { gold: [226, 178, 52], white: [214, 214, 208], black: [48, 48, 52], finBlack: [118, 118, 124] }, koiShade: [0.45, 0.72],
      tailShade: 0.8,   // tail rays: lighter than the body, like a see-through fin
    },
    light: {
      bg: "#f3f3f1", grid: "rgba(0,0,0,0.045)", dot: [70, 70, 70], wake: [170, 135, 20],
      fish: [40, 40, 40], edge: "rgba(64,64,64,0.4)", eye: 20,
      // white koi stay a shade darker than the page so they don't vanish into it
      koi: { gold: [212, 160, 34], white: [222, 222, 216], black: [40, 40, 44], finBlack: [70, 70, 76] }, koiShade: [0.68, 0.4],
      tailShade: 0.05,  // on the pale page light rays would vanish, so they're drawn darker instead
    },
  };
  // The theme itself is owned by ui.js (and the inline script in <head>); the ocean just follows it.
  const root = document.documentElement;
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");
  const themeName = () => root.dataset.theme || (darkQuery.matches ? "dark" : "light");
  let T = THEMES[themeName()];

  // A canvas can't fade between colours by itself, so on a theme switch we lay a snapshot of
  // the old pond over the canvas and fade that out while the pond carries on in the new theme.
  function crossFade() {
    if (reduced.matches || !W) return;
    const snap = document.createElement("canvas");
    snap.className = "ocean-snap";
    snap.width = canvas.width; snap.height = canvas.height;
    snap.getContext("2d").drawImage(canvas, 0, 0);
    const cs = getComputedStyle(canvas);   // same blur/dim as the pond (the scroll veil)
    snap.style.cssText = `position:fixed;inset:0;width:100%;height:100vh;z-index:0;pointer-events:none;` +
      `filter:${cs.filter};opacity:${cs.opacity}`;
    canvas.after(snap);
    // An explicit animation rather than a CSS transition: a freshly inserted element has no
    // "before" style to transition from, so a transition would simply jump to 0.
    snap.animate([{ opacity: cs.opacity }, { opacity: 0 }], { duration: 180, easing: "ease", fill: "forwards" })
      .finished.then(() => snap.remove(), () => snap.remove());
    setTimeout(() => snap.remove(), 500);   // backstop in case the animation never gets to run
  }

  document.addEventListener("themechange", () => {
    crossFade();   // before T changes: the canvas still shows the old theme
    T = THEMES[themeName()];
    if (reduced.matches) render(0);
  });

  // ── koi ───────────────────────────────────────────────────────────
  // Seen from above, like looking into a pond. Each koi is a spine of N points (head → tail);
  // its body, fins and colour patches are drawn around that spine every frame.
  const N = 18;   // spine nodes

  // Varieties in the site's palette (gray / black / yellow). `patch` is the colour of the
  // markings, `amount` how much of the body they cover (0 = plain).
  const VARIETIES = {
    ogon:     { name: "Ogon",       base: "gold",  patch: "gold",  amount: 0 },     // plain metallic gold
    shiro:    { name: "Shiro Utsuri", base: "white", patch: "black", amount: 0.42 }, // white with black markings
    kiutsuri: { name: "Ki Utsuri",  base: "black", patch: "gold",  amount: 0.45 },  // black with gold markings
  };
  const SCALES = "@0Oo:.";     // dense glyphs in shadow → light ones where the light hits
  const FIN_GLYPHS = "~-=~";   // fins are drawn as loose strokes, so they read as thin and flowing
  const EDGE = ".:'`,";

  // Every width below (body, fins, tail) is scaled by this: < 1 makes the koi longer for its
  // width. 0.87 puts the body at about 4.5 : 1, still a full-bodied koi rather than an eel.
  const SLIM = 0.87;

  // Half-width of the body at s ∈ [0,1] (snout → tail), as a fraction of length.
  // Proportions follow real koi seen from above: the body (snout to tail stalk) is about
  // four times as long as it is wide, the rounded head a little narrower than the
  // shoulders, then the body stays full to about halfway and tapers to the tail stalk where
  // the tail fin takes over.
  function bodyHW(s) {
    if (s < 0 || s > 0.72) return 0;
    if (s < 0.1) return 0.075 * Math.pow(Math.sin((s / 0.1) * Math.PI / 2), 0.6);
    if (s < 0.28) return 0.075 + 0.017 * smooth(0.1, 0.28, s);
    return 0.03 + 0.062 * (1 - smooth(0.36, 0.72, s));
  }

  // Smooth value noise in [0,1): random values on a grid, blended between grid points.
  // Used for the colour patches, in body coordinates, so the markings swim with the fish.
  function noise(x, y, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  class Koi {
    constructor(id, variety, len) {
      this.id = id; this.variety = VARIETIES[variety]; this.L = len;
      this.seg = len / (N - 1);
      const x = rand(0.15, 0.85) * W, y = rand(0.15, 0.85) * H;
      this.heading = rand(0, TAU);
      this.nodes = [];
      for (let i = 0; i < N; i++) this.nodes.push({
        x: x - Math.cos(this.heading) * this.seg * i,
        y: y - Math.sin(this.heading) * this.seg * i,
      });
      this.disp = this.nodes.map(n => ({ x: n.x, y: n.y }));
      this.speed = 20; this.omega = 0; this.phase = rand(0, TAU);
      this.target = { x, y }; this.wanderT = 0; this.food = null;
    }
    // Koi glide: slow cruise, a bit quicker when food is in the water.
    get cruise() { return 24 * Math.sqrt(this.L / 300); }

    step(dt, koi, pellets) {
      const h = this.nodes[0];
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.target = { x: rand(0.15, 0.85) * W, y: rand(0.18, 0.82) * H };
        this.wanderT = rand(7, 14);
      }
      // Food in the water? Head for the nearest pellet and eat it on arrival.
      this.food = null;
      let bestD = Infinity;
      for (const p of pellets) {
        const d = Math.hypot(p.x - h.x, p.y - h.y);
        if (d < bestD) { bestD = d; this.food = p; }
      }
      const feeding = !!this.food;
      let tx = this.target.x, ty = this.target.y;
      if (feeding) {
        tx = this.food.x; ty = this.food.y;
        const mouth = this.disp[0];
        if (Math.hypot(this.food.x - mouth.x, this.food.y - mouth.y) < this.L * 0.22) {
          this.food.eaten = true;
          stamp(this.food.x, this.food.y, 1, 0.6);   // a little swirl where it ate
        }
      } else if (Math.hypot(tx - h.x, ty - h.y) < this.L * 0.5) {
        // Reached the wander point: move on instead of circling on the spot.
        this.wanderT = 0;
        tx = h.x + Math.cos(this.heading) * this.L; ty = h.y + Math.sin(this.heading) * this.L;
      }

      let vx = tx - h.x, vy = ty - h.y;
      const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
      // Look ahead: turns are wide, so react to where the head is about to be.
      const ax = h.x + Math.cos(this.heading) * this.L * 0.45, ay = h.y + Math.sin(this.heading) * this.L * 0.45;
      // Soft pond edges: start curving back before the head leaves the screen.
      const m = Math.min(this.L * 0.7, W * 0.3, H * 0.3);
      if (ax < m) vx += (m - ax) / m * 3; else if (ax > W - m) vx -= (ax - W + m) / m * 3;
      if (ay < m) vy += (m - ay) / m * 3; else if (ay > H - m) vy -= (ay - H + m) / m * 3;
      // Keep clear of the other koi, from both the look-ahead point and the head, and ease
      // off when another is in front so they drift apart. While feeding they may crowd in.
      let ahead = 0;
      const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
      const shy = feeding ? 0.4 : 1;
      for (const o of koi) {
        if (o === this) continue;
        const r = (this.L + o.L) * 0.38;
        for (let i = 0; i < N; i += 2) {
          const n = o.nodes[i];
          for (let p = 0; p < 2; p++) {
            const dx = (p ? h.x : ax) - n.x, dy = (p ? h.y : ay) - n.y;
            const d = Math.hypot(dx, dy);
            if (d < r && d > 0) {
              const k = (1 - d / r) * (p ? 3 : 4) * shy;
              vx += dx / d * k; vy += dy / d * k;
              if ((n.x - h.x) * fx + (n.y - h.y) * fy > 0) ahead = Math.max(ahead, k);
            }
          }
        }
        if (Math.hypot(this.target.x - o.nodes[8].x, this.target.y - o.nodes[8].y) < o.L * 0.6) this.wanderT = 0;
      }
      const desired = Math.atan2(vy, vx);
      let turn = angDiff(this.heading, desired);
      // Near a U-turn the sign of `turn` flips back and forth; commit to the current turn direction.
      if (Math.abs(turn) > 2.4 && this.omega !== 0 && Math.sign(turn) !== Math.sign(this.omega)) turn = -turn;

      // Food perks them up: noticeably faster, and they get going sooner.
      const want = this.cruise * (feeding ? 4.2 : 1) * (1 - Math.min(0.45, ahead * 0.2));
      this.speed += (want - this.speed) * Math.min(1, dt * (feeding ? 2 : 0.8));

      // Turn rate is capped by the tightest circle the body can bend around and eased in,
      // so the spine below never has to snap. Feeding koi turn tighter to reach the food.
      const maxW = this.speed / (this.L * (feeding ? 0.3 : 0.45));
      const wantW = clamp(turn * 1.2, -maxW, maxW);
      this.omega += (wantW - this.omega) * Math.min(1, dt * 1.5);
      this.heading += this.omega * dt;
      h.x += Math.cos(this.heading) * this.speed * dt;
      h.y += Math.sin(this.heading) * this.speed * dt;

      // Follow-the-leader spine: each node keeps a fixed distance from the one ahead.
      // The joint limit is only a safety net; the turn cap above keeps it from engaging.
      const nd = this.nodes;
      let prevAng = this.heading + Math.PI;   // direction from the head back toward node 1
      for (let i = 1; i < N; i++) {
        const a = nd[i - 1], b = nd[i];
        let ang = Math.atan2(b.y - a.y, b.x - a.x);
        ang = prevAng + clamp(angDiff(prevAng, ang), -0.2, 0.2);
        b.x = a.x + Math.cos(ang) * this.seg; b.y = a.y + Math.sin(ang) * this.seg;
        prevAng = ang;
      }

      // Swimming: a slow travelling wave on top of the path, for drawing only. Small at the
      // head and large at the tail, so the long tail fin sways lazily behind the body.
      this.phase += dt * (1.4 + this.speed / 25);
      for (let i = 0; i < N; i++) {
        const s = i / (N - 1);
        const p = nd[Math.max(0, i - 1)], q = nd[Math.min(N - 1, i + 1)];
        const tl = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const off = this.L * 0.04 * (0.08 + s * s * s) * Math.sin(this.phase - s * 4);
        this.disp[i].x = nd[i].x - (q.y - p.y) / tl * off;
        this.disp[i].y = nd[i].y + (q.x - p.x) / tl * off;
      }
    }

    // Project a point onto the (swimming) spine → arc position s, signed lateral offset d, segment normal.
    // lo/hi narrow the search to segments near a known hit; out.seg reports the winner.
    project(px, py, out, lo = 0, hi = N - 2) {
      let best = Infinity;
      const nd = this.disp, last = N - 2;
      for (let i = Math.max(0, lo); i <= Math.min(last, hi); i++) {
        const a = nd[i], b = nd[i + 1];
        const sl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ux = (b.x - a.x) / sl, uy = (b.y - a.y) / sl;
        let t = ((px - a.x) * ux + (py - a.y) * uy) / sl;
        if (i > 0 && t < 0) t = 0;
        if (i < last && t > 1) t = 1;
        const qx = a.x + ux * t * sl, qy = a.y + uy * t * sl;
        const dd = (px - qx) ** 2 + (py - qy) ** 2;
        if (dd < best) {
          best = dd;
          out.s = (i + t) / (N - 1); out.seg = i;
          out.d = ux * (py - a.y) - uy * (px - a.x);
          out.nx = -uy; out.ny = ux;
        }
      }
      return out;
    }

    // What is at this point of the koi? 0 none, 1 body, 2 fin, 3 dorsal fin (along the back), 4 eye,
    // 5 tail fin
    sample(px, py, p, lo, hi) {
      this.project(px, py, p, lo, hi);
      const s = p.s, ad = Math.abs(p.d) / (this.L * SLIM), hw = bodyHW(s);
      if (ad < hw) {
        p.u = ad / hw;
        if (s > 0.05 && s < 0.085 && p.u > 0.5 && p.u < 0.9) return 4;
        if (s > 0.24 && s < 0.56 && p.u < 0.2) return 3;
        return 1;
      }
      // pectoral fins: long rounded paddles just behind the head, swept slightly back
      if (s > 0.13 && s < 0.34 && ad < hw + 0.13 * Math.pow(Math.sin(Math.PI * (s - 0.13) / 0.21), 0.8)) return 2;
      // pelvic fins: small, halfway down the body
      if (s > 0.4 && s < 0.5 && ad < hw + 0.05 * Math.sin(Math.PI * (s - 0.4) / 0.1)) return 2;
      // tail fin: long and flowing; it opens out past the tail stalk and splits into two lobes
      if (s > 0.66 && s < 1.08) {
        const k = (s - 0.66) / 0.42;
        const spread = 0.03 + 0.11 * Math.sin(k * Math.PI * 0.6);
        const fork = k > 0.5 && ad < 0.07 * (k - 0.5) / 0.5;
        if (ad < spread && !fork) return 5;
      }
      return 0;
    }

    // Colour of the skin at body position (s, d): the variety's base colour, or its patch
    // colour where the noise rises above the threshold.
    colourAt(s, d) {
      const v = this.variety;
      if (!v.amount) return v.base;
      const n = noise(s * this.L / 26, d / 20 + 50, this.id * 7 + 1);
      return n > 1 - v.amount ? v.patch : v.base;
    }
  }

  // ── fish schools (boids) ──────────────────────────────────────────
  class School {
    constructor() {
      const n = Math.round(rand(10, 22));
      this.cx = rand(0.1, 0.9) * W; this.cy = rand(0.1, 0.9) * H;
      this.goal = { x: this.cx, y: this.cy }; this.goalT = 0;
      // Most schools travel; an occasional one wheels around (bait ball) while it drifts.
      this.cruise = rand(55, 80); this.mill = Math.random() < 0.15 ? rand(25, 40) : 0;
      this.fish = [];
      const a = rand(0, TAU);
      for (let i = 0; i < n; i++) this.fish.push({
        x: this.cx + rand(-30, 30), y: this.cy + rand(-20, 20),
        vx: Math.cos(a) * this.cruise, vy: Math.sin(a) * this.cruise * 0.5, glint: 0,
      });
    }
    step(dt, koi) {
      const F = this.fish;
      let cx = 0, cy = 0, ax = 0, ay = 0;
      for (const f of F) { cx += f.x; cy += f.y; ax += f.vx; ay += f.vy; }
      cx /= F.length; cy /= F.length; ax /= F.length; ay /= F.length;
      this.cx = cx; this.cy = cy;
      this.goalT -= dt;
      // New destination when the old one is reached or goes stale.
      if (this.goalT <= 0 || Math.hypot(this.goal.x - cx, this.goal.y - cy) < 60) {
        this.goal = { x: rand(0.05, 0.95) * W, y: rand(0.08, 0.92) * H }; this.goalT = rand(4, 9);
      }

      for (const f of F) {
        let fx = 0, fy = 0;
        // separation (personal space ≈ one cell)
        for (const g of F) {
          if (g === f) continue;
          const dx = f.x - g.x, dy = f.y - g.y, d2 = dx * dx + dy * dy;
          if (d2 < 196 && d2 > 0.01) { const d = Math.sqrt(d2); fx += dx / d * (14 - d) * 9; fy += dy / d * (14 - d) * 9; }
        }
        // alignment + cohesion + goal
        fx += (ax - f.vx) * 1.6 + (cx - f.x) * 0.9;
        fy += (ay - f.vy) * 1.6 + (cy - f.y) * 0.9;
        const gx = this.goal.x - cx, gy = this.goal.y - cy, gl = Math.hypot(gx, gy) || 1;
        fx += gx / gl * 45; fy += gy / gl * 45;
        if (this.mill) { const rx = f.x - cx, ry = f.y - cy, rl = Math.hypot(rx, ry) || 1; fx += -ry / rl * this.mill; fy += rx / rl * this.mill; }
        fx += rand(-30, 30); fy += rand(-30, 30);

        // shy away from the koi (they're big, not hungry for fish) and from the pointer
        let fear = 0;
        for (const s of koi) {
          for (let i = 0; i < N; i += 2) {
            const n = s.nodes[i], dx = f.x - n.x, dy = f.y - n.y, d = Math.hypot(dx, dy), r = s.L * (i < 5 ? 0.3 : 0.2);
            if (d < r && d > 0) { const k = (1 - d / r); fx += dx / d * k * 360; fy += dy / d * k * 360; fear = Math.max(fear, k * 0.6); }
          }
        }
        if (pointer.active) {
          const dx = f.x - pointer.x, dy = f.y - pointer.y, d = Math.hypot(dx, dy);
          if (d < 90 && d > 0) { const k = 1 - d / 90; fx += dx / d * k * 600; fy += dy / d * k * 600; fear = Math.max(fear, k); }
        }
        // soft walls
        const m = 40;
        if (f.x < m) fx += (m - f.x) * 4; if (f.x > W - m) fx -= (f.x - W + m) * 4;
        if (f.y < m) fy += (m - f.y) * 4; if (f.y > H - m) fy -= (f.y - H + m) * 4;

        f.vx += fx * dt; f.vy += fy * dt;
        f.vy *= 1 - dt * 0.6;   // fish mostly cruise level
        const sp = Math.hypot(f.vx, f.vy) || 1;
        const max = this.cruise * (1.4 + fear * 1.4), min = this.cruise * 0.6;
        if (sp > max) { f.vx *= max / sp; f.vy *= max / sp; }
        if (sp < min) { f.vx *= min / sp; f.vy *= min / sp; }
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.glint = Math.max(f.glint - dt * 2, fear);
      }
    }
  }

  // ── world ─────────────────────────────────────────────────────────
  let koi = [], schools = [], ripples = [], pellets = [];
  const pointer = { x: 0, y: 0, active: false };

  function populate() {
    // Portrait phones are narrow but tall; sizing off the long side too keeps the koi
    // long enough (in cells) to read as koi.
    const base = clamp(Math.max(Math.min(W, H) * 0.5, Math.max(W, H) * 0.34), 240, 400) * 1.02;
    const count = W < 700 ? 2 : 3;
    const varieties = ["ogon", "shiro", "kiutsuri"];
    koi = [];
    for (let i = 0; i < count; i++) koi.push(new Koi(i, varieties[i], base * (1 - i * 0.1)));
    schools = [];
    const nSchools = clamp(Math.round(W * H / 110000), 3, 10);
    for (let i = 0; i < nSchools; i++) schools.push(new School());
  }

  function resize() {
    // Measure the canvas itself (100vh = the large viewport on phones), so the toolbar
    // sliding in and out while scrolling doesn't change its size and rebuild the ocean.
    const rect = canvas.getBoundingClientRect(), nextDpr = Math.min(devicePixelRatio || 1, 2);
    if (Math.round(rect.width) === W && Math.round(rect.height) === H && nextDpr === dpr) return;
    W = Math.round(rect.width); H = Math.round(rect.height);
    dpr = nextDpr;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    resetSprites();
    cols = Math.ceil(W / CW); rows = Math.ceil(H / CH);
    energy = new Float32Array(cols * rows);
    occ = new Uint8Array(cols * rows);
    ambient = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
      ambient[r * cols + c] = hash(c, r, 7) < 0.045 ? hash(c, r, 11) * TAU : -1;
    if (!koi.length) populate();
  }

  function stamp(x, y, radius, amount) {
    const c0 = Math.floor(x / CW), r0 = Math.floor(y / CH);
    for (let r = r0 - radius; r <= r0 + radius; r++) {
      if (r < 0 || r >= rows) continue;
      for (let c = c0 - radius; c <= c0 + radius; c++) {
        if (c < 0 || c >= cols) continue;
        const fall = 1 - Math.hypot(c - c0, r - r0) / (radius + 1);
        if (fall > 0) energy[r * cols + c] = Math.min(1.2, energy[r * cols + c] + amount * fall);
      }
    }
  }

  function step(dt) {
    time += dt;
    for (const k of koi) k.step(dt, koi, pellets);
    for (const sc of schools) sc.step(dt, koi);
    for (const k of koi) {
      stamp(k.nodes[N - 1].x, k.nodes[N - 1].y, 2, dt * 1.4);
      stamp(k.nodes[Math.floor(N * 0.4)].x, k.nodes[Math.floor(N * 0.4)].y, 3, dt * 0.5);
    }
    // Food pellets drift a little, fade after a while, and disappear once a koi eats them.
    for (const p of pellets) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt; p.vy *= 1 - dt; p.life -= dt; }
    pellets = pellets.filter(p => !p.eaten && p.life > 0);
    for (const sc of schools) for (const f of sc.fish) stamp(f.x, f.y, 0, dt * 0.5);
    const decay = 1 - dt * 0.7;
    for (let i = 0; i < energy.length; i++) energy[i] *= decay;
    for (const rp of ripples) rp.r += dt * 260, rp.life -= dt * 0.8;
    ripples = ripples.filter(r => r.life > 0);
  }

  // ── render ────────────────────────────────────────────────────────
  const P = { s: 0, d: 0, nx: 0, ny: 0, u: 0 };
  const LX = -0.6, LY = -0.8;   // light from the top-left
  const SUB = [0.25, 0.25, 0.75, 0.25, 0.25, 0.75, 0.75, 0.75];
  let koiCells = [];

  // How far anything on the koi reaches from spine node s (body + fins), as a fraction of L.
  function reach(s) {
    if (s < 0.12) return 0.1;           // head
    if (s < 0.38) return 0.24;          // shoulders + pectoral fins
    if (s < 0.64) return 0.14;          // pelvics, tapering body
    return 0.2;                         // tail fin, which extends past the last node
  }

  let candTag = new Uint32Array(0), candSeg = new Uint8Array(0), candDist = new Float32Array(0), tagNo = 0;
  let occIdx = new Int32Array(0);   // index into koiCells for each occupied cell
  const cand = [];

  // Skin colour of a named koi colour, shaded by brightness b ∈ [0,1], in the current theme.
  // Black fins would vanish on the dark page, so they're drawn in a soft grey there.
  function koiRGB(name, b, fin) {
    const rgb = T.koi[fin && name === "black" ? "finBlack" : name];
    const f = T.koiShade[0] + T.koiShade[1] * b;
    // quantised so similar cells share one cached sprite
    return rgb.map(v => Math.min(255, Math.round(v * f / 6) * 6));
  }

  function rasterKoi() {
    occ.fill(0);
    koiCells = [];
    if (candTag.length !== cols * rows) {
      candTag = new Uint32Array(cols * rows); candSeg = new Uint8Array(cols * rows); candDist = new Float32Array(cols * rows);
      occIdx = new Int32Array(cols * rows);
    }
    for (const sh of koi) {
      // Candidate cells: discs around each spine node, sized to what can reach that far.
      // Much smaller than the bounding box of a curved fish, which is mostly open water.
      const tag = ++tagNo;
      cand.length = 0;
      for (let n = 0; n < N; n++) {
        const node = sh.disp[n], rad = reach(n / (N - 1)) * sh.L + sh.seg * 0.6 + 8;
        const c0 = Math.max(0, Math.floor((node.x - rad) / CW)), c1 = Math.min(cols - 1, Math.floor((node.x + rad) / CW));
        const r0 = Math.max(0, Math.floor((node.y - rad) / CH)), r1 = Math.min(rows - 1, Math.floor((node.y + rad) / CH));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          const dx = (c + 0.5) * CW - node.x, dy = (r + 0.5) * CH - node.y, d2 = dx * dx + dy * dy;
          if (d2 > rad * rad) continue;
          // Keep the nearest node: on a curved body a big front disc can reach cells of the rear.
          if (candTag[i] === tag) { if (d2 < candDist[i]) { candSeg[i] = n; candDist[i] = d2; } continue; }
          candTag[i] = tag; candSeg[i] = n; candDist[i] = d2; cand.push(i);
        }
      }
      for (const i of cand) {
        // occ: 1 = faint outline cell, 2 = solid cell. A solid cell may replace an outline from an
        // earlier koi, so crossing koi don't punch holes in each other.
        if (occ[i] === 2) continue;
        const c = i % cols, r = (i / cols) | 0;
        const cx = (c + 0.5) * CW, cy = (r + 0.5) * CH;
        // The nearest spine segment is close to the node that claimed this cell.
        const lo = candSeg[i] - 3, hi = candSeg[i] + 2;
        const flag = sh.sample(cx, cy, P, lo, hi);
        const ps = P.s, pd = P.d, pnx = P.nx, pny = P.ny, pu = P.u;
        // Deep inside the body: fully covered, no need to test the corners.
        let hits = 4;
        if (!((flag === 1 || flag === 3 || flag === 4) && pu < 0.6)) {
          // Too far out for anything to reach this cell.
          if (!flag && Math.abs(pd) / sh.L > reach(clamp(ps, 0, 1)) + 8 / sh.L) continue;
          hits = 0;
          for (let k = 0; k < 8; k += 2) if (sh.sample((c + SUB[k]) * CW, (r + SUB[k + 1]) * CH, P, lo, hi)) hits++;
          if (!hits || (occ[i] && hits < 3)) continue;
          P.s = ps; P.d = pd; P.nx = pnx; P.ny = pny; P.u = pu;
        }
        const side = P.d >= 0 ? 1 : -1;
        const lambert = (P.nx * side * LX + P.ny * side * LY);
        // stable texture keyed in body space so the pattern rides along with the fish
        const ks = Math.round(P.s * sh.L / CW), kd = Math.round(P.d / CH);
        const hv = hash(ks, kd, sh.id + 3);
        const kind = flag || (P.s > 0.7 ? 5 : 2);   // corners-only hits count as fin edge
        const cell = { c, r, kind, full: hits >= 3, hv, glyph: "", rgb: null };
        if (kind === 5) {
          // tail fin: thin rays fanning out from the tail stalk, each drawn with the glyph closest
          // to its direction, lighter than the body like a real koi's see-through tail
          const ux = P.ny, uy = -P.nx;   // along the spine, toward the tail
          let a = Math.atan2(uy + 0.45 * side * P.ny, ux + 0.45 * side * P.nx);
          if (a < 0) a += Math.PI;
          cell.glyph = "-\\|/"[Math.round(a / (Math.PI / 4)) % 4];
          cell.rgb = koiRGB(sh.variety.base, T.tailShade + 0.15 * lambert, true);
        } else if (kind === 2) {
          // fins: loose strokes in the base colour, no block behind them
          cell.glyph = FIN_GLYPHS[(hv * 97 | 0) % FIN_GLYPHS.length];
          cell.rgb = koiRGB(sh.variety.base, 0.55 + 0.25 * lambert, true);
        } else if (kind !== 4) {
          // body (1) and the dorsal fin along the back (3): rounded shading, light from the top-left,
          // the occasional bright scale catching the light, and the variety's colour patches.
          const u = P.u;
          let b = kind === 3 ? 0.42 + 0.12 * lambert : 0.32 + 0.42 * (1 - u * u) + 0.26 * lambert * u;
          if (hv > 0.95) b += 0.22;
          b = clamp(b + (hv - 0.5) * 0.12, 0.05, 1);
          cell.rgb = koiRGB(sh.colourAt(P.s, P.d), b, false);
          cell.glyph = kind === 3 ? "#" : SCALES[clamp(Math.floor((1 - b) * SCALES.length + (hv - 0.5) * 1.5), 0, SCALES.length - 1)];
        }
        if (occ[i]) koiCells[occIdx[i]] = cell;
        else { occIdx[i] = koiCells.length; koiCells.push(cell); }
        occ[i] = cell.full || kind === 4 ? 2 : 1;
      }
    }
  }

  function render(dt) {
    rasterKoi();
    paint();
  }

  // Draws one complete frame of the pond onto ctx, in the colours of theme T.
  function paint() {
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, W, H);

    // faint cell grid
    ctx.fillStyle = T.grid;
    for (let c = 1; c < cols; c++) ctx.fillRect(c * CW, 0, 1, H);
    for (let r = 1; r < rows; r++) ctx.fillRect(0, r * CH, W, 1);

    // ambient twinkle + wake dots
    // Colour strings are cached per theme in 1% alpha steps; building them per dot is slow.
    const dotStyles = T.dotStyles ||= ramp(T.dot), wakeStyles = T.wakeStyles ||= ramp(T.wake);
    const [wr, wg, wb] = T.wake;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (occ[i]) continue;
      const e = energy[i], ph = ambient[i];
      if (e > 0.04) {
        ctx.fillStyle = wakeStyles[Math.min(75, e * 90 | 0)];
        ctx.fillRect(c * CW + 4, r * CH + 6, 2, 2);
      } else if (ph >= 0) {
        ctx.fillStyle = dotStyles[(8 + 14 * (0.5 + 0.5 * Math.sin(time * (0.4 + (ph % 1)) + ph))) | 0];
        ctx.fillRect(c * CW + 4, r * CH + 6, 2, 2);
      }
    }

    // click ripples
    for (const rp of ripples) {
      const a = Math.max(0, rp.life) * 0.6;
      ctx.fillStyle = `rgba(${wr},${wg},${wb},${a.toFixed(2)})`;
      const steps = Math.max(24, rp.r * 0.6 | 0);
      for (let k = 0; k < steps; k++) {
        const ang = k / steps * TAU;
        const c = Math.floor((rp.x + Math.cos(ang) * rp.r) / CW), r = Math.floor((rp.y + Math.sin(ang) * rp.r * 0.8) / CH);
        if (c >= 0 && c < cols && r >= 0 && r < rows && !occ[r * cols + c]) ctx.fillRect(c * CW + 3, r * CH + 5, 3, 3);
      }
    }

    // food pellets: small round crumbs that fade out if nobody eats them
    for (const p of pellets) {
      const c = Math.floor(p.x / CW), r = Math.floor(p.y / CH);
      if (c < 0 || c >= cols || r < 0 || r >= rows || occ[r * cols + c]) continue;
      const q = Math.round(Math.min(1, p.life / 2) * 6);
      ctx.drawImage(sprite("p" + q, g => {
        const [wr2, wg2, wb2] = T.wake;
        g.fillStyle = `rgba(${wr2},${wg2},${wb2},${(0.25 + 0.75 * q / 6).toFixed(2)})`;
        g.fillText("o", CW / 2, CH / 2 + 1);
      }), c * CW, r * CH, CW, CH);
    }

    // fish
    for (const sc of schools) for (const f of sc.fish) {
      const c = Math.floor(f.x / CW), r = Math.floor(f.y / CH);
      if (c < 0 || c >= cols || r < 0 || r >= rows || occ[r * cols + c]) continue;
      const q = Math.round(Math.min(1, f.glint) * 8);
      // A calm fish is a dash; a startled one (dodging a koi, the cursor or a ripple)
      // wriggles as "~" until it settles. Slanted glyphs read as rain, so none are used.
      const glyph = f.glint > 0.35 ? "~" : "-";
      ctx.drawImage(sprite("f" + q + glyph, g => {
        const [fr, fg, fb] = T.fish;
        g.fillStyle = `rgba(${fr},${fg},${fb},${(0.45 + 0.5 * q / 8).toFixed(2)})`;
        g.fillText(glyph, CW / 2, CH / 2 + 1);
      }), c * CW, r * CH, CW, CH);
    }

    // koi
    for (const cell of koiCells) {
      const x = cell.c * CW, y = cell.r * CH;
      let img;
      if (cell.kind === 4) {
        img = sprite("eye", g => { g.fillStyle = `rgb(${T.eye},${T.eye},${T.eye})`; g.fillRect(1, 1, CW - 1, CH - 1); });
      } else if (cell.kind === 5) {
        const [r, gr, b] = cell.rgb, glyph = cell.glyph;
        // tail fin: just the ray over a barely-there tint, so the water shows through
        img = sprite(`t${r},${gr},${b}${glyph}`, g => {
          g.fillStyle = `rgba(${r},${gr},${b},0.08)`; g.fillRect(1, 1, CW - 1, CH - 1);
          g.fillStyle = `rgba(${r},${gr},${b},0.85)`; g.fillText(glyph, CW / 2, CH / 2 + 1);
        });
      } else if (cell.kind === 2) {
        const [r, gr, b] = cell.rgb, glyph = cell.glyph;
        // fins: a translucent tint of the skin colour with a stroke on top, so they read as
        // thin fins rather than as the little "-" fish swimming around
        img = sprite(`n${r},${gr},${b}${glyph}`, g => {
          g.fillStyle = `rgba(${r},${gr},${b},0.3)`; g.fillRect(1, 1, CW - 1, CH - 1);
          g.fillStyle = `rgba(${r},${gr},${b},0.95)`; g.fillText(glyph, CW / 2, CH / 2 + 1);
        });
      } else if (!cell.full) {
        const glyph = EDGE[(cell.hv * 97 | 0) % EDGE.length];
        img = sprite("e" + glyph, g => { g.fillStyle = T.edge; g.fillText(glyph, CW / 2, CH / 2 + 1); });
      } else {
        const [r, gr, b] = cell.rgb, glyph = cell.glyph;
        img = sprite(`k${r},${gr},${b}${glyph}`, g => {
          g.fillStyle = `rgb(${r},${gr},${b})`;
          g.fillRect(1, 1, CW - 1, CH - 1);
          // dark ink on light scales, light ink on dark ones
          g.fillStyle = 0.3 * r + 0.59 * gr + 0.11 * b > 140 ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.45)";
          g.fillText(glyph, CW / 2, CH / 2 + 1);
        });
      }
      ctx.drawImage(img, x, y, CW, CH);
    }
  }

  // Each distinct cell (shade × glyph × colour) is painted once into a tiny canvas and then
  // blitted; drawImage is far cheaper than fillText for ~1.5k cells a frame.
  // One cache per theme, so switching back and forth doesn't repaint every cell again.
  let sprites = { dark: new Map(), light: new Map() };
  const FONT = `600 9px "Geist Mono", ui-monospace, Menlo, Consolas, monospace`;
  function sprite(key, paint) {
    const cache = sprites[T === THEMES.dark ? "dark" : "light"];
    let s = cache.get(key);
    if (!s) {
      s = document.createElement("canvas");
      s.width = Math.ceil(CW * dpr); s.height = Math.ceil(CH * dpr);
      const g = s.getContext("2d");
      g.scale(dpr, dpr);
      g.font = FONT; g.textAlign = "center"; g.textBaseline = "middle";
      paint(g);
      cache.set(key, s);
    }
    return s;
  }
  const resetSprites = () => { sprites = { dark: new Map(), light: new Map() }; };
  const ramp = ([r, g, b]) => Array.from({ length: 101 }, (_, a) => `rgba(${r},${g},${b},${a / 100})`);

  // ── loop & input ──────────────────────────────────────────────────
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const STEP = 1 / 60;
  let last = performance.now(), raf = 0;

  // Advance by the real frame time (split into ≤1/60 s substeps) so motion is even on
  // 60/120/144 Hz screens alike; a fixed step would move 0 or 1 steps per frame and stutter.
  function frame(now) {
    // Up to 0.25 s per frame is simulated in full, so a slow machine shows choppier motion
    // rather than a slow-motion ocean; longer gaps (a stall, a hidden tab) are dropped.
    const dt = clamp((now - last) / 1000, 0, 0.25);
    last = now;
    const n = Math.max(1, Math.ceil(dt / STEP));
    for (let i = 0; i < n; i++) step(dt / n);
    render(dt);
    raf = requestAnimationFrame(frame);
  }
  function start() {
    cancelAnimationFrame(raf);
    if (reduced.matches) { for (let i = 0; i < 240; i++) step(STEP); render(0); return; }
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  addEventListener("resize", () => { resize(); if (reduced.matches) render(0); });
  addEventListener("pointermove", e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = e.pointerType !== "touch"; }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => { pointer.active = false; });
  addEventListener("pointerdown", e => {
    // Feeding is for the open water: not while reading (ui.js sets --veil as you scroll),
    // and not when clicking a link or button.
    const veil = parseFloat(root.style.getPropertyValue("--veil")) || 0;
    if (reduced.matches || veil > 0.5 || e.target.closest("a, button, main")) return;
    ripples.push({ x: e.clientX, y: e.clientY, r: 4, life: 1 });
    stamp(e.clientX, e.clientY, 3, 0.9);
    // A small handful of food scatters around the click; the koi come over to eat it.
    // Capped, so frantic clicking doesn't turn the pond into a feeding frenzy.
    for (let i = 0; i < 4 && pellets.length < 12; i++) {
      const a = rand(0, TAU), sp = rand(10, 40);
      pellets.push({ x: e.clientX + rand(-6, 6), y: e.clientY + rand(-6, 6), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(18, 24) });
    }
    for (const sc of schools) for (const f of sc.fish) {
      const dx = f.x - e.clientX, dy = f.y - e.clientY, d = Math.hypot(dx, dy);
      if (d < 160 && d > 0) { const k = (1 - d / 160) * 220; f.vx += dx / d * k; f.vy += dy / d * k; f.glint = 1; }
    }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelAnimationFrame(raf); else start(); });
  reduced.addEventListener("change", start);

  resize();
  start();
  // ?debug exposes the simulation for inspection from devtools.
  if (location.search.includes("debug")) window.__ocean = { get koi() { return koi; }, get pellets() { return pellets; }, get schools() { return schools; }, step, render, stop: () => cancelAnimationFrame(raf) };
  // Sprites painted before the webfont arrived used the fallback face; repaint them.
  document.fonts?.load('600 9px "Geist Mono"').then(() => { resetSprites(); if (reduced.matches) render(0); });
})();

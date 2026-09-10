/* ===================================================================
 * Lightfield — monochrome ray-traced background engine
 *
 * A black & white scene rendered on a fixed canvas behind the page:
 *   - volumetric light beams sweeping from above (scroll parallax)
 *   - a genuinely ray-traced chrome sphere in the hero, per-pixel
 *     shaded (lambert + specular + fresnel + studio env band) with a
 *     floor reflection; its light follows the mouse and scroll
 *   - soft white bokeh + twinkling dust
 * Also owns: scroll progress bar, cursor light, film grain layer, and
 * the IntersectionObserver-based .reveal scroll animations.
 *
 * Plain JS on purpose — runs outside the React build pipeline.
 * =================================================================== */

(function () {
  'use strict';

  var TAU = Math.PI * 2;

  var REDUCED = false;
  var FINE_POINTER = true;
  try {
    REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    FINE_POINTER = window.matchMedia('(pointer: fine)').matches;
  } catch (e) { /* very old browsers: keep defaults */ }

  // Signals to CSS that this script is alive; .reveal hiding is scoped
  // to this class so content is never invisible if the script fails.
  document.documentElement.className += ' orbjs';

  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------------- scroll reveal ---------------- */

  var io = null;
  if (!REDUCED && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.isIntersecting) {
          revealNow(entry.target);
          io.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -48px 0px' });
  }

  function revealNow(el) {
    el.classList.add('in-view');
    // Stagger delays are set inline from JSX; clear them once revealed so
    // they don't lag hover/other transitions afterwards.
    if (el.style.transitionDelay) {
      setTimeout(function () { el.style.transitionDelay = '0s'; }, 1200);
    }
  }

  function scanReveals() {
    var els = document.querySelectorAll('.reveal:not([data-rvl])');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.setAttribute('data-rvl', '1');
      if (io) io.observe(el);
      else revealNow(el);
    }
  }

  // React renders after an async fetch — watch the root for new .reveal nodes.
  var root = document.getElementById('root');
  if (root && 'MutationObserver' in window) {
    new MutationObserver(scanReveals).observe(root, { childList: true, subtree: true });
  }
  scanReveals();

  /* ---------------- injected chrome ---------------- */

  var canvas = document.createElement('canvas');
  canvas.id = 'orb-field';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  var grain = document.createElement('div');
  grain.id = 'film-grain';
  grain.setAttribute('aria-hidden', 'true');
  document.body.appendChild(grain);

  var vignette = document.createElement('div');
  vignette.id = 'bg-vignette';
  vignette.setAttribute('aria-hidden', 'true');
  document.body.appendChild(vignette);

  var progress = document.createElement('div');
  progress.id = 'scroll-progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.appendChild(progress);

  var glow = null;
  if (FINE_POINTER && !REDUCED) {
    glow = document.createElement('div');
    glow.id = 'cursor-glow';
    glow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glow);
  }

  /* ---------------- beam sprite ----------------
     Soft volumetric shaft: bright at the source fading along its length,
     feathered across its width (built once, drawn rotated per beam). */

  function makeBeamSprite() {
    var bw = 256, bl = 1024;
    var bc = document.createElement('canvas');
    bc.width = bw;
    bc.height = bl;
    var bx = bc.getContext('2d');
    var along = bx.createLinearGradient(0, 0, 0, bl);
    along.addColorStop(0, 'rgba(255,255,255,0.9)');
    along.addColorStop(0.7, 'rgba(255,255,255,0.14)');
    along.addColorStop(1, 'rgba(255,255,255,0)');
    bx.fillStyle = along;
    bx.fillRect(0, 0, bw, bl);
    bx.globalCompositeOperation = 'destination-in';
    var across = bx.createLinearGradient(0, 0, bw, 0);
    across.addColorStop(0, 'rgba(0,0,0,0)');
    across.addColorStop(0.5, 'rgba(0,0,0,1)');
    across.addColorStop(1, 'rgba(0,0,0,0)');
    bx.fillStyle = across;
    bx.fillRect(0, 0, bw, bl);
    return bc;
  }
  var beamSprite = makeBeamSprite();

  /* ---------------- particle orb ----------------
     A big orb assembled from thousands of tiny dots: points distributed
     on a sphere via a fibonacci spiral, slowly rotating, lit from the
     upper-left-front. Back-side dots stay faintly visible so the whole
     thing reads as a see-through cloud of little balls. */

  var ORB_N = 0;
  var orbPts = null; // xyz triplets on the unit sphere
  var orbTw = null;  // per-dot twinkle frequency
  var orbPh = null;  // per-dot twinkle phase
  var orbSp = null;  // per-dot dispersal factor (how far it flies on expand)
  var orbRot = 0;
  var orbRotX = 0;   // eased mouse steer (yaw)
  var orbTilt = 0.42;
  var lastT = 0;

  function buildOrb() {
    var n = W < 640 ? 1400 : 2800;
    orbPts = new Float32Array(n * 3);
    orbTw = new Float32Array(n);
    orbPh = new Float32Array(n);
    orbSp = new Float32Array(n);
    var ga = Math.PI * (3 - Math.sqrt(5)); // golden angle
    for (var i = 0; i < n; i++) {
      var y = 1 - (i / (n - 1)) * 2;
      var r = Math.sqrt(Math.max(0, 1 - y * y));
      var th = ga * i;
      orbPts[i * 3] = Math.cos(th) * r;
      orbPts[i * 3 + 1] = y;
      orbPts[i * 3 + 2] = Math.sin(th) * r;
      orbTw[i] = rand(0.6, 2.2);
      orbPh[i] = rand(0, TAU);
      orbSp[i] = rand(0, 1);
    }
    ORB_N = n;
  }

  /* ---------------- scene ---------------- */

  var W = 0, H = 0;
  var beams = [], bokeh = [], dust = [];

  function buildField() {
    buildOrb();
    beams = [];
    bokeh = [];
    dust = [];
    var small = W < 640;
    var nBeams = small ? 3 : 5;
    var nBokeh = small ? 3 : 5;
    var nDust = small ? 22 : 44;
    var scale = clamp(Math.min(W, H) / 900, 0.55, 1.25);
    var diag = Math.sqrt(W * W + H * H);

    for (var b = 0; b < nBeams; b++) {
      beams.push({
        ax: rand(-0.05, 1.05) * W,
        angle: rand(0.3, 0.55),          // lean, same direction = light through blinds
        w: rand(90, 240) * scale,
        len: diag * 1.25,
        alpha: rand(0.035, 0.07),
        swayA: rand(0.015, 0.045),
        f: rand(0.02, 0.06),
        p: rand(0, TAU),
        depth: rand(0.1, 0.5)
      });
    }

    for (var i = 0; i < nBokeh; i++) {
      bokeh.push({
        x: rand(0, W),
        y: rand(-H * 0.2, H * 1.2),
        r: rand(140, 320) * scale,
        depth: rand(0.15, 0.85),
        alpha: rand(0.03, 0.065),
        a1: rand(30, 100) * scale,
        a2: rand(24, 80) * scale,
        f1: rand(0.04, 0.12),
        f2: rand(0.03, 0.1),
        p1: rand(0, TAU),
        p2: rand(0, TAU),
        ox: 0,
        oy: 0
      });
    }

    for (var d = 0; d < nDust; d++) {
      dust.push({
        x: rand(0, W),
        y: rand(0, H),
        r: rand(0.6, 1.7),
        depth: rand(0.25, 1),
        v: rand(2, 8),
        tw: rand(0.4, 1.4),
        tp: rand(0, TAU)
      });
    }
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    var dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildField();
    if (REDUCED) drawFrame(0, 0);
  }

  /* ---------------- input state ---------------- */

  var scrollTarget = window.pageYOffset || 0;
  var scrollEased = scrollTarget;
  var lastEased = scrollTarget;
  var velocity = 0;
  var mouseX = -1e4, mouseY = -1e4;
  var gx = -1e4, gy = -1e4;

  function docHeight() {
    var b = document.body, d = document.documentElement;
    return Math.max(b.scrollHeight, d.scrollHeight, b.offsetHeight, d.offsetHeight);
  }

  function updateProgress() {
    var max = docHeight() - H;
    var p = max > 0 ? clamp(scrollTarget / max, 0, 1) : 0;
    progress.style.transform = 'scaleX(' + p + ')';
  }

  window.addEventListener('scroll', function () {
    scrollTarget = window.pageYOffset || document.documentElement.scrollTop || 0;
    updateProgress();
  }, { passive: true });

  window.addEventListener('resize', function () {
    resize();
    updateProgress();
  });

  if (FINE_POINTER && !REDUCED) {
    window.addEventListener('mousemove', function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }, { passive: true });
    document.addEventListener('mouseleave', function () {
      mouseX = -1e4;
      mouseY = -1e4;
    });
  }

  /* ---------------- render loop ---------------- */

  function drawFrame(t, energy) {
    ctx.clearRect(0, 0, W, H);
    var i;

    // --- light shafts (additive) ---
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < beams.length; i++) {
      var bm = beams[i];
      ctx.save();
      ctx.translate(bm.ax - scrollEased * bm.depth * 0.18, -70);
      ctx.rotate(bm.angle + Math.sin(t * bm.f + bm.p) * bm.swayA);
      ctx.globalAlpha = bm.alpha * (1 + energy * 0.8);
      ctx.drawImage(beamSprite, -bm.w / 2, 0, bm.w, bm.len);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // --- bokeh (soft white light patches) ---
    for (i = 0; i < bokeh.length; i++) {
      var o = bokeh[i];
      var px = o.x + Math.sin(t * o.f1 + o.p1) * o.a1;
      var py = o.y + Math.cos(t * o.f2 + o.p2) * o.a2 - scrollEased * o.depth * 0.4;
      var span = H + o.r * 4;
      py = ((py + o.r * 2) % span + span) % span - o.r * 2;

      var txf = 0, tyf = 0;
      if (FINE_POINTER) {
        var mdx = px - mouseX, mdy = py - mouseY;
        var dist = Math.sqrt(mdx * mdx + mdy * mdy);
        var reach = 240 + o.r * 0.4;
        if (dist < reach && dist > 0.001) {
          var force = 1 - dist / reach;
          force = force * force * 60 * (1 - o.depth * 0.6);
          txf = (mdx / dist) * force;
          tyf = (mdy / dist) * force;
        }
      }
      o.ox = lerp(o.ox, txf, 0.06);
      o.oy = lerp(o.oy, tyf, 0.06);
      px += o.ox;
      py += o.oy;

      var alpha = o.alpha * (1 + energy * 0.8);
      var g = ctx.createRadialGradient(px, py, 0, px, py, o.r);
      g.addColorStop(0, 'rgba(255,255,255,' + alpha + ')');
      g.addColorStop(0.55, 'rgba(255,255,255,' + alpha * 0.3 + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, o.r, 0, TAU);
      ctx.fill();
    }

    // --- dust ---
    var band = H + 20;
    for (i = 0; i < dust.length; i++) {
      var d = dust[i];
      var dy = d.y - t * d.v - scrollEased * d.depth * 0.6;
      dy = ((dy % band) + band) % band - 10;
      var twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * d.tw + d.tp));
      ctx.fillStyle = 'rgba(235,235,240,' + 0.38 * twinkle + ')';
      ctx.fillRect(d.x, dy, d.r, d.r);
    }

    // --- particle orb: scroll-choreographed ---
    // Scrubbed to scroll position: over the first ~1.1 viewport heights the
    // orb EXPANDS toward the center of the screen while its dots disperse
    // outward (each by its own amount) and dissolve; scrolling back up
    // re-assembles it. sp 0 = intact orb, sp 1 = fully dispersed.
    var sp = clamp(scrollEased / (H * 1.1), 0, 1);
    var ease = sp * sp * (3 - 2 * sp); // smoothstep
    var fadeMul = 1 - clamp((sp - 0.55) / 0.45, 0, 1);
    fadeMul *= fadeMul;

    var srBase = clamp(Math.min(W, H) * 0.24, 90, 260);
    var sr = srBase * (1 + ease * 2.1);
    var sx = lerp(W < 640 ? W * 0.78 : W * 0.75, W * 0.55, ease);
    var sy = H * (0.42 + ease * 0.08) + Math.sin(t * 0.4) * 6;

    if (orbPts && fadeMul > 0.004) {
      // faint halo so the cloud reads as one body
      var hg = ctx.createRadialGradient(sx, sy, sr * 0.3, sx, sy, sr * 1.9);
      hg.addColorStop(0, 'rgba(255,255,255,' + 0.04 * fadeMul + ')');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(sx, sy, sr * 1.9, 0, TAU);
      ctx.fill();

      ctx.globalCompositeOperation = 'source-over';

      // the cursor gently steers the rotation and tilt
      var mxN = 0, myN = 0;
      if (FINE_POINTER && mouseX > -1e3) {
        mxN = mouseX / W - 0.5;
        myN = mouseY / H - 0.5;
      }
      orbRotX = lerp(orbRotX, mxN * 0.9, 0.03);
      orbTilt = lerp(orbTilt, 0.42 + myN * 0.4, 0.03);

      var ang = orbRot + orbRotX;
      var cA = Math.cos(ang), sA = Math.sin(ang);
      var cT = Math.cos(orbTilt), sT = Math.sin(orbTilt);
      var L0 = -0.42, L1 = -0.5, L2 = 0.76; // key light, upper-left-front
      var dotGrow = 1 + ease * 0.5;

      ctx.fillStyle = '#fff';
      for (i = 0; i < ORB_N; i++) {
        var i3 = i * 3;
        var x0 = orbPts[i3], y0 = orbPts[i3 + 1], z0 = orbPts[i3 + 2];
        // yaw around Y, then tilt around X
        var x1 = x0 * cA + z0 * sA;
        var z1 = z0 * cA - x0 * sA;
        var y2 = y0 * cT - z1 * sT;
        var z2 = y0 * sT + z1 * cT;

        // breathing wobble + per-dot dispersal as the orb expands
        var wob = 1 + 0.012 * Math.sin(t * orbTw[i] + orbPh[i]) + ease * orbSp[i] * 0.7;
        var px2 = sx + x1 * sr * wob;
        var py2 = sy + y2 * sr * wob;

        var front = z2 * 0.5 + 0.5;
        var ndl = x1 * L0 + y2 * L1 + z2 * L2;
        var diff = ndl > 0 ? ndl : 0;
        var a = (0.045 + 0.6 * diff * diff + 0.16 * front) * fadeMul;
        var size = (0.7 + 1.5 * front) * dotGrow;

        ctx.globalAlpha = a > 1 ? 1 : a;
        ctx.fillRect(px2, py2, size, size);
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function tick(now) {
    var t = now / 1000;
    var dt = lastT ? t - lastT : 0.016;
    if (dt > 0.1) dt = 0.016;
    lastT = t;

    scrollEased = lerp(scrollEased, scrollTarget, 0.07);
    velocity = lerp(velocity, scrollEased - lastEased, 0.12);
    lastEased = scrollEased;
    var energy = clamp(Math.abs(velocity) / 40, 0, 1);

    // the orb spins slowly, a touch faster while scrolling
    orbRot += dt * (0.12 + energy * 0.5);

    if (glow) {
      gx = lerp(gx, mouseX, 0.14);
      gy = lerp(gy, mouseY, 0.14);
      glow.style.transform = 'translate(' + (gx - 300) + 'px,' + (gy - 300) + 'px)';
    }

    drawFrame(t, energy);
    requestAnimationFrame(tick);
  }

  resize();
  updateProgress();

  if (REDUCED) {
    // static scene, no motion — progress bar still tracks scroll
    drawFrame(0, 0);
  } else {
    requestAnimationFrame(tick);
  }
})();

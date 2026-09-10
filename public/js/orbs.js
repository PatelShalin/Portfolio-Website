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

  /* ---------------- ray-traced sphere ----------------
     Orthographic camera at +z looking at a unit sphere. Per pixel:
     lambert diffuse, sharp + broad specular, fresnel rim, and a
     reflected studio "horizon band" — a dark chrome ball in a void. */

  var SPH_RES = 224;
  var sphCanvas = document.createElement('canvas');
  var sphRefl = document.createElement('canvas');
  var sphLx = 99, sphLy = 99; // last rendered light dir (forces first render)

  function renderSphere(lx, ly) {
    var s = SPH_RES;
    var len = Math.sqrt(lx * lx + ly * ly + 0.66 * 0.66);
    var L0 = lx / len, L1 = ly / len, L2 = 0.66 / len;

    sphCanvas.width = s;
    sphCanvas.height = s;
    var cx = sphCanvas.getContext('2d');
    var img = cx.createImageData(s, s);
    var data = img.data;

    for (var j = 0; j < s; j++) {
      for (var i = 0; i < s; i++) {
        var idx = (j * s + i) * 4;
        var x = (i + 0.5) / s * 2 - 1;
        var y = (j + 0.5) / s * 2 - 1;
        var r2 = x * x + y * y;
        if (r2 > 1) { data[idx + 3] = 0; continue; }

        var z = Math.sqrt(1 - r2);
        var ndl = x * L0 + y * L1 + z * L2;
        var diffuse = ndl > 0 ? ndl : 0;

        // view reflection r = 2(n·v)n - v, v = (0,0,1)
        var rx = 2 * z * x, ry = 2 * z * y, rz = 2 * z * z - 1;
        var rdl = rx * L0 + ry * L1 + rz * L2;
        var spec = rdl > 0 ? Math.pow(rdl, 120) : 0;
        var gloss = rdl > 0 ? Math.pow(rdl, 16) : 0;
        var fres = Math.pow(1 - z, 2.8);

        // reflected studio horizon band
        var bt = (ry + 0.18) / 0.32;
        var band = Math.exp(-bt * bt);

        var v = 0.015
          + diffuse * 0.05
          + band * (0.05 + 0.30 * fres)
          + fres * 0.24
          + gloss * 0.10
          + spec * 0.85;
        if (v > 1) v = 1;
        var val = Math.round(v * 255);
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;

        var edge = (1 - Math.sqrt(r2)) * s * 0.7; // anti-aliased rim
        data[idx + 3] = Math.round(255 * clamp(edge, 0, 1));
      }
    }
    cx.putImageData(img, 0, 0);

    // floor reflection: flipped copy fading out quickly
    sphRefl.width = s;
    sphRefl.height = s;
    var rc = sphRefl.getContext('2d');
    rc.save();
    rc.translate(0, s);
    rc.scale(1, -1);
    rc.drawImage(sphCanvas, 0, 0);
    rc.restore();
    rc.globalCompositeOperation = 'destination-in';
    var fade = rc.createLinearGradient(0, 0, 0, s * 0.5);
    fade.addColorStop(0, 'rgba(0,0,0,0.32)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    rc.fillStyle = fade;
    rc.fillRect(0, 0, s, s);

    sphLx = lx;
    sphLy = ly;
  }

  /* ---------------- scene ---------------- */

  var W = 0, H = 0;
  var beams = [], bokeh = [], dust = [];

  function buildField() {
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
  var frame = 0;

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

  function sphereLight() {
    // key light upper-left, nudged by the cursor
    var lx = -0.5, ly = -0.62;
    if (FINE_POINTER && mouseX > -1e3) {
      lx += (mouseX / W - 0.5) * 0.7;
      ly += (mouseY / H - 0.5) * 0.5;
    }
    return [clamp(lx, -1.2, 0.35), clamp(ly, -1.15, 0.2)];
  }

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

    // --- ray-traced sphere (hero scene, scrolls away with the page) ---
    var sr = clamp(Math.min(W, H) * 0.21, 80, 225);
    var sx = W < 640 ? W * 0.78 : W * 0.75;
    var sy = H * 0.42 - scrollEased * 0.55 + Math.sin(t * 0.45) * 7;

    if (sy > -sr * 2.5) {
      // halo behind the sphere
      var hg = ctx.createRadialGradient(sx, sy, sr * 0.4, sx, sy, sr * 2.3);
      hg.addColorStop(0, 'rgba(255,255,255,0.05)');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(sx, sy, sr * 2.3, 0, TAU);
      ctx.fill();

      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(sphCanvas, sx - sr, sy - sr, sr * 2, sr * 2);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(sphRefl, sx - sr, sy + sr + 2, sr * 2, sr * 2);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function tick(now) {
    var t = now / 1000;
    frame++;

    scrollEased = lerp(scrollEased, scrollTarget, 0.07);
    velocity = lerp(velocity, scrollEased - lastEased, 0.12);
    lastEased = scrollEased;
    var energy = clamp(Math.abs(velocity) / 40, 0, 1);

    // re-trace the sphere only when its light has moved enough
    if (frame % 2 === 0) {
      var L = sphereLight();
      if (Math.abs(L[0] - sphLx) + Math.abs(L[1] - sphLy) > 0.012) {
        renderSphere(L[0], L[1]);
      }
    }

    if (glow) {
      gx = lerp(gx, mouseX, 0.14);
      gy = lerp(gy, mouseY, 0.14);
      glow.style.transform = 'translate(' + (gx - 300) + 'px,' + (gy - 300) + 'px)';
    }

    drawFrame(t, energy);
    requestAnimationFrame(tick);
  }

  renderSphere(-0.5, -0.62);
  resize();
  updateProgress();

  if (REDUCED) {
    // static scene, no motion — progress bar still tracks scroll
    drawFrame(0, 0);
  } else {
    requestAnimationFrame(tick);
  }
})();

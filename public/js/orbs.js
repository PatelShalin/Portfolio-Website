/* ===================================================================
 * Orb Field — ambient background engine
 *
 * Glowing gradient orbs drifting on a fixed canvas behind the page:
 *   - depth-based parallax while scrolling
 *   - orbs energize + stretch with scroll velocity
 *   - gentle mouse repulsion (fine pointers only)
 *   - twinkling stardust layer
 * Also owns: scroll progress bar, cursor glow, and the
 * IntersectionObserver-based .reveal scroll animations.
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

  /* ---------------- orb + dust field ---------------- */

  // violet / cyan / pink / blue, with a rare amber ember
  var PALETTE = [
    { h: 262, s: 88, l: 62, w: 3 },
    { h: 192, s: 95, l: 58, w: 3 },
    { h: 322, s: 86, l: 62, w: 2 },
    { h: 218, s: 92, l: 62, w: 2 },
    { h: 30,  s: 95, l: 60, w: 1 }
  ];

  function pickColor() {
    var total = 0, i;
    for (i = 0; i < PALETTE.length; i++) total += PALETTE[i].w;
    var roll = Math.random() * total;
    for (i = 0; i < PALETTE.length; i++) {
      roll -= PALETTE[i].w;
      if (roll <= 0) return PALETTE[i];
    }
    return PALETTE[0];
  }

  var W = 0, H = 0;
  var orbs = [], dust = [];

  function buildField() {
    orbs = [];
    dust = [];
    var small = W < 640;
    var nOrbs = small ? 7 : 11;
    var nDust = small ? 34 : 70;
    var scale = clamp(Math.min(W, H) / 900, 0.55, 1.25);

    for (var i = 0; i < nOrbs; i++) {
      var c = pickColor();
      // first three orbs are pinned inside the initial viewport so the
      // hero is never empty on load; the rest spread through the band
      var seeded = i < 3;
      orbs.push({
        x: seeded ? rand(W * i / 3, W * (i + 1) / 3) : rand(0, W),
        y: seeded ? rand(H * 0.08, H * 0.85) : rand(-H * 0.25, H * 1.25),
        r: rand(130, 330) * scale,
        depth: rand(0.15, 0.9),
        hue: c.h, sat: c.s, lum: c.l,
        alpha: rand(0.13, 0.26),
        a1: rand(30, 110) * scale,
        a2: rand(24, 84) * scale,
        f1: rand(0.05, 0.16),
        f2: rand(0.04, 0.14),
        p1: rand(0, TAU),
        p2: rand(0, TAU),
        hp: rand(0, TAU),
        ox: 0,
        oy: 0
      });
    }
    // draw far (shallow-depth) orbs first
    orbs.sort(function (a, b) { return a.depth - b.depth; });

    for (var j = 0; j < nDust; j++) {
      dust.push({
        x: rand(0, W),
        y: rand(0, H),
        r: rand(0.6, 1.9),
        depth: rand(0.25, 1),
        v: rand(2, 9),
        tw: rand(0.4, 1.6),
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
    ctx.globalCompositeOperation = 'lighter';

    var i;
    for (i = 0; i < orbs.length; i++) {
      var o = orbs[i];

      var px = o.x + Math.sin(t * o.f1 + o.p1) * o.a1;
      var py = o.y + Math.cos(t * o.f2 + o.p2) * o.a2 - scrollEased * o.depth * 0.42;

      // wrap vertically through an extended band so orbs recycle while scrolling
      var span = H + o.r * 4;
      py = ((py + o.r * 2) % span + span) % span - o.r * 2;

      // eased mouse repulsion
      var txf = 0, tyf = 0;
      if (FINE_POINTER) {
        var mdx = px - mouseX, mdy = py - mouseY;
        var dist = Math.sqrt(mdx * mdx + mdy * mdy);
        var reach = 260 + o.r * 0.4;
        if (dist < reach && dist > 0.001) {
          var force = 1 - dist / reach;
          force = force * force * 70 * (1 - o.depth * 0.6);
          txf = (mdx / dist) * force;
          tyf = (mdy / dist) * force;
        }
      }
      o.ox = lerp(o.ox, txf, 0.06);
      o.oy = lerp(o.oy, tyf, 0.06);
      px += o.ox;
      py += o.oy;

      var hue = o.hue + Math.sin(t * 0.07 + o.hp) * 16;
      var alpha = o.alpha * (1 + energy * 0.9);
      var radius = o.r * (1 + energy * 0.1);

      ctx.save();
      ctx.translate(px, py);
      ctx.scale(1, 1 + energy * 0.35); // stretch with scroll speed

      // gradient lives in the translated/scaled space so the stretch applies to it too
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      g.addColorStop(0, 'hsla(' + hue + ',' + o.sat + '%,' + o.lum + '%,' + alpha + ')');
      g.addColorStop(0.5, 'hsla(' + hue + ',' + o.sat + '%,' + (o.lum - 8) + '%,' + alpha * 0.35 + ')');
      g.addColorStop(1, 'hsla(' + hue + ',' + o.sat + '%,' + o.lum + '%,0)');

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // stardust
    var band = H + 20;
    for (i = 0; i < dust.length; i++) {
      var d = dust[i];
      var dy = d.y - t * d.v - scrollEased * d.depth * 0.6;
      dy = ((dy % band) + band) % band - 10;
      var twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * d.tw + d.tp));
      ctx.fillStyle = 'rgba(220,230,255,' + 0.5 * twinkle + ')';
      ctx.fillRect(d.x, dy, d.r, d.r);
    }
  }

  function tick(now) {
    var t = now / 1000;

    scrollEased = lerp(scrollEased, scrollTarget, 0.07);
    velocity = lerp(velocity, scrollEased - lastEased, 0.12);
    lastEased = scrollEased;
    var energy = clamp(Math.abs(velocity) / 40, 0, 1);

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
    // static nebula, no motion — progress bar still tracks scroll
    drawFrame(0, 0);
  } else {
    requestAnimationFrame(tick);
  }
})();

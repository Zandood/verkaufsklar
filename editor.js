/* Non-destructive photo editor: rotate, crop (free / fixed ratios), brightness, contrast,
 * saturation, warmth, auto-enhance. Editor.open(originalBlob, params) -> Promise<{blob, params}|null> */
(function () {
  const $ = (id) => document.getElementById(id);
  const DEFAULTS = () => ({ rot: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, bright: 0, contrast: 0, sat: 0, warm: 0 });
  const PREVIEW_MAX = 1400;

  let src = null;          // ImageBitmap/HTMLImageElement of original
  let params = DEFAULTS();
  let resolveFn = null;
  let tab = 'adjust';
  let aspect = 'free';
  let rotatedPreview = null; // canvas: rotated, uncropped, preview scale
  let renderQueued = false;

  async function loadImage(blob) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (_) { /* fall through */ }
    }
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = rej;
      im.src = url;
    });
  }
  const dims = (im) => ({ w: im.width || im.naturalWidth, h: im.height || im.naturalHeight });

  function rotatedCanvas(im, rot, maxSide) {
    const { w, h } = dims(im);
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const sw = Math.round(w * scale), sh = Math.round(h * scale);
    const swap = rot % 180 !== 0;
    const c = document.createElement('canvas');
    c.width = swap ? sh : sw; c.height = swap ? sw : sh;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(im, -sw / 2, -sh / 2, sw, sh);
    return c;
  }

  function applyAdjust(ctx, w, h, p) {
    if (!p.bright && !p.contrast && !p.sat && !p.warm) return;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const c = 1 + p.contrast / 100;            // 0..2
    const b = p.bright * 1.28;                 // -128..128
    const s = 1 + p.sat / 100;                 // 0..2
    const wr = p.warm * 0.3, wb = -p.warm * 0.3;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], bl = d[i + 2];
      r = (r - 128) * c + 128 + b; g = (g - 128) * c + 128 + b; bl = (bl - 128) * c + 128 + b;
      const l = 0.299 * r + 0.587 * g + 0.114 * bl;
      r = l + (r - l) * s + wr; g = l + (g - l) * s; bl = l + (bl - l) * s + wb;
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i + 2] = bl < 0 ? 0 : bl > 255 ? 255 : bl;
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Render full pipeline to a new canvas at given max side. */
  function renderFinal(im, p, maxSide) {
    // maxSide limits the long edge of the *cropped* output, so cropping doesn't throw away resolution.
    const { w: iw, h: ih } = dims(im);
    const swap = p.rot % 180 !== 0;
    const cropLong = Math.max(p.crop.w * (swap ? ih : iw), p.crop.h * (swap ? iw : ih));
    const k = Math.min(1, maxSide / Math.max(1, cropLong));
    const rc = rotatedCanvas(im, p.rot, Math.max(iw, ih) * k);
    const cx = Math.round(p.crop.x * rc.width), cy = Math.round(p.crop.y * rc.height);
    const cw = Math.max(1, Math.round(p.crop.w * rc.width)), ch = Math.max(1, Math.round(p.crop.h * rc.height));
    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(rc, cx, cy, cw, ch, 0, 0, cw, ch);
    applyAdjust(ctx, cw, ch, p);
    return out;
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  function render() {
    const canvas = $('edCanvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!rotatedPreview) rotatedPreview = rotatedCanvas(src, params.rot, PREVIEW_MAX);
    const rp = rotatedPreview;
    if (tab === 'crop') {
      canvas.width = rp.width; canvas.height = rp.height;
      ctx.drawImage(rp, 0, 0);
      applyAdjust(ctx, rp.width, rp.height, params);
      fitCanvas();
      positionCrop();
    } else {
      const { x, y, w, h } = params.crop;
      const cw = Math.max(1, Math.round(w * rp.width)), ch = Math.max(1, Math.round(h * rp.height));
      canvas.width = cw; canvas.height = ch;
      ctx.drawImage(rp, Math.round(x * rp.width), Math.round(y * rp.height), cw, ch, 0, 0, cw, ch);
      applyAdjust(ctx, cw, ch, params);
      fitCanvas();
    }
  }

  function fitCanvas() {
    const stage = $('edStage');
    const canvas = $('edCanvas');
    const pad = 24;
    const sw = stage.clientWidth - pad * 2, sh = stage.clientHeight - pad * 2;
    const k = Math.min(sw / canvas.width, sh / canvas.height);
    canvas.style.width = Math.floor(canvas.width * k) + 'px';
    canvas.style.height = Math.floor(canvas.height * k) + 'px';
  }

  function canvasRect() {
    const stage = $('edStage').getBoundingClientRect();
    const r = $('edCanvas').getBoundingClientRect();
    return { left: r.left - stage.left, top: r.top - stage.top, width: r.width, height: r.height };
  }

  function positionCrop() {
    const el = $('edCrop');
    el.classList.toggle('hidden', tab !== 'crop');
    if (tab !== 'crop') return;
    const r = canvasRect();
    const c = params.crop;
    el.style.left = r.left + c.x * r.width + 'px';
    el.style.top = r.top + c.y * r.height + 'px';
    el.style.width = c.w * r.width + 'px';
    el.style.height = c.h * r.height + 'px';
  }

  function setAspect(a) {
    aspect = a;
    if (a === 'free' || !rotatedPreview) return;
    const ratio = parseFloat(a);
    const W = rotatedPreview.width, H = rotatedPreview.height;
    // largest centered box with ratio (in pixels), then normalize
    let pw = W, ph = W / ratio;
    if (ph > H) { ph = H; pw = H * ratio; }
    params.crop = { x: (W - pw) / 2 / W, y: (H - ph) / 2 / H, w: pw / W, h: ph / H };
    positionCrop();
  }

  // --- crop dragging
  let drag = null;
  function onPointerDown(e) {
    if (tab !== 'crop') return;
    const handle = e.target.dataset && e.target.dataset.h;
    const isBox = e.target.id === 'edCrop';
    if (!handle && !isBox) return;
    e.preventDefault();
    drag = { mode: handle || 'move', sx: e.clientX, sy: e.clientY, start: { ...params.crop }, rect: canvasRect() };
    e.target.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.rect.width;
    const dy = (e.clientY - drag.sy) / drag.rect.height;
    const s = drag.start;
    let { x, y, w, h } = s;
    const MIN = 0.05;
    if (drag.mode === 'move') {
      x = Math.min(Math.max(0, s.x + dx), 1 - s.w);
      y = Math.min(Math.max(0, s.y + dy), 1 - s.h);
    } else {
      let left = s.x, top = s.y, right = s.x + s.w, bottom = s.y + s.h;
      if (drag.mode.includes('l')) left = Math.min(Math.max(0, s.x + dx), right - MIN);
      if (drag.mode.includes('r')) right = Math.max(Math.min(1, s.x + s.w + dx), left + MIN);
      if (drag.mode.includes('t')) top = Math.min(Math.max(0, s.y + dy), bottom - MIN);
      if (drag.mode.includes('b')) bottom = Math.max(Math.min(1, s.y + s.h + dy), top + MIN);
      x = left; y = top; w = right - left; h = bottom - top;
      if (aspect !== 'free' && rotatedPreview) {
        // keep ratio: adjust height from width (pixel space)
        const ratio = parseFloat(aspect);
        const W = rotatedPreview.width, H = rotatedPreview.height;
        let hp = (w * W) / ratio / H;
        if (drag.mode.includes('t')) { y = bottom - hp; }
        if (y < 0) { y = 0; hp = bottom - 0; w = (hp * H * ratio) / W; if (drag.mode.includes('l')) x = right - w; }
        if (y + hp > 1) { hp = 1 - y; w = (hp * H * ratio) / W; if (drag.mode.includes('l')) x = right - w; }
        h = hp;
      }
    }
    params.crop = { x, y, w, h };
    positionCrop();
  }
  function onPointerUp() { drag = null; }

  function autoEnhance() {
    const c = rotatedCanvas(src, params.rot, 400);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const hist = new Array(256).fill(0);
    let n = 0;
    for (let i = 0; i < d.length; i += 4) { hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++; n++; }
    const pct = (p) => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * p) return i; } return 255; };
    const lo = pct(0.01), hi = pct(0.99);
    const cf = Math.min(1.6, Math.max(1, 230 / Math.max(1, hi - lo)));
    const mid = (lo + hi) / 2;
    params.contrast = Math.round((cf - 1) * 100);
    params.bright = Math.round(Math.max(-40, Math.min(40, (128 - mid) * cf / 1.28 * 0.7)));
    params.sat = 12;
    syncSliders();
    scheduleRender();
  }

  function syncSliders() {
    [['edBright', 'vBright', 'bright'], ['edContrast', 'vContrast', 'contrast'], ['edSat', 'vSat', 'sat'], ['edWarm', 'vWarm', 'warm']].forEach(([s, v, k]) => {
      $(s).value = params[k]; $(v).textContent = params[k];
    });
  }

  function setTab(t) {
    tab = t;
    document.querySelectorAll('#editor [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    $('tab-adjust').classList.toggle('hidden', t !== 'adjust');
    $('tab-crop').classList.toggle('hidden', t !== 'crop');
    scheduleRender();
  }

  function rotate(delta) {
    const old = params.rot;
    params.rot = (params.rot + delta + 360) % 360;
    // rotate crop rectangle along with the image
    const c = params.crop;
    params.crop = delta > 0
      ? { x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w }
      : { x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w };
    if (old !== params.rot) rotatedPreview = null;
    if (aspect !== 'free') { aspect = 'free'; document.querySelectorAll('#tab-crop [data-aspect]').forEach(b => b.classList.toggle('active', b.dataset.aspect === 'free')); }
    scheduleRender();
  }

  function close(result) {
    $('editor').classList.add('hidden');
    document.body.style.overflow = '';
    const r = resolveFn; resolveFn = null;
    src = null; rotatedPreview = null;
    r && r(result);
  }

  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    $('edCancel').onclick = () => close(null);
    $('edReset').onclick = () => { params = DEFAULTS(); rotatedPreview = null; syncSliders(); scheduleRender(); };
    $('edSave').onclick = async () => {
      const maxPx = window.APP_SETTINGS?.maxPx || 2000;
      const out = renderFinal(src, params, maxPx);
      const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.9));
      close({ blob, params: JSON.parse(JSON.stringify(params)) });
    };
    $('edRotL').onclick = () => rotate(-90);
    $('edRotR').onclick = () => rotate(90);
    $('edAuto').onclick = autoEnhance;
    document.querySelectorAll('#editor [data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));
    document.querySelectorAll('#tab-crop [data-aspect]').forEach(b => b.onclick = () => {
      document.querySelectorAll('#tab-crop [data-aspect]').forEach(x => x.classList.toggle('active', x === b));
      setAspect(b.dataset.aspect);
    });
    [['edBright', 'vBright', 'bright'], ['edContrast', 'vContrast', 'contrast'], ['edSat', 'vSat', 'sat'], ['edWarm', 'vWarm', 'warm']].forEach(([s, v, k]) => {
      $(s).oninput = () => { params[k] = parseInt($(s).value, 10); $(v).textContent = params[k]; scheduleRender(); };
    });
    const stage = $('edStage');
    stage.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('resize', () => { if (src) { fitCanvas(); positionCrop(); } });
  }

  async function open(blob, savedParams) {
    wire();
    src = await loadImage(blob);
    params = savedParams ? JSON.parse(JSON.stringify(savedParams)) : DEFAULTS();
    rotatedPreview = null; aspect = 'free';
    document.querySelectorAll('#tab-crop [data-aspect]').forEach(b => b.classList.toggle('active', b.dataset.aspect === 'free'));
    syncSliders();
    $('editor').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    setTab('adjust');
    return new Promise(r => { resolveFn = r; });
  }

  /** Render a blob through params without UI (used to downscale originals). */
  async function process(blob, p, maxPx, quality = 0.9) {
    const im = await loadImage(blob);
    const out = renderFinal(im, p || DEFAULTS(), maxPx);
    return new Promise(r => out.toBlob(r, 'image/jpeg', quality));
  }

  window.Editor = { open, process, DEFAULTS };
})();

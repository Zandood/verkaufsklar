/* Verkaufsklar – main app logic */
(function () {
  const $ = (id) => document.getElementById(id);
  const MAX_PHOTOS = 20;
  const AI_MAX_PX = 1568;      // long edge sent to the AI (Claude's sweet spot for vision)
  const AI_MAX_IMAGES = 10;    // keep requests fast and cheap

  // ---------- settings ----------
  const SETTINGS_KEY = 'verkaufsklar.settings.v1';
  const defaults = { provider: 'claude', keys: {}, model: 'claude-opus-5-5', web: true, location: '', lang: 'de', footer: 'Privatverkauf. Der Verkauf erfolgt unter Ausschluss jeglicher Sachmängelhaftung. Die Haftung für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit sowie bei Vorsatz und grober Fahrlässigkeit bleibt unberührt.', maxPx: 2000 };
  let settings = load();
  function load() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (_) { return { ...defaults }; }
  }
  function save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { toast('Speichern nicht möglich (privater Modus?)'); }
    window.APP_SETTINGS = settings;
  }
  window.APP_SETTINGS = settings;
  const provider = () => window.PROVIDERS[settings.provider] || window.PROVIDERS.claude;
  const apiKey = () => (settings.keys || {})[settings.provider] || '';

  // ---------- IndexedDB drafts ----------
  const DB = {
    db: null,
    async open() {
      if (this.db) return this.db;
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('verkaufsklar', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('drafts', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return this.db;
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('drafts', mode);
        const store = t.objectStore('drafts');
        const out = fn(store);
        t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
        t.onerror = () => rej(t.error);
      });
    },
    put(d) { return this.tx('readwrite', s => s.put(d)); },
    del(id) { return this.tx('readwrite', s => s.delete(id)); },
    async all() {
      const req = await this.tx('readonly', s => s.getAll());
      return (Array.isArray(req) ? req : []).sort((a, b) => b.updated - a.updated);
    },
    get(id) { return this.tx('readonly', s => s.get(id)); },
  };

  // ---------- state ----------
  let draft = newDraft();
  function newDraft() {
    return { id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6), created: Date.now(), updated: Date.now(), photos: [], notes: '', listing: null };
  }
  const urlCache = new Map();
  function photoBlob(p) { return p.edited || p.original; }
  function photoUrl(p) {
    const b = photoBlob(p);
    if (!urlCache.has(b)) urlCache.set(b, URL.createObjectURL(b));
    return urlCache.get(b);
  }

  let saveTimer = null;
  function persistSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 600);
  }
  async function persistNow() {
    clearTimeout(saveTimer);
    if (!draft.photos.length && !draft.listing) return;
    draft.updated = Date.now();
    draft.listing = readForm() || draft.listing;
    try { await DB.put(draft); } catch (e) { console.warn('save failed', e); }
  }

  // ---------- UI helpers ----------
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }
  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); toast((label || 'Text') + ' kopiert'); return true; }
    catch (_) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* ignore */ }
      ta.remove(); toast(ok ? (label || 'Text') + ' kopiert' : 'Kopieren nicht möglich'); return ok;
    }
  }
  const euro = (n) => (n === null || n === undefined) ? '–' : n.toLocaleString('de-DE') + ' €';

  const TITLES = { listing: 'Neue Anzeige', history: 'Gespeichert', settings: 'Einstellungen', help: 'Hilfe' };
  function go(view) {
    document.querySelectorAll('section.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + view));
    document.querySelectorAll('nav.bottom button').forEach(b => b.classList.toggle('active', b.dataset.goto === view));
    $('viewTitle').textContent = TITLES[view] || '';
    if (view === 'history') renderHistory();
    if (view === 'settings') fillSettings();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => go(b.dataset.goto)));

  // ---------- photos ----------
  $('btnCamera').onclick = () => $('fileCamera').click();
  $('btnGallery').onclick = () => $('fileGallery').click();
  $('fileCamera').onchange = (e) => addFiles(e.target.files, e.target);
  $('fileGallery').onchange = (e) => addFiles(e.target.files, e.target);

  async function addFiles(fileList, input) {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    input.value = '';
    if (!files.length) return;
    const room = MAX_PHOTOS - draft.photos.length;
    if (room <= 0) { toast(`Maximal ${MAX_PHOTOS} Fotos pro Anzeige`); return; }
    for (const f of files.slice(0, room)) {
      draft.photos.push({ id: 'p' + Math.random().toString(36).slice(2, 9), original: f, edited: null, params: null });
    }
    if (files.length > room) toast(`Nur ${room} Foto(s) hinzugefügt – Limit ${MAX_PHOTOS}`);
    renderThumbs();
    persistSoon();
  }

  function renderThumbs() {
    const wrap = $('thumbs');
    wrap.innerHTML = '';
    draft.photos.forEach((p, i) => {
      const d = document.createElement('div');
      d.className = 'thumb';
      d.innerHTML = `${i === 0 ? '<span class="badge">Titelbild</span>' : ''}<img alt="Foto ${i + 1}"><div class="tools">
        ${i > 0 ? '<button data-act="first" title="Als Titelbild">★</button>' : ''}
        <button data-act="edit" title="Bearbeiten">✎</button>
        <button data-act="del" title="Entfernen">✕</button></div>`;
      d.querySelector('img').src = photoUrl(p);
      d.querySelector('img').onclick = () => editPhoto(i);
      d.querySelectorAll('button').forEach(b => b.onclick = (e) => {
        e.stopPropagation();
        const act = b.dataset.act;
        if (act === 'edit') editPhoto(i);
        if (act === 'del') { draft.photos.splice(i, 1); renderThumbs(); persistSoon(); }
        if (act === 'first') { const [x] = draft.photos.splice(i, 1); draft.photos.unshift(x); renderThumbs(); persistSoon(); }
      });
      wrap.appendChild(d);
    });
    const n = draft.photos.length;
    $('photoCount').textContent = n ? `(${n}/${MAX_PHOTOS})` : '';
    $('thumbHint').hidden = !n;
    $('btnAnalyze').disabled = !n;
  }

  async function editPhoto(i) {
    const p = draft.photos[i];
    if (!p) return;
    try {
      const res = await window.Editor.open(p.original, p.params);
      if (!res) return;
      p.edited = res.blob; p.params = res.params;
      renderThumbs(); persistSoon();
      toast('Foto gespeichert');
    } catch (e) {
      console.error(e); toast('Foto konnte nicht geöffnet werden (Format?)');
    }
  }

  // ---------- analysis ----------
  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  async function analyze() {
    if (!apiKey()) { toast('Bitte zuerst den API-Schlüssel eintragen'); go('settings'); return; }
    if (!draft.photos.length) return;
    const btn = $('btnAnalyze');
    btn.disabled = true; $('btnReanalyze').disabled = true;
    $('analyzeError').classList.add('hidden');
    $('analyzeStatus').classList.remove('hidden');
    $('analyzeStatusText').textContent = 'Fotos werden vorbereitet …';
    const started = Date.now();
    try {
      const images = [];
      for (const p of draft.photos.slice(0, AI_MAX_IMAGES)) {
        const small = await window.Editor.process(photoBlob(p), null, AI_MAX_PX, 0.85);
        images.push({ mediaType: 'image/jpeg', base64: await blobToBase64(small) });
      }
      draft.notes = $('userNotes').value.trim();
      let notes = draft.notes;
      const cur = readForm();
      if (cur && (cur.brand || cur.model)) notes = `Vom Verkäufer bestätigt: Marke ${cur.brand || '?'}, Modell ${cur.model || '?'}, Zustand ${cur.condition}. ` + notes;
      const listing = await provider().analyze({
        apiKey: apiKey(), model: settings.model, images, notes,
        settings: { web: settings.web, location: settings.location, lang: settings.lang, footer: settings.footer },
        onStatus: (s) => { $('analyzeStatusText').textContent = s; },
      });
      draft.listing = listing;
      fillResult(listing);
      await persistNow();
      toast(`Fertig in ${Math.round((Date.now() - started) / 1000)} s`);
      $('result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      let msg = e.message || String(e);
      if (/401|authentication|invalid x-api-key/i.test(msg)) msg = 'Der API-Schlüssel wurde abgelehnt. Bitte in den Einstellungen prüfen.\n\n' + msg;
      else if (/Failed to fetch|NetworkError/i.test(msg)) msg = 'Keine Verbindung zu Anthropic. Internet prüfen.\n\n' + msg;
      else if (/429|rate/i.test(msg)) msg = 'Zu viele Anfragen oder Guthaben aufgebraucht. Kurz warten bzw. Guthaben in der Anthropic-Konsole prüfen.\n\n' + msg;
      else if (/credit balance|billing/i.test(msg)) msg = 'Guthaben aufgebraucht. Bitte in der Anthropic-Konsole Guthaben aufladen.\n\n' + msg;
      else if (/API (5\d\d)|overloaded/i.test(msg)) msg = 'Anthropic ist gerade überlastet oder nicht erreichbar. Bitte in einer Minute erneut versuchen.\n\n' + msg;
      $('analyzeError').textContent = msg;
      $('analyzeError').classList.remove('hidden');
    } finally {
      $('analyzeStatus').classList.add('hidden');
      btn.disabled = !draft.photos.length; $('btnReanalyze').disabled = false;
    }
  }
  $('btnAnalyze').onclick = analyze;
  $('btnReanalyze').onclick = analyze;

  function fillResult(l) {
    $('result').classList.remove('hidden');
    $('fTitle').value = l.title || '';
    $('fDesc').value = l.description || '';
    $('fCategory').value = l.category || '';
    $('fBrand').value = l.brand || '';
    $('fModel').value = l.model || '';
    $('fCondition').value = l.condition || 'Gut';
    $('fShipping').value = l.shipping || 'Versand möglich';
    $('fPriceType').value = l.priceType || 'VB';
    $('fPrice').value = l.price ?? l.suggestedPrice ?? '';
    $('pNew').textContent = euro(l.newPrice);
    $('pSuggest').textContent = euro(l.suggestedPrice);
    $('pRange').textContent = (l.priceMin != null && l.priceMax != null) ? `${l.priceMin}–${l.priceMax} €` : '–';
    let reason = l.reasoning || '';
    if (l.confidence) reason += `\n\nSicherheit: ${l.confidence}`;
    if (l.newPrice && l.suggestedPrice && l.condition !== 'Neu' && l.suggestedPrice > l.newPrice * 0.6) reason += `\n\n⚠ Der Vorschlag liegt über 60 % des Neupreises – für Gebrauchtware eher hoch.`;
    if (!(l.sources || []).length) reason += `\n\n⚠ Keine Quellen gefunden – Preis ist eine Schätzung. Bitte mit „Verkaufte Angebote auf eBay prüfen“ gegenchecken.`;
    if (l.questions && l.questions.length) reason += '\n\nBitte prüfen:\n• ' + l.questions.join('\n• ');
    if (l.photoTips && l.photoTips.length) reason += '\n\nFoto-Tipps:\n• ' + l.photoTips.join('\n• ');
    $('pReason').textContent = reason.trim();
    const src = $('pSources'); src.innerHTML = '';
    (l.sources || []).forEach(s => {
      const a = document.createElement('a');
      try { const u = new URL(s.url); if (!/^https?:$/.test(u.protocol)) return; a.href = u.href; } catch (_) { return; }
      a.target = '_blank'; a.rel = 'noopener'; a.textContent = s.title || s.url;
      src.appendChild(a);
    });
    updateTitleLen();
  }

  function readForm() {
    if ($('result').classList.contains('hidden')) return null;
    const base = draft.listing || {};
    const price = $('fPrice').value === '' ? null : Math.round(parseFloat($('fPrice').value));
    return {
      ...base,
      title: $('fTitle').value.trim(),
      description: $('fDesc').value.trim(),
      category: $('fCategory').value.trim(),
      brand: $('fBrand').value.trim() || null,
      model: $('fModel').value.trim() || null,
      condition: $('fCondition').value,
      shipping: $('fShipping').value,
      priceType: $('fPriceType').value,
      price: Number.isFinite(price) ? price : null,
    };
  }
  function updateTitleLen() {
    const tl = $('fTitle').value.length;
    $('titleLen').textContent = tl < 10 ? `${tl}/65 – mind. 10` : `${tl}/65`;
    $('titleLen').className = (tl < 10 || tl > 65) ? 'warn' : '';
    const dl = $('fDesc').value.length;
    $('descLen').className = dl >= 3800 ? 'warn' : '';
    const free = $('fPriceType').value === 'Zu verschenken';
    $('fPrice').disabled = free;
    if (free) $('fPrice').value = 0;
    $('descLen').textContent = `${$('fDesc').value.length}/4000`;
    const q = [$('fBrand').value, $('fModel').value].filter(Boolean).join(' ') || $('fTitle').value;
    $('btnSold').href = 'https://www.ebay.de/sch/i.html?LH_Sold=1&LH_Complete=1&_nkw=' + encodeURIComponent(q);
  }
  ['fTitle', 'fDesc', 'fBrand', 'fModel', 'fCategory', 'fCondition', 'fShipping', 'fPriceType', 'fPrice'].forEach(id => {
    $(id).addEventListener('input', () => { updateTitleLen(); persistSoon(); });
    $(id).addEventListener('change', persistSoon);
  });
  $('userNotes').addEventListener('input', () => { draft.notes = $('userNotes').value; persistSoon(); });

  function priceLine(l) {
    if (l.priceType === 'Zu verschenken') return 'Zu verschenken';
    return l.price != null ? `${l.price} € ${l.priceType}` : '';
  }
  function fullText(l) {
    return [l.title, '', l.description, '', priceLine(l), l.shipping ? l.shipping : ''].filter((x, i, a) => x !== '' || (i > 0 && a[i - 1] !== '')).join('\n').trim();
  }

  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', (e) => {
    e.preventDefault();
    const l = readForm(); if (!l) return;
    const k = b.dataset.copy;
    const map = { title: [l.title, 'Titel'], description: [l.description, 'Beschreibung'], category: [l.category, 'Kategorie'], price: [l.price != null ? String(l.price) : '', 'Preis'] };
    copy(map[k][0], map[k][1]);
  }));
  $('btnCopyAll').onclick = () => { const l = readForm(); if (l) copy(fullText(l), 'Anzeigentext'); };

  // ---------- export ----------
  function safeName(s) { return (s || 'anzeige').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'anzeige'; }

  async function exportFiles() {
    const l = readForm() || {};
    const base = safeName(l.title);
    const files = [];
    for (let i = 0; i < draft.photos.length; i++) {
      const p = draft.photos[i];
      // re-encode through canvas: applies edits, limits size, strips EXIF/GPS metadata
      const blob = await window.Editor.process(p.original, p.params, settings.maxPx, 0.88);
      files.push(new File([blob], `${base}-${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
    }
    return files;
  }

  $('btnShare').onclick = async () => {
    const l = readForm();
    if (!draft.photos.length) { toast('Keine Fotos'); return; }
    const btn = $('btnShare'); btn.disabled = true;
    try {
      const files = await exportFiles();
      const text = l ? fullText(l) : '';
      if (text) await copy(text, 'Anzeigentext');
      if (navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ files, title: l?.title || 'Anzeige', text });
      } else {
        toast('Teilen wird hier nicht unterstützt – Fotos werden gespeichert');
        await downloadFiles(files);
      }
    } catch (e) {
      if (e.name !== 'AbortError') { console.error(e); toast('Teilen fehlgeschlagen: ' + e.message); }
    } finally { btn.disabled = false; }
  };

  async function downloadFiles(files) {
    for (const f of files) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      await new Promise(r => setTimeout(r, 350));
    }
  }
  $('btnSavePhotos').onclick = async () => {
    if (!draft.photos.length) return;
    const btn = $('btnSavePhotos'); btn.disabled = true;
    try { const files = await exportFiles(); await downloadFiles(files); toast(`${files.length} Foto(s) gespeichert`); }
    catch (e) { toast('Speichern fehlgeschlagen: ' + e.message); }
    finally { btn.disabled = false; }
  };

  $('btnCopyFill').onclick = () => {
    const l = readForm(); if (!l) return;
    const payload = { title: l.title, description: l.description, price: l.price, priceType: l.priceType, condition: l.condition, shipping: l.shipping, category: l.category };
    copy('VERKAUFSKLAR:' + JSON.stringify(payload), 'Daten für Ausfüllhilfe');
  };

  // ---------- bookmarklet (user-triggered form fill on kleinanzeigen.de; never submits) ----------
  function bookmarkletSource() {
    /* eslint-disable */
    const fn = function () {
      var show = function (m) { var d = document.createElement('div'); d.textContent = m; d.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;max-width:360px;background:#3B4CCA;color:#fff;padding:12px 16px;border-radius:12px;font:14px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.3);white-space:pre-wrap'; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 9000); };
      var setVal = function (el, v) { if (!el || v == null) return false; var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var s = Object.getOwnPropertyDescriptor(proto, 'value').set; s.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); return true; };
      var q = function (sels) { for (var i = 0; i < sels.length; i++) { var e = document.querySelector(sels[i]); if (e) return e; } return null; };
      var run = function (raw) {
        if (!raw || raw.indexOf('VERKAUFSKLAR:') !== 0) { show('Keine Verkaufsklar-Daten in der Zwischenablage. In der App zuerst „Für PC-Ausfüllhilfe kopieren“ drücken.'); return; }
        var d = JSON.parse(raw.slice(13)); var done = [];
        if (setVal(q(['#postad-title', 'input[name="title"]', 'input[id*="title" i]']), d.title)) done.push('Titel');
        if (setVal(q(['#pstad-descrptn', 'textarea[name="description"]', 'textarea[id*="descr" i]', 'textarea']), d.description)) done.push('Beschreibung');
        if (d.priceType !== 'Zu verschenken' && setVal(q(['#pstad-price', 'input[name="priceAmount"]', 'input[name="price"]', 'input[id*="price" i]']), d.price)) done.push('Preis');
        var pt = q(['#priceType', 'select[name="priceType"]']);
        if (pt && pt.tagName === 'SELECT') { var want = d.priceType === 'Festpreis' ? 'FIXED' : d.priceType === 'Zu verschenken' ? 'GIVE_AWAY' : 'NEGOTIABLE'; for (var i = 0; i < pt.options.length; i++) { if (pt.options[i].value === want || pt.options[i].text.indexOf(d.priceType) > -1) { pt.selectedIndex = i; pt.dispatchEvent(new Event('change', { bubbles: true })); done.push('Preisart'); break; } } }
        show((done.length ? 'Ausgefüllt: ' + done.join(', ') : 'Keine Felder gefunden – bitte manuell einfügen.') + '\nKategorie: ' + (d.category || '–') + '\nZustand: ' + (d.condition || '–') + '\nFotos hochladen, prüfen und selbst absenden.');
      };
      if (navigator.clipboard && navigator.clipboard.readText) { navigator.clipboard.readText().then(run, function () { run(prompt('Daten aus der App hier einfügen:')); }); }
      else run(prompt('Daten aus der App hier einfügen:'));
    };
    /* eslint-enable */
    return 'javascript:(' + fn.toString() + ')();';
  }
  const bm = bookmarkletSource();
  $('bookmarklet').href = bm;
  $('bookmarklet').onclick = (e) => { e.preventDefault(); toast('In die Lesezeichenleiste ziehen, nicht hier klicken'); };
  $('bookmarkletCode').textContent = bm;

  // ---------- history ----------
  async function renderHistory() {
    const list = $('historyList');
    let items = [];
    try { items = await DB.all(); } catch (_) { /* ignore */ }
    if (!items.length) { list.innerHTML = '<p class="muted">Noch nichts gespeichert.</p>'; return; }
    list.innerHTML = '';
    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'history-item';
      const l = it.listing || {};
      row.innerHTML = `<img alt=""><div class="grow"><div class="t"></div><div class="muted"></div></div><button class="btn small">Öffnen</button><button class="btn small ghost danger" title="Löschen">✕</button>`;
      if (it.photos[0]) row.querySelector('img').src = photoUrl(it.photos[0]);
      row.querySelector('.t').textContent = l.title || 'Ohne Titel (noch nicht analysiert)';
      const p = l.price ?? l.suggestedPrice;
      row.querySelector('.muted').textContent = `${it.photos.length} Foto(s) · ${p != null ? p + ' €' : '–'} · ${new Date(it.updated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`;
      const [openBtn, delBtn] = row.querySelectorAll('button');
      openBtn.onclick = () => openDraft(it);
      delBtn.onclick = async () => { await DB.del(it.id); if (it.id === draft.id) resetDraft(false); renderHistory(); };
      list.appendChild(row);
    });
  }

  async function openDraft(it) {
    await persistNow();
    draft = it;
    $('analyzeError').classList.add('hidden');
    $('userNotes').value = it.notes || '';
    if (it.listing) fillResult(it.listing); else $('result').classList.add('hidden');
    renderThumbs();
    go('listing');
  }

  async function resetDraft(persist = true) {
    if (persist) await persistNow();
    draft = newDraft();
    $('userNotes').value = '';
    $('result').classList.add('hidden');
    $('analyzeError').classList.add('hidden');
    renderThumbs();
  }
  $('btnNew').onclick = async () => { await resetDraft(); go('listing'); toast('Neue Anzeige'); };

  // ---------- settings ----------
  function fillSettings() {
    const ps = $('sProvider'); ps.innerHTML = '';
    Object.values(window.PROVIDERS).forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; ps.appendChild(o); });
    ps.value = settings.provider;
    fillModels();
    $('sKey').value = apiKey();
    $('sKey').placeholder = provider().keyPlaceholder;
    $('sWeb').checked = settings.web;
    $('sLocation').value = settings.location;
    $('sLang').value = settings.lang;
    $('sFooter').value = settings.footer;
    $('sMaxPx').value = String(settings.maxPx);
  }
  function fillModels() {
    const ms = $('sModel'); ms.innerHTML = '';
    const p = window.PROVIDERS[$('sProvider').value] || provider();
    p.models.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name; ms.appendChild(o); });
    ms.value = p.models.some(m => m.id === settings.model) ? settings.model : p.defaultModel;
  }
  $('sProvider').onchange = () => { fillModels(); $('sKey').value = (settings.keys || {})[$('sProvider').value] || ''; };
  function readSettings() {
    settings.provider = $('sProvider').value || 'claude';
    settings.keys = { ...(settings.keys || {}), [settings.provider]: $('sKey').value.trim() };
    settings.model = $('sModel').value;
    settings.web = $('sWeb').checked;
    settings.location = $('sLocation').value.trim();
    settings.lang = $('sLang').value;
    settings.footer = $('sFooter').value.trim();
    settings.maxPx = parseInt($('sMaxPx').value, 10) || 2000;
    save();
    updateSetupHint();
  }
  $('btnSaveSettings').onclick = () => { readSettings(); toast('Gespeichert'); };
  $('btnSaveSettings2').onclick = () => { readSettings(); toast('Gespeichert'); };
  $('btnTestKey').onclick = async () => {
    readSettings();
    const st = $('testStatus');
    st.classList.remove('hidden'); st.textContent = 'Teste Verbindung …';
    try { await provider().test({ apiKey: apiKey(), model: settings.model }); st.textContent = '✓ Verbindung zu ' + provider().name + ' funktioniert.'; }
    catch (e) { st.textContent = '✗ ' + e.message; }
  };
  function updateSetupHint() { $('setupHint').hidden = !!apiKey(); }

  // ---------- boot ----------
  window.addEventListener('pagehide', persistNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistNow(); });
  updateSetupHint();
  renderThumbs();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Web Share Target: photos shared into the app from the Android gallery
  if (location.search.includes('shared=1')) {
    (async () => {
      try {
        const cache = await caches.open('share-inbox');
        const keys = await cache.keys();
        const files = [];
        for (const k of keys) { const r = await cache.match(k); const b = await r.blob(); files.push(new File([b], 'geteilt.jpg', { type: b.type || 'image/jpeg' })); await cache.delete(k); }
        if (files.length) addFiles(files, { value: '' });
        history.replaceState(null, '', location.pathname);
      } catch (e) { console.warn(e); }
    })();
  }
  window.__app = { get draft() { return draft; }, fillResult, readForm, fullText, settings: () => settings };
})();

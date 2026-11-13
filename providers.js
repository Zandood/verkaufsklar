/* AI providers. Each provider exposes: id, name, models[], keyPlaceholder,
 * analyze({apiKey, model, images:[{mediaType, base64}], notes, settings, onStatus}) -> listing object
 * test({apiKey, model}) -> true or throws.
 * To add another provider (OpenAI, Gemini, ...), add an object to PROVIDERS with the same shape. */

const LISTING_FIELDS = `{
  "title": "Anzeigentitel, 10-65 Zeichen, mit Marke/Modell/wichtigstem Merkmal",
  "description": "Anzeigentext: kurzer Einstieg, Stichpunkte mit Details (Marke, Modell, Größe/Maße, Farbe, Zustand ehrlich inkl. sichtbarer Mängel, Zubehör/Lieferumfang), Abschluss mit Abholung/Versand. Max. 4000 Zeichen. Keine erfundenen Fakten.",
  "category": "Kleinanzeigen-Kategoriepfad, beginnend mit einer Hauptkategorie (Auto, Rad & Boot | Elektronik | Familie, Kind & Baby | Freizeit, Hobby & Nachbarschaft | Haus & Garten | Haustiere | Mode & Beauty | Musik, Filme & Bücher | Eintrittskarten & Tickets | Verschenken & Tauschen), z. B. 'Elektronik > Handy & Telefon'",
  "condition": "einer von: Neu | Sehr gut | Gut | In Ordnung | Defekt",
  "brand": "Marke oder null",
  "model": "Modell/Typ oder null",
  "new_price_eur": "aktueller Neupreis in EUR (Zahl) oder null, wenn unbekannt",
  "suggested_price_eur": "empfohlener Angebotspreis auf Kleinanzeigen in EUR (Zahl)",
  "price_min_eur": "realistischer Mindestpreis (Zahl)",
  "price_max_eur": "realistischer Höchstpreis (Zahl)",
  "price_type": "VB oder Festpreis",
  "shipping": "Versand möglich | Nur Abholung",
  "price_reasoning": "2-4 Sätze: wie der Preis zustande kommt (Neupreis, vergleichbare Angebote, Zustand)",
  "sources": [{"title": "Quelle", "url": "https://..."}],
  "confidence": "hoch | mittel | niedrig",
  "questions": ["Was der Verkäufer noch prüfen/ergänzen sollte"],
  "photo_tips": ["kurze Tipps für bessere Fotos, falls nötig"]
}`;

function buildPrompt(notes, settings) {
  const lang = settings.lang === 'en' ? 'English' : 'German (Deutsch)';
  return `You help a private seller list an item on Kleinanzeigen (kleinanzeigen.de, Germany's classifieds site).
Look closely at ALL attached photos (they show the same item from different angles). Identify the item as precisely as possible (brand, model, generation, size, color, visible defects, accessories). Read any visible labels, type plates or packaging text.
${settings.web ? `Use web search to verify prices (never rely on a single source; cite the pages you used in sources): find the current new price (e.g. manufacturer, Amazon, idealo) and typical used prices (e.g. Kleinanzeigen, eBay sold listings, rebuy, Back Market). Keep searches focused; 2-5 searches are enough.` : `You have no web access: estimate prices from your own knowledge and say so in price_reasoning.`}
Price guidance for Kleinanzeigen: buyers negotiate, so with "VB" suggest a price slightly above what you expect to get. Used prices are usually 30-70% of new price depending on condition, age and demand.
${settings.location ? `Seller location: ${settings.location}.` : ''}
${notes ? `Seller's notes about the item (trust these over your guesses): ${notes}` : ''}
Write title and description in ${lang}. Be honest: never invent features you can't see or that the seller didn't state. Do not include phone numbers, emails or links in the description.
${settings.footer ? `End the description with this line: "${settings.footer}"` : ''}

Answer with ONLY one JSON object (no markdown fence, no text before or after) with exactly these keys:
${LISTING_FIELDS}`;
}

function extractJson(text) {
  if (!text) throw new Error('Leere Antwort von der KI.');
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1];
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Antwort enthielt kein JSON:\n' + text.slice(0, 400));
  try { return JSON.parse(t.slice(start, end + 1)); }
  catch (e) { throw new Error('Die Antwort der KI war kein gültiges JSON. Bitte erneut analysieren.\n(' + e.message + ')'); }
}

function normalizeListing(o) {
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d,.-]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  const conds = ['Neu', 'Sehr gut', 'Gut', 'In Ordnung', 'Defekt'];
  return {
    title: String(o.title || '').slice(0, 65),
    description: String(o.description || '').slice(0, 4000),
    category: String(o.category || ''),
    condition: conds.find(c => c.toLowerCase() === String(o.condition || '').toLowerCase()) || 'Gut',
    brand: o.brand || null,
    model: o.model || null,
    newPrice: num(o.new_price_eur),
    suggestedPrice: num(o.suggested_price_eur),
    priceMin: num(o.price_min_eur),
    priceMax: num(o.price_max_eur),
    priceType: /fest/i.test(o.price_type || '') ? 'Festpreis' : 'VB',
    shipping: /abhol/i.test(o.shipping || '') ? 'Nur Abholung' : 'Versand möglich',
    reasoning: String(o.price_reasoning || ''),
    sources: Array.isArray(o.sources) ? o.sources.filter(s => s && s.url).slice(0, 8) : [],
    confidence: o.confidence || '',
    questions: Array.isArray(o.questions) ? o.questions : [],
    photoTips: Array.isArray(o.photo_tips) ? o.photo_tips : [],
  };
}

const ClaudeProvider = {
  id: 'claude',
  name: 'Claude (Anthropic)',
  keyPlaceholder: 'sk-ant-…',
  models: [
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 (am günstigsten, ~$0,01 pro Anzeige)' },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (besser, ~$0,05)' },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (beste Qualität, ~$0,10)' },
  ],
  defaultModel: 'claude-haiku-5-5',
  needsKey: true,
  keyHelp: 'Schlüssel aus <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> (nicht dein claude.ai-Login; separat in US-Dollar abgerechnet).',

  async call(apiKey, body, useFallback) {
    const headers = {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
      // Required for calling the API directly from a browser (key stays on the user's device).
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const payload = { ...body };
    if (useFallback && body.model !== 'claude-haiku-5-5') {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      payload.fallbacks = 'default';
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText;
      const err = new Error(`Anthropic API ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  async request(apiKey, body) {
    try {
      return await this.call(apiKey, body, true);
    } catch (e) {
      // If the fallback beta isn't accepted for this account/model, retry plain.
      if (e.status === 400 && /fallback|beta/i.test(e.message)) return this.call(apiKey, body, false);
      throw e;
    }
  },

  async test({ apiKey, model }) {
    await this.request(apiKey, {
      model, max_tokens: 64, output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Antworte nur mit: OK' }],
    });
    return true;
  },

  async analyze({ apiKey, model, images, notes, settings, onStatus }) {
    const content = [];
    images.forEach((img, i) => {
      content.push({ type: 'text', text: `Foto ${i + 1}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
    });
    content.push({ type: 'text', text: buildPrompt(notes, settings) });

    const messages = [{ role: 'user', content }];
    const body = {
      model,
      max_tokens: 16000,
      output_config: { effort: model === 'claude-haiku-5-5' ? 'low' : 'medium' },
      messages,
    };
    if (settings.web) {
      body.tools = [{ type: model === 'claude-haiku-5-5' ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', country: 'DE', timezone: 'Europe/Berlin' } }];
    }

    let data;
    for (let turn = 0; turn < 4; turn++) {
      onStatus?.(turn === 0 ? (settings.web ? 'Claude erkennt den Artikel und prüft Preise im Web …' : 'Claude erkennt den Artikel …') : 'Claude recherchiert weiter …');
      data = await this.request(apiKey, body);
      if (data.stop_reason === 'refusal') throw new Error('Claude hat die Anfrage abgelehnt. Bitte andere Fotos versuchen.');
      if (data.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: data.content });
        continue;
      }
      break;
    }
    if (data.stop_reason === 'pause_turn') throw new Error('Die Web-Recherche hat zu lange gedauert. Bitte erneut analysieren oder Websuche in den Einstellungen ausschalten.');
    if (data.stop_reason === 'max_tokens') throw new Error('Die Antwort der KI wurde abgeschnitten (Längenlimit). Bitte erneut analysieren.');
    // Citations split one answer into several text blocks: join without separators, or JSON strings break.
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const listing = normalizeListing(extractJson(text));
    // Merge citations from web search results if the model left sources empty.
    if (!listing.sources.length) {
      const urls = [];
      for (const b of data.content || []) {
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
          for (const r of b.content) if (r.url) urls.push({ title: r.title || r.url, url: r.url });
        }
      }
      listing.sources = urls.slice(0, 6);
    }
    listing.usage = data.usage || null;
    listing.aiModel = data.model || model;
    return listing;
  },
};


/* ---------- Google Gemini (free tier available) ---------- */
const GeminiProvider = {
  id: 'gemini',
  name: 'Google Gemini (kostenlose Stufe)',
  keyPlaceholder: 'AIza…',
  needsKey: true,
  keyHelp: 'Kostenlosen Schlüssel holen: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. Hinweis: In der kostenlosen Stufe darf Google Eingaben (auch Fotos) zur Verbesserung seiner Produkte verwenden. Tageslimits sind begrenzt.',
  models: [
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite (schnell, günstigstes)' },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (genauer)' },
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
  ],
  defaultModel: 'gemini-3.5-flash-lite',
  canListModels: true,

  async call(apiKey, model, body) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Gemini API ${res.status}: ${data?.error?.message || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  async listModels({ apiKey }) {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': apiKey } });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || res.statusText);
    return (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name) && !/embedding|tts|image-generation|live/i.test(m.name))
      .map(m => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }));
  },

  async test({ apiKey, model }) {
    await this.call(apiKey, model, { contents: [{ role: 'user', parts: [{ text: 'Antworte nur mit: OK' }] }] });
    return true;
  },

  async analyze({ apiKey, model, images, notes, settings, onStatus }) {
    const parts = [];
    images.forEach((img, i) => {
      parts.push({ text: `Foto ${i + 1}:` });
      parts.push({ inline_data: { mime_type: img.mediaType, data: img.base64 } });
    });
    parts.push({ text: buildPrompt(notes, settings) });
    const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 8192 } };
    let data;
    if (settings.web) {
      onStatus?.('Gemini erkennt den Artikel und prüft Preise mit Google-Suche …');
      try {
        data = await this.call(apiKey, model, { ...body, tools: [{ google_search: {} }] });
      } catch (e) {
        // Search grounding may be unavailable for this key/model or over quota: retry without it.
        if (e.status === 400 || e.status === 403 || e.status === 429) {
          onStatus?.('Google-Suche nicht verfügbar – Schätzung ohne Websuche …');
          data = await this.call(apiKey, model, body);
          data.__noSearch = true;
        } else throw e;
      }
    } else {
      onStatus?.('Gemini erkennt den Artikel …');
      data = await this.call(apiKey, model, body);
    }
    const cand = (data.candidates || [])[0];
    if (!cand) throw new Error('Gemini hat keine Antwort geliefert' + (data.promptFeedback?.blockReason ? ` (blockiert: ${data.promptFeedback.blockReason})` : '.'));
    if (cand.finishReason === 'MAX_TOKENS') throw new Error('Die Antwort war zu lang und wurde abgeschnitten. Bitte erneut analysieren.');
    if (cand.finishReason === 'SAFETY') throw new Error('Gemini hat die Anfrage aus Sicherheitsgründen abgelehnt. Bitte andere Fotos versuchen.');
    const text = (cand.content?.parts || []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
    const listing = normalizeListing(extractJson(text));
    if (!listing.sources.length) {
      const chunks = cand.groundingMetadata?.groundingChunks || [];
      listing.sources = chunks.filter(c => c.web?.uri).slice(0, 6).map(c => ({ title: c.web.title || c.web.uri, url: c.web.uri }));
    }
    if (data.__noSearch) listing.reasoning = (listing.reasoning + '\n(Ohne Websuche geschätzt.)').trim();
    listing.aiModel = model;
    return listing;
  },
};

/* ---------- Local LLM: Ollama / LM Studio / any OpenAI-compatible server on your PC ---------- */
const LocalProvider = {
  id: 'local',
  name: 'Lokales Modell (Ollama / LM Studio am PC)',
  keyPlaceholder: 'meist leer lassen',
  needsKey: false,
  needsBaseUrl: true,
  defaultBaseUrl: 'http://192.168.178.20:11434/v1',
  keyHelp: 'Kostenlos, Fotos bleiben in deinem WLAN. Am PC: <b>Ollama</b> installieren, ein Bild-Modell laden (z. B. <code>ollama pull qwen2.5vl:7b</code> oder <code>gemma3:12b</code>) und Ollama fürs WLAN freigeben: Umgebungsvariablen <code>OLLAMA_HOST=0.0.0.0</code> und <code>OLLAMA_ORIGINS=*</code>, dann neu starten. Adresse: <code>http://&lt;IP-des-PCs&gt;:11434/v1</code> (LM Studio: Port 1234). Keine Websuche: Preise sind nur Schätzungen. Funktioniert in der Android-App und am PC unter localhost; die Web-Version (https) darf keine http-Adressen im WLAN aufrufen.',
  models: [
    { id: 'qwen2.5vl:7b', name: 'qwen2.5vl:7b (empfohlen)' },
    { id: 'gemma3:12b', name: 'gemma3:12b' },
    { id: 'llama3.2-vision:11b', name: 'llama3.2-vision:11b' },
  ],
  defaultModel: 'qwen2.5vl:7b',
  canListModels: true,

  base(baseUrl) { return (baseUrl || this.defaultBaseUrl).replace(/\/+$/, ''); },
  async call({ apiKey, baseUrl }, body) {
    const headers = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = 'Bearer ' + apiKey;
    let res;
    try {
      res = await fetch(this.base(baseUrl) + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error(`Lokaler Server nicht erreichbar (${this.base(baseUrl)}). Läuft Ollama/LM Studio, ist der PC im selben WLAN und OLLAMA_HOST/OLLAMA_ORIGINS gesetzt?`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Lokales Modell ${res.status}: ${data?.error?.message || data?.error || res.statusText}`);
    return data;
  },
  async listModels({ apiKey, baseUrl }) {
    const headers = apiKey ? { authorization: 'Bearer ' + apiKey } : {};
    const res = await fetch(this.base(baseUrl) + '/models', { headers });
    const data = await res.json();
    return (data.data || []).map(m => ({ id: m.id, name: m.id }));
  },
  async test(opts) {
    await this.call(opts, { model: opts.model, max_tokens: 16, messages: [{ role: 'user', content: 'Antworte nur mit: OK' }] });
    return true;
  },
  async analyze({ apiKey, baseUrl, model, images, notes, settings, onStatus }) {
    onStatus?.('Lokales Modell erkennt den Artikel (kann am PC 1–3 Minuten dauern) …');
    const content = [];
    images.slice(0, 4).forEach(img => content.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}` } }));
    content.push({ type: 'text', text: buildPrompt(notes, { ...settings, web: false }) });
    const data = await this.call({ apiKey, baseUrl }, { model, max_tokens: 4096, temperature: 0.2, messages: [{ role: 'user', content }] });
    const text = data.choices?.[0]?.message?.content || '';
    const listing = normalizeListing(extractJson(Array.isArray(text) ? text.map(t => t.text || '').join('') : text));
    listing.reasoning = (listing.reasoning + '\n(Lokales Modell ohne Websuche – Preis bitte mit eBay „Verkaufte Angebote“ prüfen.)').trim();
    listing.confidence = listing.confidence || 'niedrig';
    listing.aiModel = model;
    return listing;
  },
};

// Order shown in settings: Gemini first (free), Claude (Haiku default), local model last.
const PROVIDERS = { gemini: GeminiProvider, claude: ClaudeProvider, local: LocalProvider };
window.PROVIDERS = PROVIDERS;
window.__test = { extractJson, normalizeListing, buildPrompt };

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
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (beste Qualität)' },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (schneller, günstiger)' },
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 (am günstigsten)' },
  ],
  defaultModel: 'claude-opus-5-5',

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
      body.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', country: 'DE', timezone: 'Europe/Berlin' } }];
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

const PROVIDERS = { claude: ClaudeProvider };
window.PROVIDERS = PROVIDERS;
window.__test = { extractJson, normalizeListing, buildPrompt };

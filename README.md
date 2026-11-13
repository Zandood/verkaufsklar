# Verkaufsklar – Foto → Kleinanzeigen-Inserat mit Claude

Take photos of an item on your phone. An AI (Google Gemini, Claude or a local model) identifies it, checks prices on the web and writes the title, description, category, condition, new price and a suggested price (with sources). You edit the photos (crop, rotate, brightness, contrast, saturation, warmth, auto-fix), then hand everything over to Kleinanzeigen.

It's an installable web app (PWA): one codebase for Android (Chrome) and PC (Chrome/Edge). There's no server and no build step. Your API key and drafts stay on your device.

## What it does
- **Photos:** take photos with the camera or pick them from the gallery, up to 20 per listing. The first photo is the cover, and ★ makes another photo the cover. On Android you can also share photos from the gallery into the installed app.
- **Photo editor:** crop (free, 1:1, 4:3, 3:4 or 16:9), rotate, brightness, contrast, saturation, warmth and Auto. Edits are non-destructive, so re-editing starts from the original.
- **AI analysis** (Gemini, Claude or a local model). It uses web search where available (at most 5 searches with Claude) to find the new price and used prices, and returns:
  - the new price, a suggested price, a low–high range and a confidence level
  - its reasoning and source links
  - a "check sold listings on eBay" link
  - warnings when the price looks too high or there are no sources
- **Confirm step:** brand and model come back as editable fields. Correct them and tap "Neu formulieren lassen" to regenerate with the corrected item.
- **Hand-off to Kleinanzeigen** (you always publish yourself):
  - **Android:** "Fotos + Text an Kleinanzeigen-App teilen" opens the share sheet with the edited photos. The text is already on the clipboard.
  - **Copy buttons:** one per field (title, description, price, category), plus "copy all".
  - **Save photos:** "Bearbeitete Fotos speichern" saves JPEGs with metadata and GPS removed, long edge 2000 px (adjustable).
  - **PC fill-in helper:** a bookmarklet that fills title, description, price and price type on kleinanzeigen.de's "Anzeige aufgeben" page. It never submits.
- **Drafts:** saved automatically on the device, listed under "Gespeichert".

## Why it doesn't post automatically
Kleinanzeigen has no public API for creating listings. Its terms of use (§ 5 Nr. 1) forbid "Crawler, Spider, Scraper oder andere automatisierte Mechanismen" without written permission, and accounts can be banned. So the app prepares everything and you press "Anzeige aufgeben" yourself. The bookmarklet only fills the fields in your own browser after you click it.

## Choosing an AI (Einstellungen → Anbieter)
Order, cheapest first:
1. **Google Gemini (default, free tier).**
   - Get a free key at https://aistudio.google.com/apikey.
   - Prices are checked with Google Search.
   - On the free tier Google may use your inputs, including photos, to improve its products, and daily limits apply. If Google Search isn't available, the app falls back to an estimate without web search.
   - "Modelle laden" fetches the current model list.
2. **Claude.** Haiku 5.5 is the default (about $0.01 per listing); Sonnet and Opus are selectable.
   - It needs an API key from console.anthropic.com. This is not your claude.ai login and is billed separately.
3. **Local model on your PC (free, photos stay on your network):**
   - Install Ollama and run `ollama pull qwen2.5vl:7b` (or `gemma3:12b`).
   - Set the environment variables `OLLAMA_HOST=0.0.0.0` and `OLLAMA_ORIGINS=*`, then restart Ollama.
   - In the app, enter `http://<PC-IP>:11434/v1` as the server address. For LM Studio the port is 1234.
   - There is no web search, so prices are estimates only.
   - It works in the Android app, and in a browser on the PC itself via `http://localhost:11434/v1`. The https web version on GitHub Pages cannot reach an http address on your network.

## Setup
1. Install the Android app from the latest release: https://github.com/Zandood/verkaufsklar/releases/latest. Alternatively, open the web version at https://zandood.github.io/verkaufsklar/ and install it with ⋮ → "App installieren".
2. In Einstellungen, pick a provider, paste the key, tap "Verbindung testen", then "Speichern".

## Adding another AI provider
`providers.js` has a `PROVIDERS` registry. To add a provider (OpenAI, Gemini, …), add an object with `id`, `name`, `models`, `defaultModel`, `keyPlaceholder`, `test()` and `analyze()` that returns the same listing shape as `ClaudeProvider`. The settings screen picks it up automatically, and each provider's key is stored separately.

## Files
| File | Purpose |
|---|---|
| index.html | UI (German) |
| app.js | photos, analysis flow, export/share, drafts (IndexedDB), settings, bookmarklet |
| editor.js | photo editor (canvas) |
| providers.js | AI provider registry and the Claude implementation (prompt, request, JSON parsing) |
| tokens.css, styles.css | design tokens from the design thread, plus app styles |
| sw.js, manifest.webmanifest | offline shell, install, Android share target |

## Known limits
- Whether the Kleinanzeigen Android app accepts shared photos hasn't been verified on a device. If it isn't in the share sheet, use "Bearbeitete Fotos speichern" and pick the photos in the Kleinanzeigen app.
- The bookmarklet uses the field IDs of the current Kleinanzeigen form, with generic fallbacks. If Kleinanzeigen changes the form, use the copy buttons.
- Prices are guidance and depend on what the web search finds. Check the sources.

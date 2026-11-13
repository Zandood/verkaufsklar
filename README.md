# Verkaufsklar – Foto → Kleinanzeigen-Inserat mit Claude

Take photos of an item on your phone. Claude identifies it, checks prices on the web and writes the title, description, category, condition, new price and a suggested price (with sources). You edit the photos (crop, rotate, brightness, contrast, saturation, warmth, auto-fix), then hand everything over to Kleinanzeigen.

It's an installable web app (PWA): one codebase for Android (Chrome) and PC (Chrome/Edge). There's no server and no build step. Your API key and drafts stay on your device.

## What it does
- **Photos:** take photos with the camera or pick them from the gallery, up to 20 per listing. The first photo is the cover, and ★ makes another photo the cover. On Android you can also share photos from the gallery into the installed app.
- **Photo editor:** crop (free, 1:1, 4:3, 3:4 or 16:9), rotate, brightness, contrast, saturation, warmth and Auto. Edits are non-destructive, so re-editing starts from the original.
- **Claude analysis:** Opus 5.5 by default (Sonnet 5.5 and Haiku 5.5 are selectable). It uses live web search (at most 5 searches) to find the new price and used prices, and returns:
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

## Setup
1. **API key:** go to https://console.anthropic.com/settings/keys, create a key and add some credit. This is separate from a claude.ai Pro/Max subscription, which third-party apps can't use. Cost is roughly $0.02–0.15 per listing.
2. **Host the folder over HTTPS.** The camera, install and service worker need HTTPS. Pick one:
   - **GitHub Pages:** push this folder to a repo, then go to Settings → Pages → Deploy from branch `main` / root. The URL will be `https://<user>.github.io/<repo>/`.
   - **Netlify Drop:** drag the folder onto https://app.netlify.com/drop and you get an HTTPS URL immediately.
   - **Local PC only:** run `python3 -m http.server 8080` in this folder and open http://localhost:8080. Localhost counts as secure.
3. Open the URL on your phone in Chrome, then go to ⋮ → "App installieren" / "Zum Startbildschirm hinzufügen".
4. In the app, open Einstellungen, paste the key, tap "Verbindung testen" and then Speichern.

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

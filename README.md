# MIDI to GW2 Numeric Notation

A browser-based converter for **Guild Wars 2** musicians.

Upload a **MIDI** (`.mid` / `.midi`) or **MuseScore** (`.mscz` / `.mscx`) score and get **GW2 numeric notation** per track, with playback, a playable piano, and audio/MIDI export — all running locally in your browser.

Live demo (if published): [yugisch.github.io/midi-to-gw2notation](https://yugisch.github.io/midi-to-gw2notation/)

---

## Features

### Score → GW2 notation

- Accepts **MIDI** and **MuseScore** (`.mscz` / `.mscx` via [webmscore](https://github.com/LibreScore/webmscore) in the browser)
- One notation block per track / channel
- Chords, rests, accidentals, octave marks, duration marks (including dotted styles aligned with common GW2 practice)
- **Bar lines follow the score’s time signature** (not a fixed 4/4 grid)
- Optional **key optimization** (auto-transpose toward fewer sharps / GW2-friendly range)
- **Advanced beat grid** (auto or fixed resolution, with “preserve fast notes”)
- **Live octave shift** (− / 0 / +) on the output bar — raises or lowers written notes immediately without re-converting
- **Copy all** and **Download .txt** (UTF-8)

Notation style is guided by [Powerina’s GW2 notation](https://gw2-songbook.com/song/568).

### Playback

- **Play / pause / stop** and a **seek bar** for all selected tracks and for each track
- Track **include** checkboxes (default: all on) — only checked tracks are used for Play All, text export, and download
- Unchecked tracks dim and **disable** their controls until checked again
- Per-track **Sound** preset (from the bundled GW2 SoundFont)
- Per-track **collapse** — click the track name to fold/expand notation
- **Playback tempo (BPM)** override, or leave empty to use the file’s tempo

### Export

Per track and for all selected tracks:

| Format | What you get |
|--------|----------------|
| **WAV** | Rendered with the **same SoundFont** you hear in the app |
| **MIDI** | Standard Type-1 `.mid` (note data + program changes; not SF2 samples) |

### Playable piano

- On-page keyboard inspired by [Sarya’s Music Thingy](https://sauryelle.github.io/gw2-virtual-piano/)
- Instrument presets from the same SoundFont
- Octave low / mid / high with **disabled steps** when an instrument can’t play that range
- Bass / Verdarach-style mapping so lower written ranges stay playable on the keyboard
- **Enable sound** control for clearer first-time load (especially on mobile)

### SoundFont engine

- Bundled `assets/gw2Instruments.sf2` (~43 MB)
- [FluidSynth](https://www.fluidsynth.org/) via [`js-synthesizer`](https://github.com/paulrosen/JS-Synthesizer) (WASM in `js/vendor/`)
- IndexedDB cache after the first successful load
- Mobile-oriented handling (progress messages, audio unlock, lower polyphony)

Presets include: Minstrel, Piano, Bell, Bell (Legacy), Choir Bell (Legacy), Pipe Organ, Lute, Bass, Harp, Horn, Verdarach, Flute, Choir Bell, Drums. Catalog: `assets/soundfont-presets.json` / `.xml`.

---

## How to run

Serve the project folder over **HTTP** (required for a smooth SoundFont load).

### Windows

```bat
py -m http.server 8080
```

or:

```bat
python -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

> On Windows, `python3` is often missing; prefer `py` or `python`.

### macOS / Linux

```bash
python3 -m http.server 8080
```

### Opening `index.html` via `file://`

Supported, but browsers **block** `fetch` of the local SF2. On first play the app may ask you to pick `assets/gw2Instruments.sf2` once. Prefer the HTTP server when possible.

### GitHub Pages

Static hosting works. First SoundFont load downloads ~43 MB and may take a while on phones — use **Enable sound** / Wi‑Fi and keep the tab open until status shows ready.

---

## Project layout

```text
├── index.html
├── css/style.css
├── js/app.js
├── js/vendor/          # Midi.js, js-synthesizer, libfluidsynth
└── assets/
    ├── gw2Instruments.sf2
    ├── soundfont-presets.json
    └── soundfont-presets.xml
```

Everything runs in the browser. MuseScore support loads webmscore WASM from the CDN on first use (~9 MB). Vendor synth scripts are local; CDN is only a fallback if those files are missing.

---

## Credits

- Notation reference: [Powerina’s GW2 notation](https://gw2-songbook.com/song/568)
- Playable piano: [Sarya’s Music Thingy](https://sauryelle.github.io/gw2-virtual-piano/)
- MuseScore → MIDI: [webmscore](https://github.com/LibreScore/webmscore)
- SoundFont playback: FluidSynth WASM via [js-synthesizer](https://github.com/paulrosen/JS-Synthesizer)
- SoundFont file: Sefja and Jenpai
- Resource materials for testing: Stump and Mellow
- App: Nero/Yugi

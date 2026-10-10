# 🎵 GW2 MIDI to Numeric Notation

A web-based MIDI converter designed for Guild Wars 2 musicians.

This application converts MIDI files into readable **Guild Wars 2 numeric music notation**, while providing tools to make the resulting notation easier to understand, edit, and play.

The project runs entirely in the browser.

---

## ✨ Features

### 🎼 MIDI to GW2 Numeric Notation

Upload a `.mid` / `.midi` file and convert its musical notes into Guild Wars 2 numeric notation.

The converter supports:

- Multiple MIDI tracks/channels
- Separate notation output for each channel
- Chords
- Octave notation
- Sharps / accidentals
- Note duration markings
- Pauses and rests
- Beat-based formatting
- Bar separators
- Automatic line wrapping

Each MIDI channel is displayed separately, making it easier to identify melodies, bass lines, chords, and other parts of a song.

---

### 🎹 Automatic Key Optimization

The converter can automatically transpose a song into a more convenient key for GW2.

Instead of simply converting the original MIDI key, the optimizer checks different transpositions and looks for a version that produces:

- Fewer sharp/accidental notes
- More natural notes
- Better compatibility with the GW2 playable range
- Minimal unnecessary transposition

This is especially useful for MIDI files that contain many `#` notes and would otherwise be difficult to play.

You can choose between:

- **Auto — easiest GW2 key**
- **Keep original key**

The automatic optimizer applies the same transposition to the musical tracks so the song remains musically consistent.

---

### 🎚️ Adaptive Beat Grid

The converter includes a configurable beat grid for controlling the resolution of note timing.

Available resolutions include:

- Whole beat
- Half beat
- Quarter beat
- Eighth beat

The converter can automatically refine the selected grid when faster note onsets are detected, helping prevent notes from disappearing when using a coarse grid.

This allows you to use a simpler grid for normal songs while still preserving faster passages when necessary.

---

### 🎵 GW2 Notation Formatting

The generated notation follows Powerina's GW2 notation: 
https://gw2-songbook.com/song/568 


## How to run

**Recommended (HTTP server):** from this folder run:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

**Open `index.html` directly (file://):** also supported. Browsers block loading the 43 MB SoundFont via `fetch` on `file://`, so on first play the app will ask you to pick `assets/gw2Instruments.sf2` once. After that, piano and tracks use the loaded SoundFont.

Engine scripts live in `js/vendor/` (no internet required for them). CDN is only used as a fallback if those files are missing.

## SoundFont playback

The app includes `assets/gw2Instruments.sf2` and uses FluidSynth WebAssembly through js-synthesizer to play track notes and the on-page piano with SoundFont samples. The first playback initializes the synthesizer and loads the roughly 43 MB SoundFont, so it may take a little while. Playback is SoundFont-only: if initialization fails, the status line shows the real error message.

Check the SoundFont's license/redistribution terms before publishing the repository publicly, especially because the `.sf2` file is bundled with the site.


## SoundFont preset selection

The bundled `assets/gw2Instruments.sf2` SoundFont includes these melodic presets: Minstrel, Piano, Bell, Bell (Legacy), Choir Bell (Legacy), Pipe Organ, Lute, Bass, Harp, Horn, Verdarach, Flute, Choir Bell, and Drums. Use the Sound dropdown on each track to audition a different preset, or use the Play with dropdown above the virtual keyboard. The preset catalog is also provided as `assets/soundfont-presets.xml` and `assets/soundfont-presets.json`.

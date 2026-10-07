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
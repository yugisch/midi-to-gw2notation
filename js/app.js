/* ============================================================
   GW2 MIDI TO NUMERIC NOTATION
   Main application JavaScript

   File structure:
   1. App state
   2. DOM references
   3. File handling
   4. UI controls
   5. MIDI conversion
   6. Notation generation
   7. Output rendering
   8. Export functions
   ============================================================ */


/* ============================================================
   1. APP STATE
   ============================================================ */

let midiFile = null;
let selectedOctave = "mid";
let conversionResults = [];


/*
 * Channel colors.
 *
 * Change these if you want different colors for MIDI channels.
 */
const CHANNEL_COLORS = [
  "#fb7185",
  "#60a5fa",
  "#fbbf24",
  "#4ade80",
  "#c084fc",
  "#22d3ee",
  "#f472b6",
  "#a3a3e8",
  "#fb923c",
  "#2dd4bf",
  "#818cf8",
  "#f87171",
  "#a3e635",
  "#38bdf8",
  "#e879f9",
  "#facc15"
];


/*
 * Fallback instrument names.
 *
 * MIDI files can contain track names. If a track has no name,
 * these names are used.
 */
const DEFAULT_TRACK_NAMES = [
  "Piano",
  "Strings",
  "Brass",
  "Bass",
  "Percussion",
  "Melody",
  "Harmony",
  "Effects"
];


/* ============================================================
   2. DOM REFERENCES
   ============================================================ */

const elements = {
  dropZone: document.getElementById("dropZone"),
  midiFile: document.getElementById("midiFile"),
  fileName: document.getElementById("fileName"),
  clearFile: document.getElementById("clearFile"),

  tempo: document.getElementById("tempo"),
  outputFormat: document.getElementById("outputFormat"),
  beatGrid: document.getElementById("beatGrid"),
  preserveFastNotes: document.getElementById("preserveFastNotes"),
  transposeMode: document.getElementById("transposeMode"),

  convertButton: document.getElementById("convertButton"),

  errorMessage: document.getElementById("errorMessage"),
  status: document.getElementById("status"),

  channels: document.getElementById("channels"),
  playAllButton: document.getElementById("playAllButton"),
  pauseAllButton: document.getElementById("pauseAllButton"),
  stopAllButton: document.getElementById("stopAllButton"),
  globalPlaybackStatus: document.getElementById("globalPlaybackStatus"),

  copyButton: document.getElementById("copyButton"),
  downloadButton: document.getElementById("downloadButton")
};


/* ============================================================
   3. FILE HANDLING
   ============================================================ */

elements.dropZone.addEventListener("click", () => {
  elements.midiFile.click();
});


elements.midiFile.addEventListener("change", event => {
  loadMidiFile(event.target.files[0]);
});


elements.dropZone.addEventListener("dragover", event => {
  event.preventDefault();
  elements.dropZone.classList.add("dragging");
});


elements.dropZone.addEventListener("dragleave", () => {
  elements.dropZone.classList.remove("dragging");
});


elements.dropZone.addEventListener("drop", event => {
  event.preventDefault();

  elements.dropZone.classList.remove("dragging");

  loadMidiFile(event.dataTransfer.files[0]);
});


function isMidiFileName(name) {
  return /\.midi?$/i.test(name || "");
}

function isMuseScoreFileName(name) {
  return /\.msc[zx]$/i.test(name || "");
}

function isSupportedScoreFileName(name) {
  return isMidiFileName(name) || isMuseScoreFileName(name);
}

function loadMidiFile(file) {

  if (!file) {
    return;
  }

  if (!isSupportedScoreFileName(file.name)) {
    showError("Please choose a .mid, .midi, .mscz, or .mscx file.");
    return;
  }

  midiFile = file;

  elements.fileName.textContent = file.name;

  elements.convertButton.disabled = false;

  clearError();

  const kind = isMuseScoreFileName(file.name) ? "MuseScore" : "MIDI";
  elements.status.textContent =
    `${kind} ready · ${(file.size / 1024).toFixed(1)} KB`;
}


elements.clearFile.addEventListener("click", () => {

  stopAllTrackPlayers(true);
  setGlobalPlaybackUI("stopped");

  midiFile = null;

  elements.midiFile.value = "";

  elements.fileName.textContent =
    "No score file selected";

  elements.convertButton.disabled = true;

  clearError();

  elements.status.textContent =
    "Waiting for a score file";

  showEmptyState();

  disableExportButtons();
});


/* ============================================================
   4. UI CONTROLS
   ============================================================ */


/*
 * Octave selection.
 */
document.querySelectorAll(".octave-button").forEach(button => {

  button.addEventListener("click", () => {

    selectedOctave =
      button.dataset.octave;

    document
      .querySelectorAll(".octave-button")
      .forEach(other => {
        other.classList.toggle(
          "active",
          other === button
        );
      });

  });

});


/*
 * Convert button.
 */
elements.convertButton.addEventListener(
  "click",
  convertMidi
);


/* ============================================================
   5. MIDI CONVERSION
   ============================================================ */

/**
 * Lazy-load LibreScore webmscore (MuseScore WASM) only when an .mscz/.mscx is used.
 * First load downloads ~9 MB of WASM from the CDN.
 */
let webMscoreReadyPromise = null;

function ensureWebMscore() {
  if (window.WebMscore) {
    return window.WebMscore.ready.then(() => window.WebMscore);
  }
  if (webMscoreReadyPromise) return webMscoreReadyPromise;

  webMscoreReadyPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/webmscore@1.2.1/webmscore.js";
    script.async = true;
    script.onload = () => {
      if (!window.WebMscore) {
        reject(new Error("webmscore script loaded but WebMscore is missing."));
        return;
      }
      window.WebMscore.ready
        .then(() => resolve(window.WebMscore))
        .catch(reject);
    };
    script.onerror = () => {
      webMscoreReadyPromise = null;
      reject(new Error(
        "Could not load the MuseScore engine (webmscore). Check your internet connection and try again."
      ));
    };
    document.head.appendChild(script);
  });

  return webMscoreReadyPromise;
}

/**
 * Convert a MuseScore .mscz / .mscx file to a MIDI ArrayBuffer using webmscore.
 */
async function museScoreFileToMidiArrayBuffer(file) {
  elements.status.textContent = "Loading MuseScore engine…";
  const WebMscore = await ensureWebMscore();

  elements.status.textContent = "Reading MuseScore score…";
  const data = new Uint8Array(await file.arrayBuffer());
  const format = /\.mscx$/i.test(file.name) ? "mscx" : "mscz";

  // doLayout=false = boost mode (much faster when we only need MIDI)
  const score = await WebMscore.load(format, data, [], false);
  try {
    elements.status.textContent = "Converting MuseScore → MIDI…";
    const midiBytes = await score.saveMidi(true, true);
    return midiBytes.buffer.slice(
      midiBytes.byteOffset,
      midiBytes.byteOffset + midiBytes.byteLength
    );
  } finally {
    try { score.destroy(); } catch (_) {}
  }
}

async function convertMidi() {

  if (!midiFile) {
    return;
  }

  elements.convertButton.disabled = true;

  const fromMuseScore = isMuseScoreFileName(midiFile.name);
  elements.status.textContent = fromMuseScore
    ? "Reading MuseScore score…"
    : "Reading MIDI…";

  clearError();

  try {

    const arrayBuffer = fromMuseScore
      ? await museScoreFileToMidiArrayBuffer(midiFile)
      : await midiFile.arrayBuffer();

    /*
     * Midi is provided by @tonejs/midi.
     */
    const midi =
      new Midi(arrayBuffer);


    const tracks =
      midi.tracks.map(track => ({
        ...track,
        ppq: midi.header.ppq
      }));

    // Time signatures from the MIDI (Tone.js: [{ ticks, timeSignature: [num, den] }, ...])
    const timeSignatures = normalizeTimeSignatures(
      midi.header?.timeSignatures,
      midi.header?.ppq || 480
    );

    const transpose =
      elements.transposeMode.value === "auto"
        ? findBestTranspose(tracks)
        : 0;

    conversionResults =
      tracks
        .map((track, index) =>
          convertTrack(
            track,
            index,
            elements.beatGrid.value,
            transpose,
            elements.preserveFastNotes.checked,
            timeSignatures
          )
        )
        .filter(Boolean);


    if (conversionResults.length === 0) {
      throw new Error(
        "No note events were found in this MIDI file."
      );
    }


    renderChannels();

    const transposeLabel =
      transpose === 0
        ? "Original key"
        : `${transpose > 0 ? "+" : ""}${transpose} semitone${Math.abs(transpose) === 1 ? "" : "s"}`;

    const primaryTs = timeSignatures[0];
    const tsLabel = primaryTs
      ? `${primaryTs.numerator}/${primaryTs.denominator}`
      : "4/4";

    elements.status.textContent =
      `${conversionResults.length} track${
        conversionResults.length === 1 ? "" : "s"
      } · ${
        conversionResults.reduce(
          (total, track) => total + track.noteCount,
          0
        )
      } notes · ${transposeLabel} · ${tsLabel}`;

    enableExportButtons();

  }
  catch (error) {

    showError(
      error.message ||
      "Could not read this score file."
    );

    elements.status.textContent =
      "Conversion failed";

  }
  finally {

    elements.convertButton.disabled = false;

  }
}


/* ============================================================
   6. NOTE → GW2 NOTATION
   ============================================================ */


/*
 * MIDI pitch classes:
 *
 * C  = 0
 * C# = 1
 * D  = 2
 * D# = 3
 * E  = 4
 * F  = 5
 * F# = 6
 * G  = 7
 * G# = 8
 * A  = 9
 * A# = 10
 * B  = 11
 *
 * GW2 numeric notation uses:
 *
 * C  = 1
 * D  = 2
 * E  = 3
 * F  = 4
 * G  = 5
 * A  = 6
 * B  = 7
 *
 * Accidentals are prefixed with #.
 */
const PITCH_NAMES = [
  "1",
  "#1",
  "2",
  "#2",
  "3",
  "4",
  "#4",
  "5",
  "#5",
  "6",
  "#6",
  "7"
];


function getPitchText(midiNote) {

  const pitchClass =
    midiNote % 12;

  let notation =
    PITCH_NAMES[pitchClass];


  /*
   * Reference octave.
   *
   * This is deliberately kept in one place so it is easy
   * to adjust if your preferred GW2 octave mapping differs.
   */
  const midiOctave =
    Math.floor(midiNote / 12) - 5;


  const referenceOctave =
    selectedOctave === "low"
      ? 0
      : selectedOctave === "high"
        ? 2
        : 1;


  const octaveDifference =
    midiOctave - referenceOctave;


  if (octaveDifference === 0) {

    return {
      text: notation,
      className: ""
    };

  }


  if (octaveDifference === -1) {

    return {
      text: `[${notation}]`,
      className: "low"
    };

  }


  if (octaveDifference <= -2) {

    return {
      text: `{${notation}}`,
      className: "outside"
    };

  }


  if (octaveDifference === 1) {

    return {
      text: `(${notation})`,
      className: "high"
    };

  }


  return {
    text: `<${notation}>`,
    className: "outside"
  };
}


/*
 * Convert one MIDI note into HTML.
 *
 * Keeping HTML generation here makes the renderer easier to
 * modify later.
 */
function noteToHtml(midiNote) {

  const pitch =
    getPitchText(midiNote);


  const escaped =
    pitch.text
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");


  return `<span class="${pitch.className}">${escaped}</span>`;
}


/* ============================================================
   7. TRACK CONVERSION
   ============================================================ */

function findBestTranspose(tracks) {

  const notes = tracks
    .filter(track => track.channel !== 9)
    .flatMap(track => track.notes || []);

  if (!notes.length) {
    return 0;
  }

  // GW2's three octave playable span in this converter: C3–C6.
  const PLAYABLE_MIN = 48;
  const PLAYABLE_MAX = 84;

  let best = null;

  for (let transpose = -6; transpose <= 6; transpose++) {
    let accidentals = 0;
    let outOfRange = 0;

    for (const note of notes) {
      const midi = note.midi + transpose;
      const pitchClass = ((midi % 12) + 12) % 12;

      if ([1, 3, 6, 8, 10].includes(pitchClass)) {
        accidentals++;
      }

      if (midi < PLAYABLE_MIN || midi > PLAYABLE_MAX) {
        outOfRange++;
      }
    }

    // Prefer a key with fewer accidentals first, then keep notes in the
    // playable span, then prefer the smallest transposition. This prevents
    // the optimizer from keeping lots of sharps just to save one out-of-range note.
    const score =
      accidentals * 10000 +
      outOfRange * 100 +
      Math.abs(transpose) * 0.01;

    const candidate = {
      transpose,
      accidentals,
      outOfRange,
      score
    };

    if (!best || candidate.score < best.score) {
      best = candidate;
    }
  }

  return best?.transpose ?? 0;
}


function detectPlaybackInstrument(track, index = 0) {
  /* Prefer the displayed/fallback track name over conflicting program metadata. */
  const displayedName = track.name || DEFAULT_TRACK_NAMES[index] || `Track ${index + 1}`;
  const trackName = String(displayedName).toLowerCase();
  const instrumentSource = [track.instrument?.name, track.instrument?.family]
    .filter(Boolean).join(" ").toLowerCase();

  const meaningfulTrackName = trackName &&
    !/^track\s*\d+$/i.test(trackName) &&
    !/^channel\s*\d+$/i.test(trackName) &&
    !/^(harmony|melody|part\s*[a-z0-9]+)$/i.test(trackName);

  const nameSource = meaningfulTrackName ? trackName : instrumentSource;

  if (/piano|grand piano|upright piano|electric piano|keys|keyboard/.test(nameSource)) return "piano";
  if (/lute|oud|mandolin/.test(nameSource)) return "lute";
  if (/harp/.test(nameSource)) return "harp";
  if (/violin|viola|cello|contrabass|string|orchestra/.test(nameSource)) return "strings";
  if (/trumpet|trombone|horn|brass|tuba/.test(nameSource)) return "brass";
  if (/flute|piccolo|recorder|pan pipe|whistle/.test(nameSource)) return "flute";
  if (/guitar/.test(nameSource)) return "guitar";
  if (/bass/.test(nameSource)) return "bass";
  if (/organ|church|reed organ/.test(nameSource)) return "organ";
  if (/choir|voice|vocal|vocoder/.test(nameSource)) return "choir";
  if (/synth|lead|pad|fx|effect/.test(nameSource)) return "synth";

  /* Fall back to the zero-based General MIDI program number. */
  const number = Number(track.instrument?.number);
  if (Number.isFinite(number)) {
    if (number >= 0 && number <= 7) return "piano";
    if (number >= 24 && number <= 31) return "guitar";
    if (number >= 32 && number <= 39) return "bass";
    if (number >= 40 && number <= 51) return number === 46 ? "harp" : "strings";
    if (number >= 56 && number <= 63) return "brass";
    if (number >= 73 && number <= 79) return "flute";
    if (number >= 88 && number <= 95) return "synth";
    if (number >= 96 && number <= 103) return "synth";
  }

  return "piano";
}

const PLAYBACK_INSTRUMENT_LABELS = {
  piano: "Piano",
  strings: "Strings",
  brass: "Brass",
  flute: "Flute",
  guitar: "Guitar",
  lute: "Lute",
  harp: "Harp",
  bass: "Bass",
  organ: "Organ",
  choir: "Choir",
  synth: "Synth"
};

/**
 * Normalize MIDI header time signatures into a sorted list.
 * Each entry: { ticks, numerator, denominator, beatsPerBar }
 * beatsPerBar is measured in quarter-note beats (our notation grid unit):
 *   4/4 → 4,  3/4 → 3,  6/8 → 3,  2/2 → 4
 */
function normalizeTimeSignatures(rawList, ppq = 480) {
  const list = Array.isArray(rawList) ? rawList : [];
  const normalized = list
    .map(entry => {
      const pair = entry?.timeSignature || entry;
      const numerator = Number(Array.isArray(pair) ? pair[0] : entry?.numerator) || 4;
      const denominator = Number(Array.isArray(pair) ? pair[1] : entry?.denominator) || 4;
      const ticks = Number(entry?.ticks) || 0;
      const beatsPerBar = Math.max(1, numerator * (4 / denominator));
      return { ticks, numerator, denominator, beatsPerBar };
    })
    .filter(ts => Number.isFinite(ts.beatsPerBar) && ts.beatsPerBar > 0)
    .sort((a, b) => a.ticks - b.ticks);

  if (!normalized.length) {
    return [{ ticks: 0, numerator: 4, denominator: 4, beatsPerBar: 4 }];
  }
  // Ensure we always have a signature at tick 0
  if (normalized[0].ticks > 0) {
    normalized.unshift({
      ticks: 0,
      numerator: normalized[0].numerator,
      denominator: normalized[0].denominator,
      beatsPerBar: normalized[0].beatsPerBar
    });
  }
  return normalized;
}

/** Beats-per-bar (in quarter notes) active at a given tick. */
function beatsPerBarAtTick(tick, timeSignatures) {
  let current = timeSignatures[0] || { beatsPerBar: 4 };
  for (const ts of timeSignatures) {
    if (ts.ticks <= tick) current = ts;
    else break;
  }
  return current.beatsPerBar;
}

function convertTrack(
  track,
  index,
  beatGrid,
  transpose = 0,
  preserveFastNotes = true,
  timeSignatures = null
) {

  if (!track.notes.length) {
    return null;
  }

  const ppq = Number(track.ppq) || 480;
  const notes = track.notes;
  const requestedGrid = beatGrid === "auto" ? 1 : Number(beatGrid);
  const tempoBpm = Number(elements.tempo?.value) || 120;
  const secondsPerBeat = 60 / tempoBpm;
  const tsList = timeSignatures && timeSignatures.length
    ? timeSignatures
    : [{ ticks: 0, numerator: 4, denominator: 4, beatsPerBar: 4 }];
  const primaryBeatsPerBar = tsList[0].beatsPerBar || 4;

  const toTicks = note => {
    if (Number.isFinite(note.ticks)) return note.ticks;
    return Math.round((note.time / secondsPerBeat) * ppq);
  };

  const toDurationTicks = note => {
    if (Number.isFinite(note.durationTicks)) return note.durationTicks;
    return Math.max(1, Math.round((note.duration / secondsPerBeat) * ppq));
  };

  const events = notes.map(note => {
    const startTick = toTicks(note);
    const durationTicks = toDurationTicks(note);
    return {
      midi: note.midi + transpose,
      startTick,
      durationTicks,
      endTick: startTick + durationTicks
    };
  }).sort((a, b) =>
    a.startTick - b.startTick || a.midi - b.midi
  );

  const songEnd = Math.max(...events.map(event => event.endTick));
  const beatCount = Math.max(1, Math.ceil(songEnd / ppq));
  const maxSubdivision = 0.0625;
  const subdivisionLevels = [1, 0.5, 0.25, 0.125, 0.0625];

  /*
   * Beat Grid now controls the maximum resolution of each beat.
   * With "Preserve fast notes" enabled, we only subdivide a beat
   * when that beat actually contains faster onsets. This avoids
   * turning the entire song into a fine grid just because one
   * passage contains quick notes.
   *
   * Auto is equivalent to a one-beat base grid with preservation
   * enabled, so it keeps the MIDI's natural rhythm without asking
   * the user to guess a resolution.
   */
  const chooseLocalGrid = beatEvents => {
    if (beatGrid === "auto") return chooseAdaptiveGrid(beatEvents, ppq, 1);
    if (!preserveFastNotes) return requestedGrid;
    return chooseAdaptiveGrid(beatEvents, ppq, requestedGrid);
  };

  const chooseAdaptiveGrid = (beatEvents, beatTicks, baseGrid) => {
    if (beatEvents.length < 2) return baseGrid;

    const starts = [...new Set(beatEvents.map(event => event.startTick))].sort((a, b) => a - b);
    if (starts.length < 2) return baseGrid;

    let minimumSpacingBeats = Infinity;
    for (let i = 1; i < starts.length; i++) {
      minimumSpacingBeats = Math.min(
        minimumSpacingBeats,
        (starts[i] - starts[i - 1]) / beatTicks
      );
    }

    for (const subdivision of subdivisionLevels) {
      if (
        subdivision <= baseGrid &&
        subdivision <= minimumSpacingBeats + 1e-9
      ) {
        return subdivision;
      }
    }

    return maxSubdivision;
  };

  const beats = [];
  const effectiveGrids = [];

  for (let beatIndex = 0; beatIndex < beatCount; beatIndex++) {
    const beatStart = beatIndex * ppq;
    const beatEnd = beatStart + ppq;
    const beatEvents = events.filter(event =>
      event.startTick >= beatStart && event.startTick < beatEnd
    );

    const effectiveGrid = chooseLocalGrid(beatEvents);
    effectiveGrids.push(effectiveGrid);
    const gridTicks = Math.max(1, Math.round(ppq * effectiveGrid));
    const slotsPerBeat = Math.max(1, Math.round(ppq / gridTicks));
    const cells = Array.from({ length: slotsPerBeat }, () => []);

    for (const event of beatEvents) {
      const relativeTick = event.startTick - beatStart;
      const slot = Math.max(
        0,
        Math.min(slotsPerBeat - 1, Math.round(relativeTick / gridTicks))
      );
      cells[slot].push({
        midi: event.midi,
        durationBeats: event.durationTicks / ppq
      });
    }

    const tokens = cells.map((cell, slotIndex) => {
      const slotStartBeat = beatIndex + (slotIndex * effectiveGrid);
      const slotDuration = effectiveGrid;

      if (!cell.length) {
        const pause = effectiveGrid === 1 ? "━" : "-";
        return `<span class="playback-beat playback-empty" data-start-beat="${slotStartBeat.toFixed(6)}" data-duration-beats="${slotDuration.toFixed(6)}">${pause}</span>`;
      }

      const uniqueNotes = [...new Set(cell.map(note => note.midi))].sort((a, b) => a - b);
      const chordPitches = uniqueNotes.map(note => ({ midi: note, pitch: getPitchText(note) }));
      const chordClasses = new Set(chordPitches.map(item => item.pitch.className));
      let token;

      // If every note in a chord uses the same octave marker, apply the
      // marker once around the chord: [4]/[7] becomes [4/7], etc.
      if (uniqueNotes.length > 1 && chordClasses.size === 1 && chordPitches[0].pitch.className) {
        const octaveClass = chordPitches[0].pitch.className;
        const marker = octaveClass === "low" ? ["[", "]"]
          : octaveClass === "high" ? ["(", ")"]
          : chordPitches.every(item => item.pitch.text.startsWith("{")) ? ["{", "}"]
          : ["&lt;", "&gt;"];
        const noteTexts = chordPitches.map(item => {
          let text = item.pitch.text;
          if (octaveClass === "low" || octaveClass === "high") text = text.slice(1, -1);
          else if (text.startsWith("{")) text = text.slice(1, -1);
          else if (text.startsWith("<")) text = text.slice(1, -1);
          return text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        });
        token = `<span class="${octaveClass} octave-compressed">${marker[0]}${noteTexts.join('<span class="accidental">/</span>')}${marker[1]}</span>`;
      } else {
        token = chordPitches.map(item => noteToHtml(item.midi).replace(/<span class="([^"]*)">([\s\S]*?)<\/span>/, (whole, cls, text) => `<span class="${cls}">${text}</span>`))
          .join('<span class="accidental">/</span>');
      }

      if (uniqueNotes.length > 1) {
        token = `<span class="chord">${token}</span>`;
      }

      const durationBeats = Math.max(...cell.map(note => note.durationBeats));
      if (durationBeats >= 1.75) token += "·.";
      else if (durationBeats >= 1.5) token += "·";
      else if (durationBeats >= 1.25) token += ".";

      return `<span class="playback-beat playback-note" data-start-beat="${slotStartBeat.toFixed(6)}" data-duration-beats="${Math.max(slotDuration, durationBeats).toFixed(6)}">${token}</span>`;
    });

    beats.push(`<span class="playback-beat-group" data-beat-index="${beatIndex}">${tokens.join("")}</span>`);
  }

  // Compress repeated octave markers across adjacent notes, even when a bar
  // also contains notes in the normal octave. Playback spans remain intact.
  const simplifyOctaveBar = barBeats => {
    let html = barBeats.map((beat, i) => `${i === 0 ? "" : i === 2 ? "  " : " "}${beat}`).join("");

    // For example: (3) (2) (2) (1) -> (32) (2) (21)
    // Only merge directly adjacent marked notes of the same octave; rests,
    // normal-octave notes, chords, and octave changes naturally break a run.
    const markerInfo = {
      low: { open: "[", close: "]" },
      high: { open: "(", close: ")" },
      outsideLow: { open: "{", close: "}" },
      outsideHigh: { open: "&lt;", close: "&gt;" }
    };
    const tokenPattern = /<span class="playback-beat playback-note"[^>]*>(<span class="(?:low|high|outside)">[\s\S]*?<\/span>)<\/span>/g;
    const tokens = [...html.matchAll(tokenPattern)];
    const candidates = tokens.map((m, index) => {
      const content = m[1];
      const pitch = content.match(/^<span class="(low|high|outside)">([\s\S]*?)<\/span>$/);
      if (!pitch) return { index, match: m, cls: null, value: null };
      const cls = pitch[1];
      const value = pitch[2];
      if (cls === "low" && /^\[[^\[\]]+\]$/.test(value)) return { index, match: m, cls, value: value.slice(1, -1) };
      if (cls === "high" && /^\([^()]+\)$/.test(value)) return { index, match: m, cls, value: value.slice(1, -1) };
      if (cls === "outside" && /^\{[^{}]+\}$/.test(value)) return { index, match: m, cls: "outsideLow", value: value.slice(1, -1) };
      if (cls === "outside" && /^&lt;[\s\S]+&gt;$/.test(value)) return { index, match: m, cls: "outsideHigh", value: value.slice(4, -4) };
      return { index, match: m, cls: null, value: null };
    });

    // Work backwards so replacing a token never invalidates earlier offsets.
    const replacements = [];
    let i = 0;
    while (i < candidates.length) {
      const first = candidates[i];
      if (!first.cls) { i++; continue; }
      let end = i;
      while (end + 1 < candidates.length && candidates[end + 1].cls === first.cls) {
        const between = html.slice(candidates[end].match.index + candidates[end].match[0].length, candidates[end + 1].match.index);
        // Permit only the visual spacing between note tokens, not bar separators.
        if (!/^\s*$/.test(between)) break;
        end++;
      }
      if (end > i) {
        const info = markerInfo[first.cls];
        for (let j = i; j <= end; j++) {
          const item = candidates[j];
          const open = j === i ? info.open : "";
          const close = j === end ? info.close : "";
          const newToken = item.match[0].replace(item.match[1], `<span class="${item.cls === "outsideLow" || item.cls === "outsideHigh" ? "outside" : item.cls}">${open}${item.value}${close}</span>`);
          replacements.push({ start: item.match.index, end: item.match.index + item.match[0].length, value: newToken });
        }
      }
      i = end + 1;
    }
    for (const r of replacements.sort((a, b) => b.start - a.start)) html = html.slice(0, r.start) + r.value + html.slice(r.end);
    const pitchSpans = [...html.matchAll(/<span class="(low|high|outside)">([\s\S]*?)<\/span>/g)];
    if (!pitchSpans.length) return html;

    const classes = new Set(pitchSpans.map(match => match[1]));
    const allNotesMarked = !/<span class="">/.test(html) &&
      [...html.matchAll(/<span class="([^"]*)">([\s\S]*?)<\/span>/g)]
        .filter(match => /^(low|high|outside)$/.test(match[1]) || /^[#]?[1-7]$/.test(match[2]))
        .every(match => /^(low|high|outside)$/.test(match[1]));
    if (classes.size !== 1 || !allNotesMarked) return html;

    const octaveClass = [...classes][0];
    const allInner = pitchSpans.map(match => match[2]);
    let open, close;
    if (octaveClass === "low") { open = "["; close = "]"; }
    else if (octaveClass === "high") { open = "("; close = ")"; }
    else if (allInner.every(text => text.startsWith("{") && text.endsWith("}"))) { open = "{"; close = "}"; }
    else if (allInner.every(text => text.startsWith("&lt;") && text.endsWith("&gt;"))) { open = "&lt;"; close = "&gt;"; }
    else return html;

    const inner = html.replace(/<span class="(?:low|high|outside)">([\s\S]*?)<\/span>/g, "$1")
      .split(open).join("").split(close).join("");
    return `<span class="${octaveClass} octave-compressed">${open}${inner}${close}</span>`;
  };

  /*
   * Build lines with "|" at real measure boundaries from the time signature.
   * Example: 4/4 → every 4 beats, 3/4 → every 3, 6/8 → every 3 quarter-beats.
   * Time-signature changes mid-song are respected when present in the MIDI.
   */
  const lines = [];
  // Prefer ~3 measures per line (falls back toward ~12 quarter-beats of width)
  const measuresPerLine = Math.max(1, Math.round(12 / primaryBeatsPerBar));

  let line = "";
  let measuresOnLine = 0;
  let measureBeatCount = 0;
  let measureChunks = []; // beat strings inside the current measure

  const flushMeasure = (isLastOnLine) => {
    if (!measureChunks.length) return;
    if (line.length) line += '<span class="bar"> | </span>';
    line += simplifyOctaveBar(measureChunks);
    measureChunks = [];
    measuresOnLine += 1;
    if (!isLastOnLine && measuresOnLine >= measuresPerLine) {
      lines.push(line);
      line = "";
      measuresOnLine = 0;
    }
  };

  for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
    const tick = beatIndex * ppq;
    const bpb = beatsPerBarAtTick(tick, tsList);

    // Starting a new measure after completing the previous one
    if (measureBeatCount === 0 && measureChunks.length === 0 && beatIndex > 0) {
      // boundary already handled by flush; nothing extra
    }

    measureChunks.push(beats[beatIndex]);
    measureBeatCount += 1;

    if (measureBeatCount + 1e-9 >= bpb) {
      flushMeasure(false);
      measureBeatCount = 0;
    }
  }

  // Remainder of the last (possibly incomplete) measure
  if (measureChunks.length) flushMeasure(true);
  if (line.length) lines.push(line);

  return {
    index,
    channel: track.channel ?? index,
    name: track.name || DEFAULT_TRACK_NAMES[index] || `Track ${index + 1}`,
    html: lines.join("<br>"),
    // Plain-text version used by Copy All and Download TXT.
    // Keep the same notation and separators, but remove playback/UI markup.
    plain: lines
      .map(line => line.replace(/<[^>]*>/g, ""))
      .join("\n"),
    noteCount: notes.length,
    color: CHANNEL_COLORS[(track.channel ?? index) % CHANNEL_COLORS.length],
    playbackInstrument: detectPlaybackInstrument(track, index),
    instrumentNumber: Number.isInteger(track.instrument?.number) ? track.instrument.number : null,
    playbackInstrumentLabel: PLAYBACK_INSTRUMENT_LABELS[detectPlaybackInstrument(track, index)] || "Piano",
    selectedSoundFontProgram: getDefaultSoundFontProgram({ playbackInstrument: detectPlaybackInstrument(track, index) }),
    playbackNotes: events.map(event => ({
      midi: event.midi,
      startBeat: event.startTick / ppq,
      durationBeats: Math.max(0.01, event.durationTicks / ppq)
    })),
    effectiveGrid: Math.min(...effectiveGrids),
    requestedGrid: beatGrid,
    transpose,
    beatsPerBar: primaryBeatsPerBar,
    timeSignature: `${tsList[0].numerator}/${tsList[0].denominator}`
  };
}


/* ============================================================
   8. OUTPUT RENDERING
   ============================================================ */

const SOUND_FONT_PRESETS = [
  { name: "Minstrel", bank: 0, program: 0 },
  { name: "Piano", bank: 0, program: 1 },
  { name: "Bell", bank: 0, program: 8 },
  { name: "Bell (Legacy)", bank: 0, program: 14 },
  { name: "Choir Bell (Legacy)", bank: 0, program: 15 },
  { name: "Pipe Organ", bank: 0, program: 19 },
  { name: "Lute", bank: 0, program: 24 },
  { name: "Bass", bank: 0, program: 33 },
  { name: "Harp", bank: 0, program: 46 },
  { name: "Horn", bank: 0, program: 56 },
  { name: "Verdarach", bank: 0, program: 58 },
  { name: "Flute", bank: 0, program: 73 },
  { name: "Choir Bell", bank: 0, program: 112 },
  { name: "Drums", bank: 0, program: 114 }
];
function getSoundFontPresetOptions(selectedProgram = 1) {
  return SOUND_FONT_PRESETS.map(p => `<option value="${p.program}" data-bank="${p.bank}" ${p.program === Number(selectedProgram) ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
}
function getDefaultSoundFontProgram(track) {
  const type = track?.playbackInstrument || "piano";
  const defaults = { piano: 1, strings: 0, brass: 56, flute: 73, guitar: 24, lute: 24, harp: 46, bass: 33, organ: 19, choir: 112, synth: 0 };
  return defaults[type] ?? 1;
}
function setupTrackInstrumentSelectors() {
  elements.channels.querySelectorAll(".track-instrument-select").forEach(select => {
    select.addEventListener("change", async () => {
      const index = Number(select.dataset.trackIndex);
      const track = conversionResults[index];
      if (!track) return;
      track.selectedSoundFontProgram = Number(select.value);
      const state = trackPlayers.get(index);
      if (state) {
        state.track = track;
        // Stop any currently ringing notes so the change is immediately audible.
        const shift = state.trackShift || 0;
        state.voices.forEach(voice => {
          if (voice?.soundFont) soundFontNoteOff(voice.channel, voice.midi, null, shift);
        });
        state.voices.clear();
        soundFontAllNotesOff(soundFontChannelForTrack(index));
      }
      const label = SOUND_FONT_PRESETS.find(p => p.program === track.selectedSoundFontProgram)?.name || "Custom";
      const info = elements.channels.querySelector(`[data-track-index="${index}"] .channel-info`);
      if (info) info.textContent = `${track.noteCount} notes · ${label}`;
      if (soundFontEngine.status !== "ready") await ensureSoundFontReady();
      if (soundFontEngine.status === "ready") {
        prepareSoundFontChannel(soundFontChannelForTrack(index), track);
      } else {
        console.warn("SoundFont unavailable; track playback will use the basic fallback sound.");
      }
    });
  });
}

function renderChannels() {

  elements.channels.innerHTML =
    conversionResults
      .map((track, index) => {

        return `
          <div class="channel" data-track-index="${index}">

            <div
              class="channel-meta"
              style="--channel-color: ${track.color}"
            >
              <div class="channel-heading">
                <div class="channel-accent"></div>
                <div>
                  <div class="channel-name">
                    ${escapeHtml(track.name)}
                  </div>

                  <div class="channel-info">
                    ${track.noteCount} notes · ${escapeHtml(track.playbackInstrumentLabel)}
                  </div>
                </div>
              </div>

              <div class="track-controls">
                <label class="instrument-picker">Sound
                  <select class="track-instrument-select" data-track-index="${index}" aria-label="Choose sound for ${escapeHtml(track.name)}">
                    ${getSoundFontPresetOptions(track.selectedSoundFontProgram ?? getDefaultSoundFontProgram(track))}
                  </select>
                </label>
                <div class="track-player" data-player-index="${index}">
                <button type="button" class="track-play" title="Play this track">▶ Play</button>
                <button type="button" class="track-pause" title="Pause this track">⏸ Pause</button>
                <button type="button" class="track-stop" title="Stop this track">■ Stop</button>
                </div>
              </div>
            </div>

            <div class="notation">${track.html}</div>

          </div>
        `;

      })
      .join("");

  setupTrackPlayers();
  setupTrackInstrumentSelectors();
  setGlobalPlaybackUI("stopped");
  setGlobalPlaybackEnabled(true);

}



function clearPlaybackHighlights() {
  document.querySelectorAll(".playback-active, .playback-current-beat").forEach(el => {
    el.classList.remove("playback-active", "playback-current-beat");
  });
}

function updatePlaybackHighlights(positionSeconds, trackIndex = null) {
  const tempoBpm = Number(elements.tempo?.value) || 120;
  const positionBeat = positionSeconds / (60 / tempoBpm);
  const scope = trackIndex === null
    ? elements.channels
    : elements.channels.querySelector(`[data-track-index="${trackIndex}"]`);

  if (!scope) return;

  scope.querySelectorAll(".playback-beat").forEach(el => {
    const start = Number(el.dataset.startBeat);
    const duration = Number(el.dataset.durationBeats) || 0;
    const active = positionBeat >= start - 0.015 && positionBeat < start + duration;
    el.classList.toggle("playback-active", active);
  });

  scope.querySelectorAll(".playback-beat-group").forEach(el => {
    const index = Number(el.dataset.beatIndex);
    const active = positionBeat >= index && positionBeat < index + 1;
    el.classList.toggle("playback-current-beat", active);
  });
}

let playbackHighlightFrame = null;
function startPlaybackHighlightLoop() {
  if (playbackHighlightFrame !== null) return;
  const tick = () => {
    clearPlaybackHighlights();

    if (globalPlaybackState.status === "playing") {
      const elapsed = Math.max(0, performance.now() / 1000 - globalPlaybackState.startedAt);
      updatePlaybackHighlights(elapsed);
      playbackHighlightFrame = requestAnimationFrame(tick);
      return;
    }

    const playingStates = [...trackPlayers.values()].filter(state => state.status === "playing");
    if (playingStates.length) {
      const now = performance.now() / 1000;
      playingStates.forEach(state => {
        const elapsed = Math.max(0, now - state.startedAt);
        updatePlaybackHighlights(elapsed, state.index);
      });
      playbackHighlightFrame = requestAnimationFrame(tick);
    } else {
      playbackHighlightFrame = null;
    }
  };
  playbackHighlightFrame = requestAnimationFrame(tick);
}

/* ============================================================
   8B. TRACK AUDIO PLAYBACK
   ============================================================ */

const trackPlayers = new Map();
let playbackAudioContext = null;

function getPlaybackAudioContext() {
  if (!playbackAudioContext) {
    playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return playbackAudioContext;
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* ============================================================
   SoundFont audio engine (FluidSynth WASM)
   The same engine powers track playback and the on-page piano.

   Works over http(s) via fetch. On file:// (opening index.html
   directly) browsers block fetch of local assets, so we fall
   back to a one-time file picker for assets/gw2Instruments.sf2.
   ============================================================ */
const soundFontEngine = {
  synth: null,
  node: null,
  gainNode: null,
  soundFontId: -1,
  readyPromise: null,
  status: "not-loaded", // not-loaded | loading | ready | error | needs-file
  lastError: null,
  channelsInUse: new Set(),
  /** Cached ArrayBuffer when user picked the SF2 via file input */
  pickedBuffer: null,
  /** FluidSynth master gain (library default is ~0.2 — too quiet). Range ~0–5. */
  masterGain: 1.4,
  /** Extra Web Audio gain after the synth (keeps headroom without clipping). */
  outputGain: 2.8
};

function setSoundFontStatusMessage(message) {
  if (pianoElements?.status) {
    pianoElements.status.textContent = message;
  }
}

/**
 * Ask the user to pick assets/gw2Instruments.sf2 (needed on file://).
 * Returns ArrayBuffer or throws if cancelled.
 */
function pickSoundFontFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".sf2,audio/x-soundfont,application/octet-stream";
    input.style.display = "none";
    document.body.appendChild(input);

    const cleanup = () => {
      input.remove();
    };

    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      cleanup();
      if (!file) {
        reject(new Error("No SoundFont file selected"));
        return;
      }
      try {
        setSoundFontStatusMessage(`Reading ${file.name}…`);
        const buffer = await file.arrayBuffer();
        resolve(buffer);
      } catch (err) {
        reject(err);
      }
    });

    // If the user closes the dialog without choosing, some browsers
    // never fire change — treat focus return as cancel after a tick.
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files || !input.files.length) {
          cleanup();
          window.removeEventListener("focus", onFocus);
          reject(new Error("SoundFont file selection cancelled"));
        }
      }, 600);
    };
    window.addEventListener("focus", onFocus, { once: true });

    setSoundFontStatusMessage("Select assets/gw2Instruments.sf2 to enable sound…");
    input.click();
  });
}

const SOUND_FONT_CACHE_KEY = "gw2Instruments.sf2.v1";

async function readSoundFontFromCache() {
  try {
    if (!("indexedDB" in window)) return null;
    const db = await openSoundFontDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("sf2", "readonly");
      const req = tx.objectStore("sf2").get(SOUND_FONT_CACHE_KEY);
      req.onsuccess = () => {
        const row = req.result;
        if (row?.buffer instanceof ArrayBuffer && row.buffer.byteLength > 1000) {
          resolve(row.buffer);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("SoundFont cache read failed", e);
    return null;
  }
}

async function writeSoundFontToCache(buffer) {
  try {
    if (!("indexedDB" in window) || !(buffer instanceof ArrayBuffer)) return;
    const db = await openSoundFontDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("sf2", "readwrite");
      tx.objectStore("sf2").put({
        id: SOUND_FONT_CACHE_KEY,
        buffer,
        savedAt: Date.now(),
        byteLength: buffer.byteLength
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("SoundFont cache write failed (storage may be full)", e);
  }
}

function openSoundFontDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("gw2-midi-soundfont", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sf2")) {
        db.createObjectStore("sf2", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Fetch with byte progress so mobile users see it's not frozen. */
async function fetchSoundFontWithProgress(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const total = Number(response.headers.get("Content-Length")) || 0;
  // Streaming progress when the body is readable
  if (!response.body || !response.body.getReader) {
    setSoundFontStatusMessage("Downloading SoundFont (≈43 MB)…");
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0) {
      const pct = Math.min(99, Math.round((received / total) * 100));
      const mb = (received / (1024 * 1024)).toFixed(1);
      const totalMb = (total / (1024 * 1024)).toFixed(0);
      setSoundFontStatusMessage(`Downloading SoundFont… ${pct}% (${mb}/${totalMb} MB)`);
    } else {
      const mb = (received / (1024 * 1024)).toFixed(1);
      setSoundFontStatusMessage(`Downloading SoundFont… ${mb} MB`);
    }
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

async function loadSoundFontBuffer() {
  // Prefer a previously picked file (file:// path)
  if (soundFontEngine.pickedBuffer) {
    return soundFontEngine.pickedBuffer;
  }

  // Instant path: cached from a previous visit (huge win on mobile)
  setSoundFontStatusMessage("Checking SoundFont cache…");
  const cached = await readSoundFontFromCache();
  if (cached) {
    setSoundFontStatusMessage("Loaded SoundFont from cache…");
    soundFontEngine.pickedBuffer = cached;
    return cached;
  }

  // Try network fetch (works on https / http hosts like GitHub Pages)
  try {
    const buffer = await fetchSoundFontWithProgress("assets/gw2Instruments.sf2");
    if (!buffer || buffer.byteLength < 1000) {
      throw new Error("SoundFont file is empty or too small");
    }
    // Cache for next visit (non-blocking)
    writeSoundFontToCache(buffer);
    soundFontEngine.pickedBuffer = buffer;
    return buffer;
  } catch (fetchError) {
    console.warn(
      "Could not fetch assets/gw2Instruments.sf2 (common when opening index.html via file://).",
      fetchError
    );
    // Fall back: let the user pick the file once
    soundFontEngine.status = "needs-file";
    const buffer = await pickSoundFontFile();
    soundFontEngine.pickedBuffer = buffer;
    writeSoundFontToCache(buffer);
    return buffer;
  }
}

async function ensureSoundFontReady() {
  if (soundFontEngine.synth && soundFontEngine.status === "ready") {
    const ctx = getPlaybackAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    return true;
  }
  if (soundFontEngine.readyPromise) return soundFontEngine.readyPromise;

  soundFontEngine.status = "loading";
  soundFontEngine.lastError = null;
  setSoundFontStatusMessage("Loading SoundFont engine…");

  soundFontEngine.readyPromise = (async () => {
    try {
      if (!window.JSSynth) {
        throw new Error(
          "SoundFont engine scripts did not load. Keep js/vendor/ next to index.html, or allow CDN access."
        );
      }
      await window.JSSynth.waitForReady();

      const ctx = getPlaybackAudioContext();
      if (ctx.state === "suspended") await ctx.resume();

      const synth = new window.JSSynth.Synthesizer();
      // Higher polyphony so dense tracks / chords don't drop notes (default is often 256, but
      // some builds are lower). initialGain raises the quiet FluidSynth default (~0.2).
      try {
        synth.init(ctx.sampleRate, {
          polyphony: 256,
          initialGain: soundFontEngine.masterGain
        });
      } catch (_) {
        synth.init(ctx.sampleRate);
      }
      try {
        if (typeof synth.setGain === "function") {
          synth.setGain(soundFontEngine.masterGain);
        }
      } catch (e) {
        console.warn("Could not set FluidSynth master gain", e);
      }

      const node = synth.createAudioNode(ctx, 8192);
      // Extra GainNode so overall level is audible without maxing OS volume
      const gainNode = ctx.createGain();
      gainNode.gain.value = soundFontEngine.outputGain;
      node.connect(gainNode);
      gainNode.connect(ctx.destination);

      const sfBuffer = await loadSoundFontBuffer();

      // Parsing ~43 MB into FluidSynth WASM is the slow step on phones (CPU/memory).
      setSoundFontStatusMessage(
        "Initializing synthesizer… (first time can take 30–90s on mobile)"
      );
      // Yield so the status text paints before the heavy WASM work blocks the main thread
      await new Promise(r => setTimeout(r, 50));

      soundFontEngine.soundFontId = await synth.loadSFont(sfBuffer);
      soundFontEngine.synth = synth;
      soundFontEngine.node = node;
      soundFontEngine.gainNode = gainNode;
      soundFontEngine.status = "ready";
      soundFontEngine.lastError = null;
      setSoundFontStatusMessage("SoundFont ready · C4–C5");
      return true;
    } catch (error) {
      console.error("GW2 SoundFont could not be initialized.", error);
      soundFontEngine.status = "error";
      soundFontEngine.lastError = error?.message || String(error);
      soundFontEngine.readyPromise = null;
      setSoundFontStatusMessage(
        `SoundFont failed: ${soundFontEngine.lastError}`
      );
      return false;
    }
  })();

  return soundFontEngine.readyPromise;
}

const SOUND_FONT_PROGRAMS = {
  piano: 0, strings: 48, brass: 56, flute: 73, guitar: 24,
  lute: 24, harp: 46, bass: 32, organ: 19, choir: 52, synth: 80
};

/*
 * Actual sample key ranges in assets/gw2Instruments.sf2 (from SF2 zone data).
 * Notes outside these ranges are silent in FluidSynth — fold them into range
 * by octaves so high/low GW2 notes still produce sound.
 */
const SOUND_FONT_KEY_RANGES = {
  0: [48, 84],   // Minstrel
  1: [48, 84],   // Piano
  8: [60, 84],   // Bell
  14: [60, 84],  // Bell (Legacy) — same samples family
  15: [50, 86],  // Choir Bell (Legacy)
  19: [48, 83],  // Pipe Organ
  24: [48, 84],  // Lute
  33: [36, 60],  // Bass
  46: [48, 84],  // Harp
  56: [52, 88],  // Horn
  58: [24, 60],  // Verdarach
  73: [64, 88],  // Flute
  112: [50, 86], // Choir Bell
  114: [60, 67]  // Drums
};
const DEFAULT_KEY_RANGE = [48, 84];

/** program last selected per MIDI channel (for range folding) */
const channelProgram = new Map();
/** stacked note counts so overlapping same-pitch notes don't cut each other early */
const channelNoteCounts = new Map();

function noteCountKey(channel, midi) {
  return `${channel}:${midi}`;
}

function resolveSoundFontProgram(track) {
  const selectedProgram = Number(track?.selectedSoundFontProgram);
  const instrumentNumber = Number(track?.instrumentNumber);
  if (Number.isInteger(selectedProgram) && selectedProgram >= 0 && selectedProgram <= 127) {
    return selectedProgram;
  }
  if (Number.isInteger(instrumentNumber) && instrumentNumber >= 0 && instrumentNumber <= 127) {
    return instrumentNumber;
  }
  return SOUND_FONT_PROGRAMS[track?.playbackInstrument] ?? 1;
}

/**
 * Last-resort: map a single MIDI note into the preset sample range.
 * Prefer computeTrackOctaveShift + a uniform shift so melodies stay intact.
 */
function foldMidiToPresetRange(midi, program) {
  const range = SOUND_FONT_KEY_RANGES[program] || DEFAULT_KEY_RANGE;
  const [lo, hi] = range;
  let m = midi | 0;
  if (m >= lo && m <= hi) return m;
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  if (m < lo) m = lo;
  if (m > hi) m = hi;
  return m;
}

/**
 * Compute one whole-track octave shift so the phrase fits the SoundFont range.
 *
 * Logic (matches "shift the entire octave", not per-note):
 * 1. If everything already fits → 0
 * 2. If the highest notes are above the range → shift the whole track down
 *    by whole octaves until the top fits
 * 3. If the lowest notes are then below the range → shift up by whole octaves
 * 4. If the phrase is wider than the instrument can cover → center it on the
 *    playable window (still whole octaves); individual outliers still fold
 *
 * Using ±12 only keeps intervals and chord voicings sounding natural.
 */
function computeTrackOctaveShift(midiNotes, program) {
  if (!midiNotes || !midiNotes.length) return 0;

  const [lo, hi] = SOUND_FONT_KEY_RANGES[program] || DEFAULT_KEY_RANGE;
  const minN = Math.min(...midiNotes);
  const maxN = Math.max(...midiNotes);

  if (minN >= lo && maxN <= hi) return 0;

  let shift = 0;

  // Bring unplayable high notes down first (common for high-octave tracks)
  while (maxN + shift > hi) shift -= 12;

  // Then lift anything that fell under the floor
  while (minN + shift < lo) shift += 12;

  // Phrase wider than the instrument range: center on the playable window
  if (maxN + shift > hi || minN + shift < lo) {
    const phraseMid = (minN + maxN) / 2;
    const rangeMid = (lo + hi) / 2;
    shift = Math.round((rangeMid - phraseMid) / 12) * 12;
  }

  return shift;
}

/** Apply uniform track shift, then a safety fold for any remaining outliers. */
function mapMidiForPlayback(midi, program, trackShift = 0) {
  return foldMidiToPresetRange((midi | 0) + trackShift, program);
}

// Tracks use channels 0–14; piano uses 15 so they never fight.
function soundFontChannelForTrack(index) { return index % 15; }

function prepareSoundFontChannel(channel, track) {
  if (!soundFontEngine.synth || soundFontEngine.soundFontId < 0) return;
  const program = resolveSoundFontProgram(track);
  try {
    // midiProgramSelect binds this channel to the requested preset in our
    // bundled SoundFont. Do not follow it with midiProgramChange: that can
    // override the SoundFont-specific selection with the default bank preset.
    // IMPORTANT: only call this when the instrument actually changes — calling
    // it on every note-on can cut other sounding notes on the same channel.
    soundFontEngine.synth.midiProgramSelect(channel, soundFontEngine.soundFontId, 0, program);
    soundFontEngine.synth.midiCC(channel, 7, 127);
    soundFontEngine.synth.midiCC(channel, 11, 127);
    channelProgram.set(channel, program);
  } catch (e) {
    console.warn("SoundFont program selection failed", { channel, program, error: e });
  }
}

/**
 * Start a note. `midi` should already include any whole-track octave shift
 * when playing a track (see scheduleTrackFrom). Returns the actual MIDI sent
 * to the synth, or null on failure.
 */
function soundFontNoteOn(channel, midi, velocity = 112, programHint = null, trackShift = 0) {
  if (!soundFontEngine.synth || soundFontEngine.status !== "ready") return null;
  try {
    const program = programHint ?? channelProgram.get(channel) ?? 1;
    const playMidi = mapMidiForPlayback(midi, program, trackShift);
    const vel = Math.max(1, Math.min(127, velocity | 0));
    const key = noteCountKey(channel, playMidi);
    const count = (channelNoteCounts.get(key) || 0) + 1;
    channelNoteCounts.set(key, count);
    // Re-trigger if already sounding so repeated notes are audible
    if (count > 1) {
      try { soundFontEngine.synth.midiNoteOff(channel, playMidi); } catch (_) {}
    }
    soundFontEngine.synth.midiNoteOn(channel, playMidi, vel);
    soundFontEngine.channelsInUse.add(channel);
    return playMidi;
  } catch (_) {
    return null;
  }
}

function soundFontNoteOff(channel, midi, programHint = null, trackShift = 0) {
  if (!soundFontEngine.synth || soundFontEngine.status !== "ready") return;
  try {
    const program = programHint ?? channelProgram.get(channel) ?? 1;
    const playMidi = mapMidiForPlayback(midi, program, trackShift);
    const key = noteCountKey(channel, playMidi);
    const count = (channelNoteCounts.get(key) || 0) - 1;
    if (count <= 0) {
      channelNoteCounts.delete(key);
      soundFontEngine.synth.midiNoteOff(channel, playMidi);
    } else {
      channelNoteCounts.set(key, count);
    }
  } catch (_) {}
}

function soundFontAllNotesOff(channel) {
  if (!soundFontEngine.synth || soundFontEngine.status !== "ready") return;
  // Clear stacked counts for this channel
  for (const key of [...channelNoteCounts.keys()]) {
    if (key.startsWith(`${channel}:`)) channelNoteCounts.delete(key);
  }
  try { soundFontEngine.synth.midiCC(channel, 123, 0); } catch (_) {
    try { soundFontEngine.synth.midiAllSoundsOff(channel); } catch (_) {}
  }
}

function createTrackPlayer(index) {
  const track = conversionResults[index];
  if (!track) return null;

  const durationBeats = track.playbackNotes.reduce(
    (max, note) => Math.max(max, note.startBeat + note.durationBeats), 0
  );

  const state = {
    index,
    track,
    status: "stopped",
    startedAt: 0,
    pausedAt: 0, // seconds
    timerIds: [],
    voices: new Set(),
    durationBeats,
    // keep `duration` as beats for any older call sites; prefer durationBeats
    duration: durationBeats
  };

  return state;
}

function clearPlayerTimers(state) {
  state.timerIds.forEach(id => clearTimeout(id));
  state.timerIds = [];
}

function stopTrackPlayer(index, reset = true) {
  const state = trackPlayers.get(index);
  if (!state) return;
  clearPlayerTimers(state);
  const shift = state.trackShift || 0;
  state.voices.forEach(voice => {
    if (voice?.soundFont) soundFontNoteOff(voice.channel, voice.midi, null, shift);
  });
  soundFontAllNotesOff(soundFontChannelForTrack(index));
  state.voices.clear();
  state.status = "stopped";
  state.pausedAt = reset ? 0 : state.pausedAt;
  clearPlaybackHighlights();
  updateTrackPlayerUI(index);
}

async function scheduleTrackFrom(index, offsetSeconds, sharedStartWall = null) {
  const state = trackPlayers.get(index);
  if (!state) return;
  clearPlayerTimers(state);
  const ready = await ensureSoundFontReady();
  if (!ready) {
    state.status = "stopped";
    updateTrackPlayerUI(index);
    if (pianoElements?.status) {
      pianoElements.status.textContent = soundFontEngine.lastError
        ? `SoundFont failed: ${soundFontEngine.lastError}`
        : "SoundFont failed to load. Check the browser console and assets/gw2Instruments.sf2.";
    }
    return;
  }

  const tempoBpm = Number(elements.tempo?.value) || 120;
  const secondsPerBeat = 60 / tempoBpm;
  const channel = soundFontChannelForTrack(index);
  // Program select once per schedule — not on every note (that was cutting notes).
  prepareSoundFontChannel(channel, state.track);

  // One uniform octave shift for the whole track so intervals stay natural.
  const program = resolveSoundFontProgram(state.track);
  const midis = (state.track.playbackNotes || []).map(n => n.midi);
  const trackShift = computeTrackOctaveShift(midis, program);
  state.trackShift = trackShift;

  const startWall = sharedStartWall ?? (performance.now() / 1000 - offsetSeconds);
  state.startedAt = startWall - offsetSeconds;
  state.status = "playing";

  state.track.playbackNotes.forEach(note => {
    const noteStart = note.startBeat * secondsPerBeat;
    const noteEnd = noteStart + note.durationBeats * secondsPerBeat;
    if (noteEnd <= offsetSeconds) return;

    const delay = Math.max(0, (noteStart - offsetSeconds) * 1000);
    const timer = setTimeout(() => {
      if (state.status !== "playing") return;
      if (soundFontEngine.status !== "ready") return;

      // Correct for timer drift: compute remaining from wall clock
      const elapsed = Math.max(0, performance.now() / 1000 - state.startedAt);
      if (elapsed >= noteEnd) return; // note already finished — skip
      const remaining = Math.max(0.03, noteEnd - elapsed);

      const playMidi = soundFontNoteOn(channel, note.midi, 115, program, trackShift);
      if (playMidi == null) return;
      const voice = { soundFont: true, channel, midi: note.midi, playMidi, trackShift };
      state.voices.add(voice);
      const offTimer = setTimeout(() => {
        soundFontNoteOff(channel, note.midi, program, trackShift);
        state.voices.delete(voice);
      }, remaining * 1000);
      state.timerIds.push(offTimer);
    }, delay);
    state.timerIds.push(timer);
  });

  const durationSeconds = (state.durationBeats ?? state.duration ?? 0) * secondsPerBeat;
  const remainingSong = Math.max(0, durationSeconds - offsetSeconds);
  state.timerIds.push(setTimeout(() => {
    if (state.status === "playing") stopTrackPlayer(index, true);
  }, remainingSong * 1000 + 100));

  updateTrackPlayerUI(index);
  startPlaybackHighlightLoop();
}

function playTrackPlayer(index) {
  const state = trackPlayers.get(index) || createTrackPlayer(index);
  if (!state) return;
  trackPlayers.set(index, state);
  const ctx = getPlaybackAudioContext();
  if (ctx.state === "suspended") ctx.resume();
  if (state.status === "playing") return;
  scheduleTrackFrom(index, state.status === "paused" ? state.pausedAt : 0);
}

function pauseTrackPlayer(index) {
  const state = trackPlayers.get(index);
  if (!state || state.status !== "playing") return;
  const tempoBpm = Number(elements.tempo?.value) || 120;
  const secondsPerBeat = 60 / tempoBpm;
  const durationSeconds = (state.durationBeats ?? state.duration ?? 0) * secondsPerBeat;
  const elapsed = Math.max(0, performance.now() / 1000 - state.startedAt);
  state.pausedAt = Math.min(durationSeconds, elapsed);
  clearPlayerTimers(state);
  const shift = state.trackShift || 0;
  state.voices.forEach(voice => {
    if (voice?.soundFont) soundFontNoteOff(voice.channel, voice.midi, null, shift);
  });
  soundFontAllNotesOff(soundFontChannelForTrack(index));
  state.voices.clear();
  state.status = "paused";
  updateTrackPlayerUI(index);
}

function updateTrackPlayerUI(index) {
  const root = elements.channels.querySelector(`[data-player-index="${index}"]`);
  if (!root) return;
  const state = trackPlayers.get(index);
  root.classList.toggle("is-playing", state?.status === "playing");
  root.querySelector(".track-play").textContent = state?.status === "paused" ? "▶ Resume" : "▶ Play";
}

function getAllTrackDuration() {
  return conversionResults.reduce(
    (max, track) =>
      Math.max(
        max,
        track.playbackNotes.reduce(
          (trackMax, note) => Math.max(trackMax, note.startBeat + note.durationBeats),
          0
        )
      ),
    0
  );
}

function setGlobalPlaybackEnabled(enabled) {
  if (!elements.playAllButton) return;
  elements.playAllButton.disabled = !enabled;
  elements.pauseAllButton.disabled = !enabled;
  elements.stopAllButton.disabled = !enabled;
}

function setGlobalPlaybackUI(status) {
  if (!elements.globalPlaybackStatus) return;

  const labels = {
    stopped: "Ready",
    playing: "Playing all tracks",
    paused: "Paused"
  };
  elements.globalPlaybackStatus.textContent = labels[status] || "Ready";

  elements.playAllButton?.classList.toggle("is-active", status === "playing");
  elements.pauseAllButton?.classList.toggle("is-active", status === "paused");
}

function stopAllTrackPlayers(reset = true) {
  trackPlayers.forEach((state, index) => stopTrackPlayer(index, reset));
  if (reset) {
    globalPlaybackState.status = "stopped";
    globalPlaybackState.pausedAt = 0;
  }
  setGlobalPlaybackUI(globalPlaybackState.status);
}

const globalPlaybackState = {
  status: "stopped",
  startedAt: 0,
  pausedAt: 0,
  duration: 0,
  timerId: null
};

function clearGlobalPlaybackTimer() {
  if (globalPlaybackState.timerId !== null) {
    clearTimeout(globalPlaybackState.timerId);
    globalPlaybackState.timerId = null;
  }
}

function playAllTrackPlayers() {
  if (!conversionResults.length) return;

  const ctx = getPlaybackAudioContext();
  if (ctx.state === "suspended") ctx.resume();

  const offsetSeconds = globalPlaybackState.status === "paused"
    ? globalPlaybackState.pausedAt
    : 0;

  trackPlayers.forEach((state, index) => {
    stopTrackPlayer(index, false);
    state.pausedAt = offsetSeconds;
  });

  clearGlobalPlaybackTimer();

  const tempoBpm = Number(elements.tempo?.value) || 120;
  const secondsPerBeat = 60 / tempoBpm;
  const sharedStartWall = performance.now() / 1000 - offsetSeconds;
  globalPlaybackState.startedAt = sharedStartWall;
  // getAllTrackDuration() returns beats — convert to seconds for timers
  globalPlaybackState.duration = getAllTrackDuration() * secondsPerBeat;
  globalPlaybackState.pausedAt = offsetSeconds;
  globalPlaybackState.status = "playing";

  conversionResults.forEach((_, index) => {
    if (!trackPlayers.has(index)) {
      const state = createTrackPlayer(index);
      if (state) trackPlayers.set(index, state);
    }
    scheduleTrackFrom(index, offsetSeconds, sharedStartWall);
  });

  const remaining = Math.max(0, globalPlaybackState.duration - offsetSeconds);
  globalPlaybackState.timerId = setTimeout(() => {
    if (globalPlaybackState.status === "playing") {
      globalPlaybackState.status = "stopped";
      globalPlaybackState.pausedAt = 0;
      stopAllTrackPlayers(true);
    }
  }, remaining * 1000 + 150);

  setGlobalPlaybackUI("playing");
  startPlaybackHighlightLoop();
}

function pauseAllTrackPlayers() {
  if (globalPlaybackState.status !== "playing") return;

  const elapsed = Math.max(0, performance.now() / 1000 - globalPlaybackState.startedAt);
  globalPlaybackState.pausedAt = Math.min(globalPlaybackState.duration, elapsed);
  globalPlaybackState.status = "paused";
  clearGlobalPlaybackTimer();

  trackPlayers.forEach((state, index) => {
    if (state.status === "playing") pauseTrackPlayer(index);
  });

  setGlobalPlaybackUI("paused");
}

elements.playAllButton?.addEventListener("click", playAllTrackPlayers);
elements.pauseAllButton?.addEventListener("click", pauseAllTrackPlayers);
elements.stopAllButton?.addEventListener("click", () => {
  clearGlobalPlaybackTimer();
  stopAllTrackPlayers(true);
});

function setupTrackPlayers() {
  clearGlobalPlaybackTimer();
  trackPlayers.forEach((state, index) => stopTrackPlayer(index));
  trackPlayers.clear();
  globalPlaybackState.status = "stopped";
  globalPlaybackState.startedAt = 0;
  globalPlaybackState.pausedAt = 0;
  globalPlaybackState.duration = 0;

  elements.channels.querySelectorAll("[data-player-index]").forEach(player => {
    const index = Number(player.dataset.playerIndex);
    player.querySelector(".track-play").addEventListener("click", () => playTrackPlayer(index));
    player.querySelector(".track-pause").addEventListener("click", () => pauseTrackPlayer(index));
    player.querySelector(".track-stop").addEventListener("click", () => stopTrackPlayer(index, true));
  });
}


/* ============================================================
   9. EXPORT
   ============================================================ */

/** Strip null bytes (from some MIDI track names) that make Windows treat the file as UTF-16. */
function sanitizeExportText(text) {
  return String(text ?? "").replace(/\u0000/g, "");
}

function getAllPlainText() {
  return conversionResults
    .map(track =>
      `${sanitizeExportText(track.name)}\n` +
      sanitizeExportText(track.plain)
    )
    .join("\n\n");
}

/**
 * Build a real UTF-8 .txt Blob.
 * - TextEncoder guarantees UTF-8 bytes (not UTF-16)
 * - Leading BOM (U+FEFF) so Windows Notepad auto-detects UTF-8 correctly
 */
function createUtf8TextBlob(text) {
  const clean = sanitizeExportText(text);
  const utf8 = new TextEncoder().encode("\uFEFF" + clean);
  return new Blob([utf8], { type: "text/plain;charset=utf-8" });
}


elements.copyButton.addEventListener(
  "click",
  async () => {

    try {

      await navigator.clipboard.writeText(
        getAllPlainText()
      );

      elements.copyButton.textContent =
        "✓ Copied";

      setTimeout(() => {
        elements.copyButton.textContent =
          "▣ Copy all";
      }, 1400);

    }
    catch {
      showError(
        "Clipboard access was blocked by the browser."
      );
    }

  }
);


elements.downloadButton.addEventListener(
  "click",
  () => {

    const blob = createUtf8TextBlob(getAllPlainText());
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download =
      ((midiFile && midiFile.name)
        ? midiFile.name.replace(/\.(midi?|msc[zx])$/i, "")
        : "gw2-notation") + ".txt";

    link.click();
    URL.revokeObjectURL(url);

  }
);


/* ============================================================
   10. UI HELPERS
   ============================================================ */

function showEmptyState() {

  clearGlobalPlaybackTimer();
  trackPlayers.forEach((state, index) => stopTrackPlayer(index));
  trackPlayers.clear();
  globalPlaybackState.status = "stopped";
  globalPlaybackState.startedAt = 0;
  globalPlaybackState.pausedAt = 0;
  globalPlaybackState.duration = 0;
  setGlobalPlaybackEnabled(false);
  setGlobalPlaybackUI("stopped");

  elements.channels.innerHTML = `
    <div class="empty-state">
      <div>
        <div class="empty-note">♫</div>

        <strong>Your score will appear here</strong>

        Upload a MIDI file to see each track
        or channel converted into GW2 notation.
      </div>
    </div>
  `;

}


function enableExportButtons() {

  elements.copyButton.disabled = false;
  elements.downloadButton.disabled = false;

}


function disableExportButtons() {

  elements.copyButton.disabled = true;
  elements.downloadButton.disabled = true;

}


function showError(message) {

  elements.errorMessage.textContent =
    message;

}


function clearError() {

  elements.errorMessage.textContent =
    "";

}


function stripHtml(html) {

  return html
    .replace(/<br>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

}


function escapeHtml(text) {

  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

}

/* ============================================================
   11. PLAYABLE GW2 PIANO
   ============================================================ */

/*
 * The piano follows the requested GW2-style keyboard:
 *
 * White keys:
 *   1 = C
 *   2 = D
 *   3 = E
 *   4 = F
 *   5 = G
 *   6 = A
 *   7 = B
 *   8 = C (next octave)
 *
 * Black keys:
 *   F1 = C#
 *   F2 = D#
 *   F4 = F#
 *   F5 = G#
 *   F6 = A#
 *
 * Octaves:
 *   LOW  = C3 → C4
 *   MID  = C4 → C5
 *   HIGH = C5 → C6
 *
 * 9 = octave down
 * 0 = octave up
 *
 * We use Web Audio, so no audio files are required.
 */

const piano = {
  currentOctave: "mid",
  selectedSoundFontProgram: 1,

  /*
   * MIDI note for the LOW octave's C.
   * C3 = MIDI 48.
   */
  baseMidi: 48,

  /**
   * Uniform octave shift applied to the current keyboard window so the whole
   * visible octave fits the selected SoundFont preset (same logic as tracks).
   */
  playbackShift: 0,

  activeNotes: new Map(),

  /*
   * Each white key is one semitone location in the
   * diatonic C-major layout.
   */
  whiteKeys: [
    {
      degree: "1",
      noteName: "C",
      semitone: 0,
      shortcut: "1"
    },
    {
      degree: "2",
      noteName: "D",
      semitone: 2,
      shortcut: "2"
    },
    {
      degree: "3",
      noteName: "E",
      semitone: 4,
      shortcut: "3"
    },
    {
      degree: "4",
      noteName: "F",
      semitone: 5,
      shortcut: "4"
    },
    {
      degree: "5",
      noteName: "G",
      semitone: 7,
      shortcut: "5"
    },
    {
      degree: "6",
      noteName: "A",
      semitone: 9,
      shortcut: "6"
    },
    {
      degree: "7",
      noteName: "B",
      semitone: 11,
      shortcut: "7"
    },
    {
      degree: "8",
      noteName: "C",
      semitone: 12,
      shortcut: "8"
    }
  ],

  blackKeys: [
    {
      noteName: "C#",
      semitone: 1,
      shortcut: "F1",

      /*
       * Position between C and D.
       * There are 8 white keys, so the centers are
       * approximately 12.5%, 25%, etc.
       */
      leftPercent: 12.5
    },
    {
      noteName: "D#",
      semitone: 3,
      shortcut: "F2",
      leftPercent: 25
    },
    {
      noteName: "F#",
      semitone: 6,
      shortcut: "F4",
      leftPercent: 50
    },
    {
      noteName: "G#",
      semitone: 8,
      shortcut: "F5",
      leftPercent: 62.5
    },
    {
      noteName: "A#",
      semitone: 10,
      shortcut: "F6",
      leftPercent: 75
    }
  ],

  octaveNames: {
    low: "LOW",
    mid: "MID",
    high: "HIGH"
  },

  octaveIndex: {
    low: 0,
    mid: 1,
    high: 2
  }
};


/*
 * DOM references for the piano.
 */
const pianoElements = {
  keyboard:
    document.getElementById("pianoKeyboard"),

  display:
    document.getElementById("pianoOctaveDisplay"),

  status:
    document.getElementById("pianoStatus"),


  octaveDown:
    document.getElementById("octaveDown"),

  octaveUp:
    document.getElementById("octaveUp")
};


/*
 * Create the visual piano.
 */
function renderPiano() {

  pianoElements.keyboard.innerHTML = "";

  /*
   * White keys.
   */
  piano.whiteKeys.forEach(key => {

    const button =
      document.createElement("button");

    button.type = "button";

    button.className =
      "piano-white-key";

    button.dataset.semitone =
      key.semitone;

    button.dataset.note =
      key.noteName;

    button.innerHTML = `
      <span class="piano-note-name">
        ${key.noteName}
      </span>

      <span class="piano-shortcut">
        ${key.shortcut}
      </span>
    `;

    /*
     * Click = short note.
     */
    button.addEventListener(
      "pointerdown",
      event => {

        event.preventDefault();

        startPianoNote(
          key.semitone,
          button
        );

      }
    );

    button.addEventListener(
      "pointerup",
      () => {
        stopPianoNote(key.semitone);
      }
    );

    button.addEventListener(
      "pointerleave",
      () => {
        stopPianoNote(key.semitone);
      }
    );

    pianoElements.keyboard.appendChild(
      button
    );

  });


  /*
   * Black keys.
   *
   * They are appended after white keys so they sit on top.
   */
  piano.blackKeys.forEach(key => {

    const button =
      document.createElement("button");

    button.type = "button";

    button.className =
      "piano-black-key";

    button.dataset.semitone =
      key.semitone;

    button.dataset.note =
      key.noteName;

    button.style.left =
      `${key.leftPercent}%`;

    /*
     * Transform from the left edge to center the black key
     * on the gap between white keys.
     */
    button.style.transform =
      "translateX(-50%)";

    button.innerHTML = `
      <span class="piano-black-name">
        ${key.noteName}
      </span>

      <span class="piano-black-shortcut">
        ${key.shortcut}
      </span>
    `;

    button.addEventListener(
      "pointerdown",
      event => {

        event.preventDefault();

        startPianoNote(
          key.semitone,
          button
        );

      }
    );

    button.addEventListener(
      "pointerup",
      () => {
        stopPianoNote(key.semitone);
      }
    );

    button.addEventListener(
      "pointerleave",
      () => {
        stopPianoNote(key.semitone);
      }
    );

    pianoElements.keyboard.appendChild(
      button
    );

  });


  updatePianoOctaveUI();

}


/**
 * Standard GW2 UI octave base: Low=C3, Mid=C4, High=C5 (MIDI 48 / 60 / 72).
 */
function getCurrentOctaveBase() {
  return piano.baseMidi + piano.octaveIndex[piano.currentOctave] * 12;
}

/**
 * Instruments whose samples sit below the normal GW2 piano (C3+) and should
 * map Low/Mid across their own range. High is always disabled for these.
 *   Bass (33): 36–60   Verdarach (58): 24–60
 */
const BASS_LIKE_PROGRAMS = new Set([33, 58]);

/**
 * Sounding MIDI base for the piano under the current preset.
 *
 * Bass-like: Low = lowest instrument octave, Mid = next, High = disabled.
 * Everything else: fixed GW2 layout C3–C4 / C4–C5 / C5–C6.
 */
function getPianoSoundingBase() {
  const program = piano.selectedSoundFontProgram;
  const octaveIndex = piano.octaveIndex[piano.currentOctave]; // 0, 1, 2

  if (BASS_LIKE_PROGRAMS.has(program)) {
    const [lo, hi] = SOUND_FONT_KEY_RANGES[program] || [36, 60];
    // Only Low (0) and Mid (1) are used; High is disabled in isPianoOctaveAvailable
    const step = Math.min(octaveIndex, 1);
    let base = lo + step * 12;
    if (base + 12 > hi) base = Math.max(lo, hi - 12);
    if (base < lo) base = lo;
    return base;
  }

  return getCurrentOctaveBase();
}

/** Convert key semitone (0–12) to the MIDI note that is actually played. */
function getPianoMidi(semitone) {
  return getPianoSoundingBase() + semitone;
}

function updatePianoPlaybackShift() {
  piano.playbackShift = getPianoSoundingBase() - getCurrentOctaveBase();
  return piano.playbackShift;
}

/**
 * Whether a UI octave is usable for the current SoundFont preset.
 *
 * Rules (from real SF2 zone ranges):
 * - Bass / Verdarach: Low + Mid only (custom mapping); High disabled
 * - Horn (56): Low allowed (samples from E3 / 52 cover most of Low)
 * - Low:  otherwise must reach C3 or below (lo ≤ 48)
 * - High: instrument must reach near C6 (hi ≥ 83)
 * - Mid:  instrument must cover some of C4–C5 (lo ≤ 72 && hi ≥ 60)
 */
function isPianoOctaveAvailable(octaveName) {
  const program = piano.selectedSoundFontProgram;

  if (BASS_LIKE_PROGRAMS.has(program)) {
    return octaveName === "low" || octaveName === "mid";
  }

  const [lo, hi] = SOUND_FONT_KEY_RANGES[program] || DEFAULT_KEY_RANGE;

  if (octaveName === "low") {
    // Horn (52–88): Low is usable. Bells/Choir Bell/Flute start higher → no Low.
    if (program === 56) return true;
    return lo <= 48;
  }
  if (octaveName === "high") {
    // Must reach near C6 (Pipe Organ tops at 83; full C6 instruments at 84+)
    return hi >= 83;
  }
  // mid
  return lo <= 72 && hi >= 60;
}

/** Nearest available octave name, preferring mid → high → low. */
function getNearestAvailablePianoOctave(preferred) {
  const order = preferred === "high"
    ? ["high", "mid", "low"]
    : preferred === "low"
      ? ["low", "mid", "high"]
      : ["mid", "high", "low"];
  for (const name of order) {
    if (isPianoOctaveAvailable(name)) return name;
  }
  return "mid";
}


/*
 * Convert MIDI note to a frequency.
 */
function midiToFrequency(midiNote) {

  return (
    440 *
    Math.pow(
      2,
      (midiNote - 69) / 12
    )
  );

}


function startPianoNote(semitone, buttonElement) {
  // Key by semitone (key position), not absolute MIDI, so octave changes
  // don't break release tracking for held notes.
  if (piano.activeNotes.has(semitone)) return;

  // Sounding pitch for the current instrument + UI octave (Low/Mid/High)
  const midiNote = getPianoMidi(semitone);
  if (buttonElement) buttonElement.classList.add("active");
  const noteName = getPianoNoteLabel(semitone);
  pianoElements.status.textContent = `Loading SoundFont · ${noteName}`;

  const pendingVoice = {
    soundFont: false,
    pending: true,
    midi: midiNote,
    trackShift: 0,
    semitone,
    button: buttonElement
  };
  piano.activeNotes.set(semitone, pendingVoice);
  ensureSoundFontReady().then(ready => {
    if (!ready) {
      if (piano.activeNotes.get(semitone) === pendingVoice) piano.activeNotes.delete(semitone);
      if (buttonElement) buttonElement.classList.remove("active");
      pianoElements.status.textContent = soundFontEngine.lastError
        ? `SoundFont failed: ${soundFontEngine.lastError}`
        : "SoundFont failed to load. Check assets/gw2Instruments.sf2 and the browser console.";
      return;
    }
    if (piano.activeNotes.get(semitone) !== pendingVoice) return;
    const channel = 15;
    const program = piano.selectedSoundFontProgram;
    prepareSoundFontChannel(channel, {
      playbackInstrument: "piano",
      selectedSoundFontProgram: program
    });
    // midiNote is already mapped into the instrument range — no extra shift
    const playMidi = soundFontNoteOn(channel, midiNote, 120, program, 0);
    if (playMidi == null) {
      piano.activeNotes.delete(semitone);
      if (buttonElement) buttonElement.classList.remove("active");
      pianoElements.status.textContent = "SoundFont could not play this note.";
      return;
    }
    piano.activeNotes.set(semitone, {
      soundFont: true,
      channel,
      midi: midiNote,
      playMidi,
      trackShift: 0,
      semitone,
      button: buttonElement
    });
    pianoElements.status.textContent = `Playing ${noteName} · MIDI ${playMidi}`;
  });
}

/*
 * Stop one piano note. Uses the MIDI stored when the note started so
 * release still works after an octave or instrument change.
 */
function stopPianoNote(semitone) {
  const voice = piano.activeNotes.get(semitone);
  if (!voice) return;

  if (voice.soundFont) {
    soundFontNoteOff(
      voice.channel,
      voice.midi,
      piano.selectedSoundFontProgram,
      voice.trackShift || 0
    );
  }
  if (voice.button) voice.button.classList.remove("active");
  piano.activeNotes.delete(semitone);
}


/*
 * Stop everything currently sounding.
 */
function stopAllPianoNotes() {
  for (const voice of piano.activeNotes.values()) {
    if (voice.soundFont) {
      soundFontNoteOff(
        voice.channel,
        voice.midi,
        piano.selectedSoundFontProgram,
        voice.trackShift || 0
      );
    }
    if (voice.button) voice.button.classList.remove("active");
  }
  soundFontAllNotesOff(15);
  piano.activeNotes.clear();
}


/*
 * Display-friendly note label.
 */
function getPianoNoteLabel(
  semitone
) {

  const labels = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
    "C"
  ];

  return labels[semitone];

}


/*
 * Change octave by -1 / +1.
 */
function changePianoOctave(direction) {
  const names = ["low", "mid", "high"];
  const current = piano.octaveIndex[piano.currentOctave];
  // Step through octaves, skipping any the current instrument cannot play
  let next = current;
  for (let step = 0; step < 3; step++) {
    next = Math.max(0, Math.min(2, next + direction));
    if (isPianoOctaveAvailable(names[next])) break;
    if (next === 0 || next === 2) break; // hit the edge
  }

  const nextName = names[next];
  if (!isPianoOctaveAvailable(nextName) || nextName === piano.currentOctave) return;

  piano.currentOctave = nextName;
  // Keep currently held notes sounding at their original pitch until release.
  updatePianoOctaveUI();
}


/*
 * Update octave label, button states and help text.
 */
function updatePianoOctaveUI() {
  // If current octave isn't playable for this instrument, jump to nearest that is
  if (!isPianoOctaveAvailable(piano.currentOctave)) {
    piano.currentOctave = getNearestAvailablePianoOctave(piano.currentOctave);
  }

  const name = piano.octaveNames[piano.currentOctave];
  updatePianoPlaybackShift();

  const soundingBase = getPianoSoundingBase();
  const sLowOct = Math.floor(soundingBase / 12) - 1;
  const sHighOct = Math.floor((soundingBase + 12) / 12) - 1;

  const preset =
    SOUND_FONT_PRESETS.find(p => p.program === piano.selectedSoundFontProgram)?.name ||
    "Sound";

  pianoElements.display.textContent = String(name || "mid").toUpperCase();
  pianoElements.status.textContent = `${preset} · C${sLowOct}–C${sHighOct}`;

  // Disable Low/High when this instrument has no samples in that window
  // (and disable stepping further in that direction)
  const canGoLower =
    piano.currentOctave !== "low" &&
    (piano.currentOctave === "high"
      ? isPianoOctaveAvailable("mid") || isPianoOctaveAvailable("low")
      : isPianoOctaveAvailable("low"));
  const canGoHigher =
    piano.currentOctave !== "high" &&
    (piano.currentOctave === "low"
      ? isPianoOctaveAvailable("mid") || isPianoOctaveAvailable("high")
      : isPianoOctaveAvailable("high"));

  pianoElements.octaveDown.disabled = !canGoLower;
  pianoElements.octaveUp.disabled = !canGoHigher;
}


/*
 * Physical octave buttons.
 */
pianoElements.octaveDown.addEventListener(
  "click",
  () => changePianoOctave(-1)
);

pianoElements.octaveUp.addEventListener(
  "click",
  () => changePianoOctave(1)
);


/*
 * Physical keyboard shortcuts.
 *
 * event.code is used instead of event.key because:
 * - Digit1–Digit8 map cleanly to the number row.
 * - Numpad1–Numpad8 map cleanly to the numeric keypad.
 * - F1–F6 work even though browsers normally assign
 *   their own actions to those keys.
 * - Numpad9/Numpad0 provide octave switching too.
 */
const PIANO_KEYBOARD_MAP = {

  /* Main number row */
  Digit1: 0,
  Digit2: 2,
  Digit3: 4,
  Digit4: 5,
  Digit5: 7,
  Digit6: 9,
  Digit7: 11,
  Digit8: 12,

  /* Numeric keypad */
  Numpad1: 0,
  Numpad2: 2,
  Numpad3: 4,
  Numpad4: 5,
  Numpad5: 7,
  Numpad6: 9,
  Numpad7: 11,
  Numpad8: 12,

  /* Function keys for sharps */
  F1: 1,
  F2: 3,
  F4: 6,
  F5: 8,
  F6: 10

};


const heldKeyboardKeys =
  new Map();


document.addEventListener(
  "keydown",
  event => {

    /*
     * Don't hijack keys while the user is typing
     * into an input/select.
     */
    const target =
      event.target;

    const isTyping =
      target instanceof
        HTMLInputElement ||
      target instanceof
        HTMLTextAreaElement ||
      target instanceof
        HTMLSelectElement;


    if (isTyping) {
      return;
    }


    /*
     * 9 = lower octave.
     */
    if (
      (
        event.code === "Digit9" ||
        event.code === "Numpad9"
      ) &&
      !event.repeat
    ) {

      event.preventDefault();

      changePianoOctave(-1);

      return;
    }


    /*
     * 0 = higher octave.
     */
    if (
      (
        event.code === "Digit0" ||
        event.code === "Numpad0"
      ) &&
      !event.repeat
    ) {

      event.preventDefault();

      changePianoOctave(1);

      return;
    }


    /*
     * Space = stop all currently playing notes.
     */
    if (
      event.code === "Space" &&
      !event.repeat
    ) {

      event.preventDefault();

      stopAllPianoNotes();

      pianoElements.status.textContent =
        "Ready · all notes stopped";

      return;
    }


    const semitone =
      PIANO_KEYBOARD_MAP[
        event.code
      ];


    if (
      semitone === undefined
    ) {
      return;
    }


    event.preventDefault();


    /*
     * Ignore auto-repeat.
     */
    if (
      event.repeat ||
      heldKeyboardKeys.has(
        event.code
      )
    ) {
      return;
    }


    /*
     * Find the corresponding visual key.
     */
    const button =
      pianoElements.keyboard.querySelector(
        `[data-semitone="${semitone}"]`
      );


    heldKeyboardKeys.set(
      event.code,
      semitone
    );


    startPianoNote(
      semitone,
      button
    );

  },
  true
);


document.addEventListener(
  "keyup",
  event => {

    if (
      !heldKeyboardKeys.has(
        event.code
      )
    ) {
      return;
    }


    event.preventDefault();


    const semitone =
      heldKeyboardKeys.get(
        event.code
      );


    heldKeyboardKeys.delete(
      event.code
    );


    stopPianoNote(
      semitone
    );

  },
  true
);


/*
 * If the browser window loses focus, release any held notes.
 * This prevents a "stuck" note after Alt+Tab.
 */
window.addEventListener(
  "blur",
  () => {

    heldKeyboardKeys.clear();

    stopAllPianoNotes();

  }
);


/*
 * Build the piano immediately and populate the SoundFont preset selector.
 */
renderPiano();
const pianoInstrumentSelect = document.getElementById("pianoInstrumentSelect");
if (pianoInstrumentSelect) {
  pianoInstrumentSelect.innerHTML = getSoundFontPresetOptions(piano.selectedSoundFontProgram);
  pianoInstrumentSelect.addEventListener("change", async () => {
    piano.selectedSoundFontProgram = Number(pianoInstrumentSelect.value);
    stopAllPianoNotes();
    // Always reset to Mid when switching instrument (or nearest if Mid is N/A)
    piano.currentOctave = isPianoOctaveAvailable("mid")
      ? "mid"
      : getNearestAvailablePianoOctave("mid");
    if (soundFontEngine.status !== "ready") await ensureSoundFontReady();
    if (soundFontEngine.status === "ready") {
      prepareSoundFontChannel(15, {
        playbackInstrument: "piano",
        selectedSoundFontProgram: piano.selectedSoundFontProgram
      });
      updatePianoOctaveUI();
    } else {
      pianoElements.status.textContent = soundFontEngine.lastError
        ? `SoundFont failed: ${soundFontEngine.lastError}`
        : "SoundFont failed to load. Check assets/gw2Instruments.sf2 and the browser console.";
    }
  });
}

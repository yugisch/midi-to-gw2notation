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
/**
 * Octave writing shift for notation markers.
 *  0 = default mid reference
 * +1 = raise writing  ([3] → 3 → (3))
 * -1 = lower writing  ((3) → 3 → [3])
 * Clamped to -2 … +2.
 */
let octaveShift = 0;
/** @deprecated mapped from octaveShift for older call sites */
let selectedOctave = "mid";

/** Last successful convert context so octave changes can re-render without re-reading the file. */
let lastConvertContext = null;

/** BPM from the last loaded score (first tempo event). Used when the tempo field is empty. */
let midiSourceTempoBpm = 120;

/**
 * Effective playback tempo: field value if set, otherwise the MIDI/score tempo.
 */
function getPlaybackTempoBpm() {
  const raw = elements.tempo?.value;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 20 && n <= 300) return n;
  }
  return midiSourceTempoBpm || 120;
}

function extractMidiTempoBpm(midi) {
  const tempos = midi?.header?.tempos;
  if (Array.isArray(tempos) && tempos.length) {
    const first = tempos[0];
    const bpm = Number(first.bpm ?? first.BPM);
    if (Number.isFinite(bpm) && bpm > 0) return Math.round(bpm * 10) / 10;
  }
  // Some files only expose microseconds per quarter via tempo events
  if (typeof midi?.header?.tempos?.[0]?.ticks === "number" && tempos?.[0]?.bpm) {
    return Number(tempos[0].bpm);
  }
  return 120;
}
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
  beatGrid: document.getElementById("beatGrid"),
  preserveFastNotes: document.getElementById("preserveFastNotes"),
  transposeMode: document.getElementById("transposeMode"),

  convertButton: document.getElementById("convertButton"),

  errorMessage: document.getElementById("errorMessage"),
  status: document.getElementById("status"),

  channels: document.getElementById("channels"),
  playAllButton: document.getElementById("playAllButton"),
  stopAllButton: document.getElementById("stopAllButton"),
  downloadAllMidiButton: document.getElementById("downloadAllMidiButton"),
  exportAllFormat: document.getElementById("exportAllFormat"),
  globalPlaybackStatus: document.getElementById("globalPlaybackStatus"),
  globalSeek: document.getElementById("globalSeek"),
  globalSeekTime: document.getElementById("globalSeekTime"),
  globalSeekDuration: document.getElementById("globalSeekDuration"),

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
  lastConvertContext = null;
  conversionResults = [];
  midiSourceTempoBpm = 120;
  if (elements.tempo) elements.tempo.placeholder = "Use MIDI tempo";

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


function syncOctaveShiftFromValue() {
  // Keep selectedOctave in sync for any leftover references
  selectedOctave =
    octaveShift >= 1 ? "low" : octaveShift <= -1 ? "high" : "mid";
  const label = document.getElementById("octaveShiftValue");
  if (label) {
    label.textContent =
      octaveShift > 0 ? `+${octaveShift}` : String(octaveShift);
  }
  const hasOutput = Array.isArray(conversionResults) && conversionResults.length > 0;
  const down = document.getElementById("octaveShiftDown");
  const up = document.getElementById("octaveShiftUp");
  if (down) down.disabled = !hasOutput || octaveShift <= -2;
  if (up) up.disabled = !hasOutput || octaveShift >= 2;
  document
    .querySelector(".octave-shift-control")
    ?.classList.toggle("is-disabled", !hasOutput);
}

/**
 * Re-run notation mapping with the current octaveShift using the last
 * converted tracks (no file re-read, no Convert click).
 */
function reapplyOctaveMapping() {
  if (!lastConvertContext || !conversionResults.length) return;

  const prev = conversionResults.map(t => ({
    included: t.included,
    selectedSoundFontProgram: t.selectedSoundFontProgram,
    collapsed: t.collapsed
  }));

  const {
    tracks,
    timeSignatures,
    transpose,
    beatGrid,
    preserveFastNotes
  } = lastConvertContext;

  conversionResults = tracks
    .map((track, index) =>
      convertTrack(
        track,
        index,
        beatGrid,
        transpose,
        preserveFastNotes,
        timeSignatures
      )
    )
    .filter(Boolean);

  conversionResults.forEach((track, index) => {
    if (prev[index]) {
      track.included = prev[index].included;
      track.collapsed = prev[index].collapsed;
      if (prev[index].selectedSoundFontProgram != null) {
        track.selectedSoundFontProgram = prev[index].selectedSoundFontProgram;
      }
    }
  });

  renderChannels();
}

document.getElementById("octaveShiftUp")?.addEventListener("click", () => {
  if (octaveShift >= 2) return;
  octaveShift += 1;
  syncOctaveShiftFromValue();
  reapplyOctaveMapping();
});

document.getElementById("octaveShiftDown")?.addEventListener("click", () => {
  if (octaveShift <= -2) return;
  octaveShift -= 1;
  syncOctaveShiftFromValue();
  reapplyOctaveMapping();
});

syncOctaveShiftFromValue();

// Live tempo field: update seek bar durations without re-convert
elements.tempo?.addEventListener("input", () => {
  if (!conversionResults.length) return;
  const duration = getAllTrackDuration(true) * getTempoSecondsPerBeat();
  globalPlaybackState.duration = duration;
  const pos =
    globalPlaybackState.status === "playing"
      ? Math.max(0, performance.now() / 1000 - globalPlaybackState.startedAt)
      : globalPlaybackState.pausedAt || 0;
  updateGlobalSeekUI(pos);
  conversionResults.forEach((_, index) => {
    const state = trackPlayers.get(index);
    const t =
      state?.status === "playing"
        ? Math.max(0, performance.now() / 1000 - state.startedAt)
        : state?.pausedAt || 0;
    updateTrackSeekUI(index, t);
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

    midiSourceTempoBpm = extractMidiTempoBpm(midi);
    // Refresh placeholder hint so users see the score tempo
    if (elements.tempo) {
      elements.tempo.placeholder = `MIDI · ${midiSourceTempoBpm} BPM`;
    }

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

    const beatGrid = elements.beatGrid.value;
    const preserveFastNotes = elements.preserveFastNotes.checked;

    // Keep parsed tracks so octave +/− can refresh notation without Convert
    lastConvertContext = {
      tracks,
      timeSignatures,
      transpose,
      beatGrid,
      preserveFastNotes
    };

    conversionResults =
      tracks
        .map((track, index) =>
          convertTrack(
            track,
            index,
            beatGrid,
            transpose,
            preserveFastNotes,
            timeSignatures
          )
        )
        .filter(Boolean);


    if (conversionResults.length === 0) {
      lastConvertContext = null;
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

  // Default mid reference is 1. Raising octaveShift lowers the reference so
  // the same pitch is written higher: [3] → 3 → (3).
  const referenceOctave = 1 - octaveShift;

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
  const tempoBpm = getPlaybackTempoBpm();
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

  /*
   * Duration marks (Powerina meanings, hybrid detection):
   * Use gap until *next attack* (not MIDI sustain), relative to the written
   * slot unit. Wider bands so slightly messy MIDI still gets marks; multi-beat
   * gaps stay as note + rests (no mark).
   *   .   ≈ ×1.25  (quarter dot)
   *   ·   ≈ ×1.5   (dotted)
   *   ·.  ≈ ×1.75  (double dotted)
   */
  const onsetTicks = [...new Set(events.map(e => e.startTick))].sort((a, b) => a - b);

  const interOnsetBeats = startTick => {
    const next = onsetTicks.find(t => t > startTick + 1);
    if (next != null) return (next - startTick) / ppq;
    // Last note in the track: use remaining song length (at least one grid unit)
    return Math.max(1 / ppq, (songEnd - startTick) / ppq);
  };

  /** Duration mark for a note whose written unit is `baseBeats`. */
  const powerinaDurationMark = (interOnset, baseBeats) => {
    const base = Math.max(1e-6, baseBeats);
    const ratio = interOnset / base;
    // ≥ ~2 written units → rest slots carry the length (no duration mark)
    if (ratio >= 1.95) return "";
    if (ratio >= 1.65) return "·.";
    if (ratio >= 1.40) return "·";
    if (ratio >= 1.20) return ".";
    return "";
  };

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
        startTick: event.startTick,
        durationBeats: event.durationTicks / ppq
      });
    }

    const tokens = cells.map((cell, slotIndex) => {
      const slotStartBeat = beatIndex + (slotIndex * effectiveGrid);
      const slotDuration = effectiveGrid;

      if (!cell.length) {
        // Powerina: ━ = one full beat rest, - = half-beat rest
        const pause = effectiveGrid >= 1 - 1e-9 ? "━" : "-";
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

      // Inter-onset interval from earliest attack in this cell (Powerina timing)
      const cellStartTick = Math.min(...cell.map(n => n.startTick));
      const ioiBeats = interOnsetBeats(cellStartTick);
      token += powerinaDurationMark(ioiBeats, slotDuration);

      const midiSustain = Math.max(...cell.map(note => note.durationBeats));
      return `<span class="playback-beat playback-note" data-start-beat="${slotStartBeat.toFixed(6)}" data-duration-beats="${Math.max(slotDuration, ioiBeats, midiSustain).toFixed(6)}">${token}</span>`;
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
    /** Included in Play All / WAV all / Copy+Download txt (checkbox, default on). */
    included: true,
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

        const collapsed = track.collapsed === true;
        return `
          <div class="channel${collapsed ? " is-collapsed" : ""}" data-track-index="${index}">

            <div
              class="channel-meta"
              style="--channel-color: ${track.color}"
            >
              <div class="channel-meta-row">
                <div class="channel-heading">
                  <label class="track-include" title="Include in Play All, WAV all, and text export">
                    <input
                      type="checkbox"
                      class="track-include-check"
                      data-track-index="${index}"
                      ${track.included !== false ? "checked" : ""}
                      aria-label="Include ${escapeHtml(track.name)} in Play All and export"
                    >
                  </label>
                  <div class="channel-accent"></div>
                  <div class="channel-title-block">
                    <button
                      type="button"
                      class="track-collapse-btn channel-name-row"
                      data-track-index="${index}"
                      aria-expanded="${collapsed ? "false" : "true"}"
                      title="${collapsed ? "Expand notation" : "Collapse notation"}"
                    >
                      <span class="channel-name">${escapeHtml(track.name)}</span>
                      <span class="track-collapse-chevron" aria-hidden="true">${collapsed ? "▸" : "▾"}</span>
                    </button>
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
                  <div class="track-download-group">
                    <select
                      class="track-export-format"
                      data-track-index="${index}"
                      aria-label="Download format for ${escapeHtml(track.name)}"
                      title="WAV = SoundFont audio · MIDI = note data"
                    >
                      <option value="wav">WAV</option>
                      <option value="midi">MIDI</option>
                    </select>
                    <button
                      type="button"
                      class="track-download-btn"
                      data-track-index="${index}"
                      title="Download this track"
                    >⬇ Download</button>
                  </div>
                </div>
              </div>

              <div class="transport-row track-transport" data-player-index="${index}">
                <div class="transport-controls track-player">
                  <button type="button" class="track-play" title="Play or pause this track">▶</button>
                  <button type="button" class="track-stop" title="Stop this track">■</button>
                </div>
                <div class="seek-bar track-seek" data-seek-index="${index}" aria-label="Seek ${escapeHtml(track.name)}">
                  <span class="seek-time track-seek-time">0:00</span>
                  <input
                    type="range"
                    class="seek-input track-seek-input"
                    data-seek-index="${index}"
                    min="0"
                    max="0"
                    step="0.05"
                    value="0"
                    title="Scrub to play from this point"
                  >
                  <span class="seek-time track-seek-duration">0:00</span>
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
  setupTrackIncludeCheckboxes();
  setupTrackCollapseButtons();
  setGlobalPlaybackUI("stopped");
  setGlobalPlaybackEnabled(true);
  updateIncludedTracksUI();

}

function setupTrackCollapseButtons() {
  elements.channels.querySelectorAll(".track-collapse-btn").forEach(btn => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", event => {
      event.preventDefault();
      const index = Number(btn.dataset.trackIndex);
      const track = conversionResults[index];
      if (!track) return;
      track.collapsed = !track.collapsed;
      const channel = elements.channels.querySelector(
        `.channel[data-track-index="${index}"]`
      );
      if (!channel) return;
      const collapsed = track.collapsed === true;
      channel.classList.toggle("is-collapsed", collapsed);
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.title = collapsed ? "Expand notation" : "Collapse notation";
      const chevron = btn.querySelector(".track-collapse-chevron");
      if (chevron) chevron.textContent = collapsed ? "▸" : "▾";
    });
  });
}

/** Collapse or expand every track's notation. */
function setAllTracksCollapsed(collapsed) {
  conversionResults.forEach((track, index) => {
    track.collapsed = !!collapsed;
    const channel = elements.channels.querySelector(
      `.channel[data-track-index="${index}"]`
    );
    const btn = channel?.querySelector(".track-collapse-btn");
    channel?.classList.toggle("is-collapsed", !!collapsed);
    if (btn) {
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.title = collapsed ? "Expand notation" : "Collapse notation";
      const chevron = btn.querySelector(".track-collapse-chevron");
      if (chevron) chevron.textContent = collapsed ? "▸" : "▾";
    }
  });
}

/** Indices of tracks whose include checkbox is on (default: all). */
function getIncludedTrackIndices() {
  return conversionResults
    .map((track, index) => (track.included !== false ? index : -1))
    .filter(index => index >= 0);
}

/** Enable/disable play, sound, seek, download, collapse for one track card. */
function setTrackControlsEnabled(channel, enabled) {
  if (!channel) return;
  channel.querySelectorAll(
    ".track-play, .track-stop, .track-instrument-select, .track-export-format, .track-download-btn, .track-seek-input, .track-collapse-btn"
  ).forEach(el => {
    el.disabled = !enabled;
  });
}

function setupTrackIncludeCheckboxes() {
  elements.channels.querySelectorAll(".track-include-check").forEach(input => {
    input.addEventListener("change", () => {
      const index = Number(input.dataset.trackIndex);
      if (!conversionResults[index]) return;
      conversionResults[index].included = input.checked;
      const channel = elements.channels.querySelector(
        `.channel[data-track-index="${index}"]`
      );
      channel?.classList.toggle("is-excluded", !input.checked);
      // Stop this track if it was playing and got unchecked
      if (!input.checked) {
        const state = trackPlayers.get(index);
        if (state && (state.status === "playing" || state.status === "paused")) {
          stopTrackPlayer(index, true);
          updateTrackSeekUI(index, 0);
          updateTrackPlayerUI(index);
        }
      }
      updateIncludedTracksUI();
    });
  });
}

function updateIncludedTracksUI() {
  const total = conversionResults.length;
  const included = getIncludedTrackIndices().length;
  conversionResults.forEach((track, index) => {
    const channel = elements.channels.querySelector(
      `.channel[data-track-index="${index}"]`
    );
    const on = track.included !== false;
    channel?.classList.toggle("is-excluded", !on);
    setTrackControlsEnabled(channel, on);
  });
  if (elements.globalPlaybackStatus && globalPlaybackState.status === "stopped") {
    elements.globalPlaybackStatus.textContent =
      total === 0
        ? "Ready"
        : included === total
          ? `Ready · ${total} track${total === 1 ? "" : "s"}`
          : `Ready · ${included} of ${total} selected`;
  }
  // Disable Play All / download when nothing is selected
  const any = included > 0;
  if (elements.playAllButton) elements.playAllButton.disabled = !any;
  if (elements.downloadAllMidiButton) {
    elements.downloadAllMidiButton.disabled = !any;
  }
  if (elements.exportAllFormat) {
    elements.exportAllFormat.disabled = !any;
  }
}



function clearPlaybackHighlights() {
  document.querySelectorAll(".playback-active, .playback-current-beat").forEach(el => {
    el.classList.remove("playback-active", "playback-current-beat");
  });
}

function updatePlaybackHighlights(positionSeconds, trackIndex = null) {
  const tempoBpm = getPlaybackTempoBpm();
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
      if (!globalSeekDragging) updateGlobalSeekUI(elapsed);
      // Keep per-track bars in sync when playing all
      if (!trackSeekDragging) {
        trackPlayers.forEach((state, index) => {
          if (state.status === "playing") updateTrackSeekUI(index, elapsed);
        });
      }
      playbackHighlightFrame = requestAnimationFrame(tick);
      return;
    }

    const playingStates = [...trackPlayers.values()].filter(state => state.status === "playing");
    if (playingStates.length) {
      const now = performance.now() / 1000;
      playingStates.forEach(state => {
        const elapsed = Math.max(0, now - state.startedAt);
        updatePlaybackHighlights(elapsed, state.index);
        if (!trackSeekDragging) updateTrackSeekUI(state.index, elapsed);
      });
      playbackHighlightFrame = requestAnimationFrame(tick);
    } else {
      playbackHighlightFrame = null;
    }
  };
  playbackHighlightFrame = requestAnimationFrame(tick);
}

/** Format seconds as m:ss (or h:mm:ss if long). */
function formatPlaybackTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function getTempoSecondsPerBeat() {
  return 60 / (getPlaybackTempoBpm());
}

function getTrackDurationSeconds(index) {
  const track = conversionResults[index];
  if (!track) return 0;
  const beats = (track.playbackNotes || []).reduce(
    (max, note) => Math.max(max, note.startBeat + note.durationBeats),
    0
  );
  return beats * getTempoSecondsPerBeat();
}

let globalSeekDragging = false;
let trackSeekDragging = false;

function updateGlobalSeekUI(positionSeconds) {
  const input = elements.globalSeek;
  if (!input) return;
  const duration = Math.max(
    globalPlaybackState.duration || 0,
    getAllTrackDuration(true) * getTempoSecondsPerBeat()
  );
  input.max = String(Math.max(duration, 0.01));
  input.disabled = duration <= 0;
  if (!globalSeekDragging) {
    input.value = String(Math.min(duration, Math.max(0, positionSeconds)));
  }
  if (elements.globalSeekTime) {
    elements.globalSeekTime.textContent = formatPlaybackTime(positionSeconds);
  }
  if (elements.globalSeekDuration) {
    elements.globalSeekDuration.textContent = formatPlaybackTime(duration);
  }
}

function updateTrackSeekUI(index, positionSeconds) {
  const input = elements.channels?.querySelector(
    `.track-seek-input[data-seek-index="${index}"]`
  );
  if (!input) return;
  const duration = getTrackDurationSeconds(index);
  input.max = String(Math.max(duration, 0.01));
  if (!trackSeekDragging) {
    input.value = String(Math.min(duration, Math.max(0, positionSeconds)));
  }
  const row = input.closest(".track-seek");
  const timeEl = row?.querySelector(".track-seek-time");
  const durEl = row?.querySelector(".track-seek-duration");
  if (timeEl) timeEl.textContent = formatPlaybackTime(positionSeconds);
  if (durEl) durEl.textContent = formatPlaybackTime(duration);
}

/**
 * Jump all tracks to `seconds` (and keep playing if already playing).
 */
function seekGlobal(seconds) {
  const duration = Math.max(
    globalPlaybackState.duration || 0,
    getAllTrackDuration(true) * getTempoSecondsPerBeat()
  );
  const t = Math.max(0, Math.min(duration || 0, Number(seconds) || 0));
  const wasPlaying = globalPlaybackState.status === "playing";

  clearGlobalPlaybackTimer();
  trackPlayers.forEach((state, index) => {
    stopTrackPlayer(index, false);
    state.pausedAt = t;
  });

  globalPlaybackState.pausedAt = t;
  globalPlaybackState.duration = duration;
  updateGlobalSeekUI(t);
  updatePlaybackHighlights(t);

  if (wasPlaying) {
    // Resume from the scrubbed point
    globalPlaybackState.status = "paused";
    playAllTrackPlayers();
  } else if (globalPlaybackState.status !== "paused") {
    globalPlaybackState.status = "stopped";
    setGlobalPlaybackUI("stopped");
  }
}

/**
 * Jump a single track to `seconds`.
 */
function seekTrack(index, seconds) {
  const duration = getTrackDurationSeconds(index);
  const t = Math.max(0, Math.min(duration, Number(seconds) || 0));
  let state = trackPlayers.get(index);
  if (!state) {
    state = createTrackPlayer(index);
    if (state) trackPlayers.set(index, state);
  }
  if (!state) return;

  const wasPlaying = state.status === "playing";
  stopTrackPlayer(index, false);
  state.pausedAt = t;
  state.status = wasPlaying || state.status === "paused" ? "paused" : "stopped";
  updateTrackSeekUI(index, t);
  updatePlaybackHighlights(t, index);
  updateTrackPlayerUI(index);

  if (wasPlaying) {
    scheduleTrackFrom(index, t);
  }
}

function setupGlobalSeekBar() {
  const input = elements.globalSeek;
  if (!input || input.dataset.bound === "1") return;
  input.dataset.bound = "1";

  input.addEventListener("pointerdown", () => {
    globalSeekDragging = true;
  });
  input.addEventListener("pointerup", () => {
    globalSeekDragging = false;
    seekGlobal(Number(input.value));
  });
  input.addEventListener("change", () => {
    globalSeekDragging = false;
    seekGlobal(Number(input.value));
  });
  // Live time label while dragging
  input.addEventListener("input", () => {
    if (elements.globalSeekTime) {
      elements.globalSeekTime.textContent = formatPlaybackTime(Number(input.value));
    }
  });
}

function setupTrackSeekBars() {
  elements.channels.querySelectorAll(".track-seek-input").forEach(input => {
    if (input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    const index = Number(input.dataset.seekIndex);

    input.addEventListener("pointerdown", () => {
      trackSeekDragging = true;
    });
    input.addEventListener("pointerup", () => {
      trackSeekDragging = false;
      seekTrack(index, Number(input.value));
    });
    input.addEventListener("change", () => {
      trackSeekDragging = false;
      seekTrack(index, Number(input.value));
    });
    input.addEventListener("input", () => {
      const row = input.closest(".track-seek");
      const timeEl = row?.querySelector(".track-seek-time");
      if (timeEl) timeEl.textContent = formatPlaybackTime(Number(input.value));
    });
  });
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

  const tempoBpm = getPlaybackTempoBpm();
  const secondsPerBeat = 60 / tempoBpm;
  const channel = soundFontChannelForTrack(index);
  // Program select once per schedule — not on every note (that was cutting notes).
  prepareSoundFontChannel(channel, state.track);

  // One uniform octave shift for the whole track so intervals stay natural.
  const program = resolveSoundFontProgram(state.track);
  const midis = (state.track.playbackNotes || []).map(n => n.midi);
  const trackShift = computeTrackOctaveShift(midis, program);
  state.trackShift = trackShift;

  // songStartWall = wall-clock time of beat 0 (already accounts for offset when resuming).
  // Do NOT subtract offsetSeconds again — that doubled the pause position and skipped notes.
  const songStartWall =
    sharedStartWall ?? (performance.now() / 1000 - offsetSeconds);
  state.startedAt = songStartWall;
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
  // Resume from pause *or* from a scrubbed position (pausedAt > 0 while stopped)
  const offset =
    state.status === "paused" || state.pausedAt > 0 ? state.pausedAt : 0;
  scheduleTrackFrom(index, offset);
  updateTrackSeekUI(index, offset);
}

function pauseTrackPlayer(index) {
  const state = trackPlayers.get(index);
  if (!state || state.status !== "playing") return;
  const tempoBpm = getPlaybackTempoBpm();
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
  updateTrackSeekUI(index, state.pausedAt);
}

function updateTrackPlayerUI(index) {
  const root = elements.channels.querySelector(`[data-player-index="${index}"]`);
  if (!root) return;
  const state = trackPlayers.get(index);
  const playing = state?.status === "playing";
  root.classList.toggle("is-playing", playing);
  elements.channels
    .querySelector(`.channel[data-track-index="${index}"]`)
    ?.classList.toggle("is-playing", playing);
  const playBtn = root.querySelector(".track-play");
  if (playBtn) {
    if (playing) {
      playBtn.textContent = "⏸";
      playBtn.title = "Pause this track";
    } else if (state?.status === "paused") {
      playBtn.textContent = "▶";
      playBtn.title = "Resume this track";
    } else {
      playBtn.textContent = "▶";
      playBtn.title = "Play this track";
    }
  }
}

function toggleTrackPlayer(index) {
  const state = trackPlayers.get(index);
  if (state?.status === "playing") {
    pauseTrackPlayer(index);
  } else {
    playTrackPlayer(index);
  }
}

function getAllTrackDuration(onlyIncluded = true) {
  const tracks = onlyIncluded
    ? conversionResults.filter(t => t.included !== false)
    : conversionResults;
  return tracks.reduce(
    (max, track) =>
      Math.max(
        max,
        (track.playbackNotes || []).reduce(
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
  elements.stopAllButton.disabled = !enabled;
  if (elements.downloadAllMidiButton) {
    elements.downloadAllMidiButton.disabled = !enabled;
  }
  if (elements.exportAllFormat) {
    elements.exportAllFormat.disabled = !enabled;
  }
  // Octave − / + only useful once notation exists
  syncOctaveShiftFromValue();
}

function setGlobalPlaybackUI(status) {
  if (!elements.globalPlaybackStatus) return;

  const total = conversionResults.length;
  const included = getIncludedTrackIndices().length;
  let label = "Ready";
  if (status === "playing") {
    label =
      included === total
        ? "Playing all tracks"
        : `Playing ${included} of ${total} tracks`;
  } else if (status === "paused") {
    label = "Paused";
  } else if (total > 0) {
    label =
      included === total
        ? `Ready · ${total} track${total === 1 ? "" : "s"}`
        : `Ready · ${included} of ${total} selected`;
  }
  elements.globalPlaybackStatus.textContent = label;

  if (elements.playAllButton) {
    elements.playAllButton.classList.toggle("is-active", status === "playing");
    if (status === "playing") {
      elements.playAllButton.textContent = "⏸";
      elements.playAllButton.title = "Pause all tracks";
    } else if (status === "paused") {
      elements.playAllButton.textContent = "▶";
      elements.playAllButton.title = "Resume all tracks";
    } else {
      elements.playAllButton.textContent = "▶";
      elements.playAllButton.title = "Play all selected tracks";
    }
  }
}

function togglePlayAllTrackPlayers() {
  if (globalPlaybackState.status === "playing") {
    pauseAllTrackPlayers();
  } else {
    playAllTrackPlayers();
  }
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
  const included = getIncludedTrackIndices();
  if (!included.length) {
    showError("No tracks selected. Check at least one track to play.");
    return;
  }

  const ctx = getPlaybackAudioContext();
  if (ctx.state === "suspended") ctx.resume();

  // Resume from pause *or* from a scrubbed position while stopped
  const offsetSeconds =
    globalPlaybackState.status === "paused" || globalPlaybackState.pausedAt > 0
      ? globalPlaybackState.pausedAt
      : 0;

  // Stop everything first; only checked tracks will be scheduled
  trackPlayers.forEach((state, index) => {
    stopTrackPlayer(index, false);
    state.pausedAt = offsetSeconds;
  });

  clearGlobalPlaybackTimer();

  const tempoBpm = getPlaybackTempoBpm();
  const secondsPerBeat = 60 / tempoBpm;
  const sharedStartWall = performance.now() / 1000 - offsetSeconds;
  globalPlaybackState.startedAt = sharedStartWall;
  // Duration from selected tracks only (beats → seconds)
  globalPlaybackState.duration = getAllTrackDuration(true) * secondsPerBeat;
  globalPlaybackState.pausedAt = offsetSeconds;
  globalPlaybackState.status = "playing";

  included.forEach(index => {
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
      updateGlobalSeekUI(0);
    }
  }, remaining * 1000 + 150);

  setGlobalPlaybackUI("playing");
  updateGlobalSeekUI(offsetSeconds);
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
  updateGlobalSeekUI(globalPlaybackState.pausedAt);
}

elements.playAllButton?.addEventListener("click", togglePlayAllTrackPlayers);
elements.stopAllButton?.addEventListener("click", () => {
  clearGlobalPlaybackTimer();
  stopAllTrackPlayers(true);
  updateGlobalSeekUI(0);
  setGlobalPlaybackUI("stopped");
});
setupGlobalSeekBar();

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
    player.querySelector(".track-play")?.addEventListener("click", () => toggleTrackPlayer(index));
    player.querySelector(".track-stop")?.addEventListener("click", () => {
      stopTrackPlayer(index, true);
      updateTrackSeekUI(index, 0);
      updateTrackPlayerUI(index);
    });
  });

  elements.channels.querySelectorAll(".track-download-btn").forEach(btn => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      downloadTrackExport(Number(btn.dataset.trackIndex));
    });
  });

  setupTrackSeekBars();
  const totalDuration = getAllTrackDuration(true) * getTempoSecondsPerBeat();
  globalPlaybackState.duration = totalDuration;
  updateGlobalSeekUI(0);
  conversionResults.forEach((_, index) => updateTrackSeekUI(index, 0));
}

elements.downloadAllMidiButton?.addEventListener("click", downloadAllTracksExport);


/* ============================================================
   9. EXPORT
   ============================================================ */

/** Strip null bytes (from some MIDI track names) that make Windows treat the file as UTF-16. */
function sanitizeExportText(text) {
  return String(text ?? "").replace(/\u0000/g, "");
}

/* ---------- SoundFont offline render → WAV ---------- */

function safeAudioFilename(name) {
  return sanitizeExportText(name || "track")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 48) || "track";
}

/**
 * Notes for export: same pitches as on-screen playback (including whole-track
 * octave shift into the chosen instrument's sample range).
 */
function getExportNotesForTrack(track) {
  const program = resolveSoundFontProgram(track);
  const notes = track.playbackNotes || [];
  const midis = notes.map(n => n.midi);
  const shift = computeTrackOctaveShift(midis, program);
  return notes.map(n => ({
    midi: mapMidiForPlayback(n.midi, program, shift),
    startBeat: n.startBeat,
    durationBeats: n.durationBeats,
    velocity: 100
  }));
}

/** Encode stereo Float32 samples as 16-bit PCM WAV. */
function encodeWavStereo(left, right, sampleRate) {
  const n = left.length;
  const dataSize = n * 4; // 2 channels × 2 bytes
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    let l = Math.max(-1, Math.min(1, left[i]));
    let r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(o, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(o + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    o += 4;
  }
  return buffer;
}

function downloadArrayBuffer(buffer, filename, mime) {
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Render one or more tracks offline with the loaded GW2 SoundFont.
 * trackSpecs: [{ channel, program, notes: [{midi, startBeat, durationBeats, velocity}] }]
 */
async function renderTracksToWavBuffer(trackSpecs, onProgress) {
  const ready = await ensureSoundFontReady();
  if (!ready || !soundFontEngine.synth) {
    throw new Error(
      soundFontEngine.lastError ||
        "SoundFont is not ready. Load the SoundFont first (play a note or open the app over http)."
    );
  }

  const synth = soundFontEngine.synth;
  const ctx = getPlaybackAudioContext();
  const sampleRate = ctx.sampleRate || 44100;
  const tempoBpm = getPlaybackTempoBpm();
  const secondsPerBeat = 60 / tempoBpm;
  const gainMul = soundFontEngine.outputGain || 1;

  // Stop live playback so we can borrow the synth without fighting it
  stopAllTrackPlayers(true);
  stopAllPianoNotes();
  const prevGain = soundFontEngine.gainNode ? soundFontEngine.gainNode.gain.value : 1;
  if (soundFontEngine.gainNode) soundFontEngine.gainNode.gain.value = 0;

  try {
    for (let ch = 0; ch < 16; ch++) soundFontAllNotesOff(ch);

    // Build timeline of MIDI events (sample index)
    const events = [];
    let maxEndBeat = 0;

    for (const spec of trackSpecs) {
      const ch = (spec.channel ?? 0) & 0x0f;
      const program = spec.program ?? 0;
      try {
        synth.midiProgramSelect(ch, soundFontEngine.soundFontId, 0, program);
        synth.midiCC(ch, 7, 127);
        synth.midiCC(ch, 11, 127);
      } catch (_) {}

      for (const note of spec.notes || []) {
        const startBeat = Number(note.startBeat) || 0;
        const durBeats = Math.max(0.05, Number(note.durationBeats) || 0.25);
        const startSample = Math.round(startBeat * secondsPerBeat * sampleRate);
        const endSample = Math.round((startBeat + durBeats) * secondsPerBeat * sampleRate);
        const midi = Math.max(0, Math.min(127, note.midi | 0));
        const vel = Math.max(1, Math.min(127, note.velocity ?? 100));
        events.push({ sample: startSample, type: "on", ch, midi, vel });
        events.push({ sample: endSample, type: "off", ch, midi });
        maxEndBeat = Math.max(maxEndBeat, startBeat + durBeats);
      }
    }

    events.sort((a, b) => a.sample - b.sample || (a.type === "off" ? -1 : 1));

    // +1.5s tail so releases/reverb don't get cut off
    const totalSamples = Math.max(
      sampleRate,
      Math.ceil(maxEndBeat * secondsPerBeat * sampleRate) + Math.ceil(1.5 * sampleRate)
    );

    const left = new Float32Array(totalSamples);
    const right = new Float32Array(totalSamples);
    const blockSize = 512;
    const blockL = new Float32Array(blockSize);
    const blockR = new Float32Array(blockSize);

    let samplePos = 0;
    let eventIndex = 0;
    let lastYield = performance.now();

    while (samplePos < totalSamples) {
      // Fire all events at or before this block's start
      while (eventIndex < events.length && events[eventIndex].sample <= samplePos) {
        const ev = events[eventIndex++];
        try {
          if (ev.type === "on") synth.midiNoteOn(ev.ch, ev.midi, ev.vel);
          else synth.midiNoteOff(ev.ch, ev.midi);
        } catch (_) {}
      }

      const remaining = totalSamples - samplePos;
      const thisBlock = Math.min(blockSize, remaining);

      try {
        synth.render([blockL, blockR]);
      } catch (e) {
        console.warn("synth.render failed", e);
        blockL.fill(0);
        blockR.fill(0);
      }

      if (thisBlock === blockSize) {
        left.set(blockL, samplePos);
        right.set(blockR, samplePos);
      } else {
        left.set(blockL.subarray(0, thisBlock), samplePos);
        right.set(blockR.subarray(0, thisBlock), samplePos);
      }

      samplePos += thisBlock;

      // Keep UI responsive on long songs
      if (performance.now() - lastYield > 80) {
        if (typeof onProgress === "function") {
          onProgress(Math.min(1, samplePos / totalSamples));
        }
        await new Promise(r => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }

    for (let ch = 0; ch < 16; ch++) soundFontAllNotesOff(ch);

    // Apply the same output gain as live playback
    if (gainMul !== 1) {
      for (let i = 0; i < totalSamples; i++) {
        left[i] *= gainMul;
        right[i] *= gainMul;
      }
    }

    return encodeWavStereo(left, right, sampleRate);
  } finally {
    for (let ch = 0; ch < 16; ch++) {
      try { soundFontAllNotesOff(ch); } catch (_) {}
    }
    if (soundFontEngine.gainNode) soundFontEngine.gainNode.gain.value = prevGain;
  }
}

function setExportStatus(message) {
  if (elements.status) elements.status.textContent = message;
}

function getTrackExportFormat(index) {
  const select = document.querySelector(
    `.track-export-format[data-track-index="${index}"]`
  );
  return select?.value === "midi" ? "midi" : "wav";
}

function getAllExportFormat() {
  return elements.exportAllFormat?.value === "midi" ? "midi" : "wav";
}

function sourceFileBaseName() {
  return midiFile && midiFile.name
    ? midiFile.name.replace(/\.(midi?|msc[zx])$/i, "")
    : "gw2";
}

/** Write variable-length quantity (MIDI delta-time). */
function writeMidiVarLen(value) {
  value = Math.max(0, value | 0);
  const bytes = [value & 0x7f];
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return bytes;
}

function appendBytes(target, bytes) {
  for (const b of bytes) target.push(b & 0xff);
}

/**
 * Build a Type-1 SMF from track specs.
 * specs: [{ name?, program, notes: [{midi, startBeat, durationBeats, velocity}] }]
 */
function buildMidiFileBuffer(specs, tempoBpm) {
  const ppq = 480;
  const bpm = Number(tempoBpm) || 120;
  const usPerBeat = Math.round(60_000_000 / bpm);

  const encodeTrack = (events) => {
    // events: [{ tick, bytes: number[] }]
    events.sort((a, b) => a.tick - b.tick || 0);
    const data = [];
    let lastTick = 0;
    for (const ev of events) {
      const delta = Math.max(0, ev.tick - lastTick);
      lastTick = ev.tick;
      appendBytes(data, writeMidiVarLen(delta));
      appendBytes(data, ev.bytes);
    }
    // End of track
    appendBytes(data, writeMidiVarLen(0));
    appendBytes(data, [0xff, 0x2f, 0x00]);
    return data;
  };

  const tracks = [];

  // Tempo / meta track
  tracks.push(
    encodeTrack([
      {
        tick: 0,
        bytes: [0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff]
      }
    ])
  );

  for (const spec of specs) {
    const program = (spec.program ?? 0) & 0x7f;
    const channel = (spec.channel ?? 0) & 0x0f;
    const events = [];
    // Track name
    if (spec.name) {
      const nameBytes = Array.from(
        new TextEncoder().encode(String(spec.name).slice(0, 32))
      );
      events.push({
        tick: 0,
        bytes: [0xff, 0x03, nameBytes.length, ...nameBytes]
      });
    }
    events.push({ tick: 0, bytes: [0xc0 | channel, program] });

    for (const note of spec.notes || []) {
      const startTick = Math.max(0, Math.round(note.startBeat * ppq));
      const durTicks = Math.max(1, Math.round(note.durationBeats * ppq));
      const midi = Math.max(0, Math.min(127, note.midi | 0));
      const vel = Math.max(1, Math.min(127, note.velocity ?? 100));
      events.push({ tick: startTick, bytes: [0x90 | channel, midi, vel] });
      events.push({
        tick: startTick + durTicks,
        bytes: [0x80 | channel, midi, 0x40]
      });
    }
    tracks.push(encodeTrack(events));
  }

  const header = [];
  // MThd
  appendBytes(header, [0x4d, 0x54, 0x68, 0x64]);
  appendBytes(header, [0x00, 0x00, 0x00, 0x06]);
  appendBytes(header, [0x00, 0x01]); // Type 1
  appendBytes(header, [(tracks.length >> 8) & 0xff, tracks.length & 0xff]);
  appendBytes(header, [(ppq >> 8) & 0xff, ppq & 0xff]);

  const parts = [new Uint8Array(header)];
  for (const trackData of tracks) {
    const th = [];
    appendBytes(th, [0x4d, 0x54, 0x72, 0x6b]); // MTrk
    const len = trackData.length;
    appendBytes(th, [(len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
    parts.push(new Uint8Array(th), new Uint8Array(trackData));
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out.buffer;
}

async function downloadTrackExport(index) {
  const track = conversionResults[index];
  if (!track) return;

  const format = getTrackExportFormat(index);
  const btn = document.querySelector(
    `.channel[data-track-index="${index}"] .track-download-btn`
  );
  if (btn) btn.disabled = true;

  try {
    const program = resolveSoundFontProgram(track);
    const presetName =
      SOUND_FONT_PRESETS.find(p => p.program === program)?.name || `program-${program}`;
    const base =
      `${sourceFileBaseName()}_${safeAudioFilename(track.name)}_${safeAudioFilename(presetName)}`;

    if (format === "midi") {
      setExportStatus(`Building MIDI · ${track.name || "track"}…`);
      const buffer = buildMidiFileBuffer(
        [
          {
            name: track.name,
            channel: 0,
            program,
            notes: getExportNotesForTrack(track)
          }
        ],
        getPlaybackTempoBpm()
      );
      downloadArrayBuffer(buffer, `${base}.mid`, "audio/midi");
      setExportStatus(`Downloaded ${base}.mid`);
      return;
    }

    setExportStatus(`Rendering WAV · ${track.name || "track"}…`);
    const wav = await renderTracksToWavBuffer(
      [
        {
          channel: 0,
          program,
          notes: getExportNotesForTrack(track)
        }
      ],
      pct => setExportStatus(`Rendering WAV · ${track.name || "track"}… ${Math.round(pct * 100)}%`)
    );
    downloadArrayBuffer(wav, `${base}.wav`, "audio/wav");
    setExportStatus(`Downloaded ${base}.wav`);
  } catch (err) {
    console.error(err);
    showError(err.message || "Download failed");
    setExportStatus("Download failed");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function downloadAllTracksExport() {
  const included = getIncludedTrackIndices();
  if (!included.length) {
    showError("No tracks selected. Check at least one track to export.");
    return;
  }

  const format = getAllExportFormat();
  const btn = elements.downloadAllMidiButton;
  if (btn) btn.disabled = true;

  try {
    const label =
      included.length === conversionResults.length
        ? "all tracks"
        : `${included.length} selected track${included.length === 1 ? "" : "s"}`;
    const base =
      sourceFileBaseName() +
      (included.length === conversionResults.length
        ? "_all_tracks"
        : `_${included.length}tracks`);

    const specs = included.map((index, i) => {
      const track = conversionResults[index];
      return {
        name: track.name,
        channel: i % 15,
        program: resolveSoundFontProgram(track),
        notes: getExportNotesForTrack(track)
      };
    });

    if (format === "midi") {
      setExportStatus(`Building MIDI · ${label}…`);
      const buffer = buildMidiFileBuffer(specs, getPlaybackTempoBpm());
      downloadArrayBuffer(buffer, `${base}.mid`, "audio/midi");
      setExportStatus(`Downloaded ${base}.mid`);
      return;
    }

    setExportStatus(`Rendering ${label} to WAV…`);
    const wav = await renderTracksToWavBuffer(specs, pct =>
      setExportStatus(`Rendering ${label}… ${Math.round(pct * 100)}%`)
    );
    downloadArrayBuffer(wav, `${base}.wav`, "audio/wav");
    setExportStatus(`Downloaded ${base}.wav`);
  } catch (err) {
    console.error(err);
    showError(err.message || "Download failed");
    setExportStatus("Download failed");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function getAllPlainText() {
  return conversionResults
    .filter(track => track.included !== false)
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

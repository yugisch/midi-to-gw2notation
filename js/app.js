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


function loadMidiFile(file) {

  if (!file) {
    return;
  }

  if (!/\.midi?$/i.test(file.name)) {
    showError("Please choose a .mid or .midi file.");
    return;
  }

  midiFile = file;

  elements.fileName.textContent = file.name;

  elements.convertButton.disabled = false;

  clearError();

  elements.status.textContent =
    `MIDI ready · ${(file.size / 1024).toFixed(1)} KB`;
}


elements.clearFile.addEventListener("click", () => {

  stopAllTrackPlayers(true);
  setGlobalPlaybackUI("stopped");

  midiFile = null;

  elements.midiFile.value = "";

  elements.fileName.textContent =
    "No MIDI file selected";

  elements.convertButton.disabled = true;

  clearError();

  elements.status.textContent =
    "Waiting for a MIDI file";

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

async function convertMidi() {

  if (!midiFile) {
    return;
  }

  elements.convertButton.disabled = true;

  elements.status.textContent =
    "Reading MIDI…";

  clearError();

  try {

    const arrayBuffer =
      await midiFile.arrayBuffer();

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
            elements.preserveFastNotes.checked
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

    elements.status.textContent =
      `${conversionResults.length} track${
        conversionResults.length === 1 ? "" : "s"
      } · ${
        conversionResults.reduce(
          (total, track) => total + track.noteCount,
          0
        )
      } notes · ${transposeLabel}`;

    enableExportButtons();

  }
  catch (error) {

    showError(
      error.message ||
      "Could not read this MIDI file."
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

function convertTrack(
  track,
  index,
  beatGrid,
  transpose = 0,
  preserveFastNotes = true
) {

  if (!track.notes.length) {
    return null;
  }

  const ppq = Number(track.ppq) || 480;
  const notes = track.notes;
  const requestedGrid = beatGrid === "auto" ? 1 : Number(beatGrid);
  const tempoBpm = Number(elements.tempo?.value) || 120;
  const secondsPerBeat = 60 / tempoBpm;

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
      let token = uniqueNotes
        .map(noteToHtml)
        .join('<span class="accidental">/</span>');

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

  const lines = [];
  for (let lineStart = 0; lineStart < beats.length; lineStart += 12) {
    const lineBeats = beats.slice(lineStart, lineStart + 12);
    let line = "";

    lineBeats.forEach((beat, localBeatIndex) => {
      if (localBeatIndex > 0) {
        if (localBeatIndex % 4 === 0) line += '<span class="bar"> | </span>';
        else if (localBeatIndex % 2 === 0) line += "  ";
        else line += " ";
      }
      line += beat;
    });

    lines.push(line);
  }

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
    playbackInstrumentLabel: PLAYBACK_INSTRUMENT_LABELS[detectPlaybackInstrument(track, index)] || "Piano",
    playbackNotes: events.map(event => ({
      midi: event.midi,
      startBeat: event.startTick / ppq,
      durationBeats: Math.max(0.01, event.durationTicks / ppq)
    })),
    effectiveGrid: Math.min(...effectiveGrids),
    requestedGrid: beatGrid,
    transpose
  };
}


/* ============================================================
   8. OUTPUT RENDERING
   ============================================================ */

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

              <div class="track-player" data-player-index="${index}">
                <button type="button" class="track-play" title="Play this track">▶ Play</button>
                <button type="button" class="track-pause" title="Pause this track">⏸ Pause</button>
                <button type="button" class="track-stop" title="Stop this track">■ Stop</button>
              </div>
            </div>

            <div class="notation">${track.html}</div>

          </div>
        `;

      })
      .join("");

  setupTrackPlayers();
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

function instrumentVoiceConfig(type) {
  const configs = {
    piano:  { wave: "triangle", attack: 0.008, release: 0.45, filter: 2600, gain: 0.20 },
    strings:{ wave: "sawtooth", attack: 0.16, release: 0.65, filter: 1800, gain: 0.10 },
    brass:  { wave: "sawtooth", attack: 0.07, release: 0.35, filter: 1400, gain: 0.12 },
    flute:  { wave: "sine", attack: 0.10, release: 0.35, filter: 3000, gain: 0.16 },
    guitar: { wave: "triangle", attack: 0.006, release: 0.30, filter: 2200, gain: 0.18 },
    lute:   { wave: "triangle", attack: 0.004, release: 0.24, filter: 2600, gain: 0.17 },
    harp:   { wave: "sine", attack: 0.003, release: 0.55, filter: 3200, gain: 0.16 },
    bass:   { wave: "triangle", attack: 0.012, release: 0.42, filter: 900, gain: 0.22 },
    organ:  { wave: "sine", attack: 0.03, release: 0.30, filter: 2400, gain: 0.13 },
    choir:  { wave: "sine", attack: 0.22, release: 0.75, filter: 1600, gain: 0.10 },
    synth:  { wave: "square", attack: 0.025, release: 0.35, filter: 1900, gain: 0.08 }
  };
  return configs[type] || configs.piano;
}

function stopVoice(voice, ctx, release = 0.06) {
  if (!voice) return;
  const now = ctx.currentTime;
  try {
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + release);
    voice.osc.stop(now + release + 0.02);
  } catch (_) {}
}

function createTrackVoice(track, note, when, duration) {
  const ctx = getPlaybackAudioContext();
  const config = instrumentVoiceConfig(track.playbackInstrument);
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const frequency = midiToFrequency(note.midi);

  osc.type = config.wave;
  osc.frequency.setValueAtTime(frequency, when);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(config.filter, when);
  filter.Q.value = track.playbackInstrument === "synth" ? 2.5 : 0.7;

  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(config.gain, when + config.attack);
  gain.gain.setValueAtTime(config.gain * 0.72, when + config.attack + Math.min(0.08, duration * 0.15));
  gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(config.attack + 0.03, duration) + config.release);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + Math.max(config.attack + 0.03, duration) + config.release + 0.04);

  return { osc, gain };
}

function createTrackPlayer(index) {
  const track = conversionResults[index];
  if (!track) return null;

  const state = {
    index,
    track,
    status: "stopped",
    startedAt: 0,
    pausedAt: 0,
    timerIds: [],
    voices: new Set(),
    duration: track.playbackNotes.reduce(
      (max, note) => Math.max(max, note.startBeat + note.durationBeats), 0
    )
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
  const ctx = getPlaybackAudioContext();
  clearPlayerTimers(state);
  state.voices.forEach(voice => stopVoice(voice, ctx));
  state.voices.clear();
  state.status = "stopped";
  state.pausedAt = reset ? 0 : state.pausedAt;
  clearPlaybackHighlights();
  updateTrackPlayerUI(index);
}

function scheduleTrackFrom(index, offsetSeconds, sharedStartWall = null) {
  const state = trackPlayers.get(index);
  if (!state) return;
  const ctx = getPlaybackAudioContext();
  clearPlayerTimers(state);

  const tempoBpm = Number(elements.tempo?.value) || 120;
  const secondsPerBeat = 60 / tempoBpm;
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
      const actualOffset = Math.max(0, offsetSeconds - noteStart);
      const remaining = Math.max(0.025, note.durationBeats * secondsPerBeat - actualOffset);
      const voice = createTrackVoice(state.track, note, ctx.currentTime, remaining);
      state.voices.add(voice);
      setTimeout(() => state.voices.delete(voice), (remaining + 1.2) * 1000);
    }, delay);
    state.timerIds.push(timer);
  });

  const remainingSong = Math.max(0, state.duration - offsetSeconds);
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
  const elapsed = Math.max(0, performance.now() / 1000 - state.startedAt);
  state.pausedAt = Math.min(state.duration, elapsed);
  clearPlayerTimers(state);
  const ctx = getPlaybackAudioContext();
  state.voices.forEach(voice => stopVoice(voice, ctx, 0.05));
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

  const sharedStartWall = performance.now() / 1000 - offsetSeconds;
  globalPlaybackState.startedAt = sharedStartWall;
  globalPlaybackState.duration = getAllTrackDuration();
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

function getAllPlainText() {

  return conversionResults
    .map(track =>
      `${track.name}\n` +
      track.plain
    )
    .join("\n\n");

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

    const blob =
      new Blob(
        [getAllPlainText()],
        {
          type:
            "text/plain;charset=utf-8"
        }
      );


    const url =
      URL.createObjectURL(blob);


    const link =
      document.createElement("a");

    link.href = url;

    link.download =
      ((midiFile && midiFile.name)
        ? midiFile.name.replace(/\.midi?$/i, "")
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

  /*
   * MIDI note for the LOW octave's C.
   * C3 = MIDI 48.
   */
  baseMidi: 48,

  /* Release time after a key is released, in seconds. */
  releaseSeconds: 1.20,

  audioContext: null,

  masterGain: null,

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


/*
 * Return the MIDI base for the selected octave.
 */
function getCurrentOctaveBase() {

  return piano.baseMidi +
    piano.octaveIndex[
      piano.currentOctave
    ] * 12;

}


/*
 * Convert semitone offset to an absolute MIDI note.
 */
function getPianoMidi(semitone) {

  return getCurrentOctaveBase() +
    semitone;

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


/*
 * Create the audio context only when the user interacts.
 *
 * This avoids browser autoplay restrictions.
 *
 * The piano uses a simple Web Audio synth.
 * No external audio file is needed.
 */
function getAudioContext() {

  if (!piano.audioContext) {

    const AudioContext =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContext) {
      return null;
    }

    piano.audioContext =
      new AudioContext();

    setupPianoAudioBus();

  }

  return piano.audioContext;

}


/*
 * Single master output for the piano.
 * Sustained/released sound is handled per-note rather than
 * through the master output.
 */
function setupPianoAudioBus() {

  const context =
    piano.audioContext;

  piano.masterGain =
    context.createGain();

  piano.masterGain.gain.value =
    0.78;

  piano.masterGain.connect(
    context.destination
  );

}


/*
 * Start one piano note.
 *
 * This is intentionally a simple synth voice. The note remains
 * active while the key is held and then fades out naturally.
 * Later we can replace it with sampled piano audio without
 * changing the keyboard logic.
 */
function startPianoNote(
  semitone,
  buttonElement
) {

  const midiNote =
    getPianoMidi(semitone);

  /*
   * Don't create duplicate voices if a keyboard key
   * repeats keydown events.
   */
  if (
    piano.activeNotes.has(
      midiNote
    )
  ) {
    return;
  }


  const context =
    getAudioContext();

  if (!context) {
    pianoElements.status.textContent =
      "Web Audio is not supported";
    return;
  }


  if (
    context.state === "suspended"
  ) {
    context.resume();
  }


  const oscillator =
    context.createOscillator();

  const gain =
    context.createGain();


  /*
   * Triangle wave gives a softer, more piano-like
   * electronic sound than a pure sine wave.
   */
  oscillator.type =
    "triangle";

  oscillator.frequency.value =
    midiToFrequency(midiNote);


  const now =
    context.currentTime;


  /*
   * Small attack followed by a gentle sustain level.
   * The important part is the release: when the user lets
   * go of the key, the note fades instead of cutting off.
   */
  gain.gain.setValueAtTime(
    0,
    now
  );

  gain.gain.linearRampToValueAtTime(
    0.20,
    now + 0.018
  );

  oscillator.connect(gain);

  gain.connect(
    piano.masterGain
  );

  oscillator.start(now);


  piano.activeNotes.set(
    midiNote,
    {
      oscillator,
      gain,
      button: buttonElement
    }
  );


  if (buttonElement) {
    buttonElement.classList.add(
      "active"
    );
  }


  const noteName =
    getPianoNoteLabel(
      semitone
    );


  pianoElements.status.textContent =
    `Playing ${noteName} · MIDI ${midiNote}`;
}


/*
 * Stop one piano note with a natural sustained release.
 * The note continues fading after the key is released.
 */
function stopPianoNote(
  semitone
) {

  const midiNote =
    getPianoMidi(semitone);

  const voice =
    piano.activeNotes.get(
      midiNote
    );

  if (!voice) {
    return;
  }


  const context =
    piano.audioContext;

  if (!context) {
    return;
  }


  const now =
    context.currentTime;


  /*
   * Avoid an audible click.
   */
  voice.gain.gain.cancelScheduledValues(
    now
  );

  voice.gain.gain.setValueAtTime(
    voice.gain.gain.value,
    now
  );

  voice.gain.gain.linearRampToValueAtTime(
    0,
    now + piano.releaseSeconds
  );


  voice.oscillator.stop(
    now + piano.releaseSeconds + 0.10
  );


  if (voice.button) {
    voice.button.classList.remove(
      "active"
    );
  }


  piano.activeNotes.delete(
    midiNote
  );

}


/*
 * Stop everything currently sounding.
 */
function stopAllPianoNotes() {

  for (
    const voice of
    piano.activeNotes.values()
  ) {

    try {

      const context =
        piano.audioContext;

      const now =
        context.currentTime;

      voice.gain.gain.cancelScheduledValues(
        now
      );

      voice.gain.gain.setValueAtTime(
        voice.gain.gain.value,
        now
      );

      voice.gain.gain.linearRampToValueAtTime(
        0,
        now + 0.35
      );

      voice.oscillator.stop(
        now + 0.40
      );

    }
    catch {
      /*
       * Voice may already have stopped.
       */
    }


    if (voice.button) {
      voice.button.classList.remove(
        "active"
      );
    }

  }

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
function changePianoOctave(
  direction
) {

  const current =
    piano.octaveIndex[
      piano.currentOctave
    ];

  const next =
    Math.max(
      0,
      Math.min(
        2,
        current + direction
      )
    );


  /*
   * Convert index back into the named octave.
   */
  const names = [
    "low",
    "mid",
    "high"
  ];


  piano.currentOctave =
    names[next];


  stopAllPianoNotes();

  updatePianoOctaveUI();

}


/*
 * Update octave label, button states and help text.
 */
function updatePianoOctaveUI() {

  const name =
    piano.octaveNames[
      piano.currentOctave
    ];


  const baseMidi =
    getCurrentOctaveBase();

  const lowC =
    baseMidi;

  const highC =
    baseMidi + 12;


  /*
   * MIDI octave number.
   */
  const lowOctave =
    Math.floor(lowC / 12) - 1;

  const highOctave =
    Math.floor(highC / 12) - 1;


  pianoElements.display.textContent =
    `OCTAVE: ${name}`;


  pianoElements.status.textContent =
    `Ready · C${lowOctave}–C${highOctave}`;


  pianoElements.octaveDown.disabled =
    piano.currentOctave === "low";

  pianoElements.octaveUp.disabled =
    piano.currentOctave === "high";

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
 * Build the piano immediately.
 */
renderPiano();

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
  transposeMode: document.getElementById("transposeMode"),

  convertButton: document.getElementById("convertButton"),

  errorMessage: document.getElementById("errorMessage"),
  status: document.getElementById("status"),

  channels: document.getElementById("channels"),

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
            transpose
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

    // Staying playable is far more important than removing one extra sharp.
    const score =
      outOfRange * 1000 +
      accidentals * 10 +
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


function convertTrack(
  track,
  index,
  beatGrid,
  transpose = 0
) {

  if (!track.notes.length) {
    return null;
  }

  const requestedGrid = Number(beatGrid);
  const ppq = Number(track.ppq) || 480;
  const notes = track.notes;

  /*
   * IMPORTANT RHYTHM RULE
   * ---------------------
   * Beat Grid is now a MINIMUM resolution, not a destructive
   * quantizer. If several notes occur inside one selected grid
   * cell, the converter automatically subdivides that cell so
   * those notes are not merged or lost.
   *
   * Example:
   *   Whole beat selected + C-D-E-F inside one beat
   *
   * Old behaviour:
   *   C/D/E/F     <- collisions / lost timing
   *
   * New behaviour:
   *   C D E F     <- adaptive subdivision
   *
   * We use MIDI ticks rather than seconds, so the result is
   * independent of tempo/BPM.
   */

  const subdivisionLevels = [
    1,
    0.5,
    0.25,
    0.125,
    0.0625
  ];

  /*
   * Convert Tone.js notes to tick-based events. Older versions
   * of @tonejs/midi expose ticks/durationTicks; if those are not
   * available, fall back to the time/duration values using the
   * MIDI PPQ and tempo.
   */
  const tempoBpm =
    Number(elements.tempo?.value) || 120;

  const secondsPerBeat =
    60 / tempoBpm;

  const toTicks = note => {
    if (Number.isFinite(note.ticks)) {
      return note.ticks;
    }

    return Math.round(
      (note.time / secondsPerBeat) * ppq
    );
  };

  const toDurationTicks = note => {
    if (Number.isFinite(note.durationTicks)) {
      return note.durationTicks;
    }

    return Math.max(
      1,
      Math.round(
        (note.duration / secondsPerBeat) * ppq
      )
    );
  };

  const events = notes.map(note => ({
    midi: note.midi + transpose,
    startTick: toTicks(note),
    durationTicks: toDurationTicks(note),
    endTick:
      toTicks(note) + toDurationTicks(note)
  })).sort((a, b) =>
    a.startTick - b.startTick ||
    a.midi - b.midi
  );

  const beatTicks = ppq;
  const requestedGridTicks =
    Math.max(1, Math.round(beatTicks * requestedGrid));

  const songEnd = Math.max(
    ...events.map(event => event.endTick)
  );

  /*
   * Find the smallest onset spacing that actually occurs inside
   * the MIDI. This tells us how much finer the requested grid
   * needs to become.
   */
  let minimumOnsetSpacing = Infinity;

  for (let i = 1; i < events.length; i++) {
    const previous = events[i - 1];
    const current = events[i];

    if (current.startTick > previous.startTick) {
      minimumOnsetSpacing = Math.min(
        minimumOnsetSpacing,
        current.startTick - previous.startTick
      );
    }
  }

  let effectiveGrid = requestedGrid;

  if (Number.isFinite(minimumOnsetSpacing)) {
    const minimumSpacingBeats =
      minimumOnsetSpacing / beatTicks;

    /*
     * Automatically descend through musical subdivisions until
     * one is fine enough to represent the fastest onset spacing.
     */
    for (const subdivision of subdivisionLevels) {
      if (
        subdivision <= requestedGrid &&
        subdivision <= minimumSpacingBeats + 1e-9
      ) {
        effectiveGrid = subdivision;
        break;
      }
    }
  }

  const gridTicks = Math.max(
    1,
    Math.round(beatTicks * effectiveGrid)
  );

  const totalSlots = Math.max(
    1,
    Math.ceil(songEnd / gridTicks)
  );

  const cells = Array.from(
    { length: totalSlots },
    () => []
  );

  /*
   * Put each note into its own onset cell. Notes beginning at
   * the same musical position remain together and therefore form
   * a chord. Different onset positions can never overwrite each
   * other anymore.
   */
  events.forEach(event => {
    const slot = Math.max(
      0,
      Math.min(
        totalSlots - 1,
        Math.round(event.startTick / gridTicks)
      )
    );

    cells[slot].push({
      midi: event.midi,
      duration:
        event.durationTicks / gridTicks
    });
  });

  const tokens = [];

  for (let slot = 0; slot < cells.length; slot++) {
    const cell = cells[slot];

    if (cell.length === 0) {
      tokens.push(
        effectiveGrid === 1 ? "━" : "-"
      );
      continue;
    }

    const uniqueNotes = [
      ...new Set(cell.map(note => note.midi))
    ].sort((a, b) => a - b);

    let token = uniqueNotes
      .map(noteToHtml)
      .join(
        '<span class="accidental">/</span>'
      );

    if (uniqueNotes.length > 1) {
      token =
        `<span class="chord">${token}</span>`;
    }

    /*
     * Duration markers are based on the actual MIDI duration,
     * rather than the selected grid. We only add a marker when
     * the duration crosses the corresponding musical threshold.
     */
    const durationBeats = Math.max(
      ...cell.map(note =>
        note.duration * effectiveGrid
      )
    );

    if (durationBeats >= 1.75) {
      token += "·.";
    }
    else if (durationBeats >= 1.5) {
      token += "·";
    }
    else if (durationBeats >= 1.25) {
      token += ".";
    }

    tokens.push(token);
  }

  /*
   * Group the adaptive slots back into musical beats.
   * A beat can now contain more tokens than the originally
   * selected Beat Grid if the MIDI requires it.
   */
  const slotsPerBeat = Math.max(
    1,
    Math.round(1 / effectiveGrid)
  );

  const beats = [];

  for (
    let beatStart = 0;
    beatStart < tokens.length;
    beatStart += slotsPerBeat
  ) {
    beats.push(
      tokens
        .slice(
          beatStart,
          beatStart + slotsPerBeat
        )
        .join("")
    );
  }

  const lines = [];

  for (
    let lineStart = 0;
    lineStart < beats.length;
    lineStart += 12
  ) {
    const lineBeats = beats.slice(
      lineStart,
      lineStart + 12
    );

    let line = "";

    lineBeats.forEach((beat, localBeatIndex) => {
      if (localBeatIndex > 0) {
        if (localBeatIndex % 4 === 0) {
          line += '<span class="bar"> | </span>';
        }
        else if (localBeatIndex % 2 === 0) {
          line += "  ";
        }
        else {
          line += " ";
        }
      }

      line += beat;
    });

    lines.push(line);
  }

  const html = lines.join("<br>");

  const channel =
    track.channel ?? index;

  return {
    index,
    channel,
    name:
      track.name ||
      DEFAULT_TRACK_NAMES[index] ||
      `Track ${index + 1}`,
    html,
    noteCount: notes.length,
    effectiveGrid,
    requestedGrid,
    transpose
  };
}


/* ============================================================
   8. OUTPUT RENDERING
   ============================================================ */

function renderChannels() {

  elements.channels.innerHTML =
    conversionResults
      .map(track => {

        return `
          <div class="channel">

            <div
              class="channel-meta"
              style="--channel-color: ${track.color}"
            >
              <div class="channel-name">
                Channel ${track.channel + 1}
              </div>

              <div class="channel-info">
                ${escapeHtml(track.name)}
                · ${track.noteCount} notes
              </div>
            </div>

            <div class="notation">${track.html}</div>

          </div>
        `;

      })
      .join("");

}


/* ============================================================
   9. EXPORT
   ============================================================ */

function getAllPlainText() {

  return conversionResults
    .map(track =>
      `CHANNEL ${track.channel + 1} — ${track.name}\n` +
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
      (
        midiFile?.name
          .replace(/\.midi?$/i, "") ||
        "gw2-notation"
      ) +
      ".txt";


    link.click();

    URL.revokeObjectURL(url);

  }
);


/* ============================================================
   10. UI HELPERS
   ============================================================ */

function showEmptyState() {

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

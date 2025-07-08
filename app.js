/* ========================================================================
   app.js – Gestion complète de l'application Séance
   Fonctionne avec n'importe quel fichier JSON respectant la structure :
   {
     "title": "…",
     "author": "…",
     "bodyAreas": "…",
     "estimatedTime": "…",
     "tours": 3,
     "exercises": [ { id, name, specs, duration, video, icon }, … ]
   }
   ========================================================================= */

/* ------------------------------------------------------------------ */
/* 0. Helpers                                                         */
/* ------------------------------------------------------------------ */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const clamp = (x, min, max) => Math.min(Math.max(x, min), max);
const pad2  = n => n.toString().padStart(2, "0");

/* ------------------------------------------------------------------ */
/* 1. Chargement de la séance                                         */
/* ------------------------------------------------------------------ */
const sessionUrl = document.documentElement.dataset.session || "session.json";
let   session;                    // données immuables
const state = {                   // état de l'UI (mutable)
  currentIndex   : 0,
  currentTour    : 1,
  completed      : new Set(),
  previewMode    : false,
  previewIndex   : 0,
  totalStart     : null,
  totalPaused    : 0,
  totalLastPause : null,
  isTotalPaused  : false,
  isTimerRunning : false,
  exerciseTimer  : null,
  restTimer      : null,
  restCallback   : null
};

init();

async function init () {
  try {
    session = await fetch(sessionUrl).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    });
  } catch (e) {
    document.body.innerHTML = `<pre style="color:#fff;padding:2rem;font-family:monospace">Erreur : impossible de charger \u201C${sessionUrl}\u201D\n${e}</pre>`;
    console.error(e);
    return;
  }
  document.title = session.title;
  renderStatic();
  renderExercise();
  state.totalStart = Date.now();
  setInterval(updateTotalTime, 1000);
  bindShortcuts();
}

/* ------------------------------------------------------------------ */
/* 2. Rendu statique (une seule fois)                                 */
/* ------------------------------------------------------------------ */
function renderStatic () {
  $("#app").innerHTML = `
<header class="header">
  <button class="back-btn" onclick="history.back()">←</button>
  <h1 class="workout-title">${session.title}</h1>
  <div class="workout-info">
    <div class="info-item"><div class="info-label">Type de travail</div><div class="info-value">${session.bodyAreas}</div></div>
    <div class="info-item"><div class="info-label">Durée estimée</div><div class="info-value">${session.estimatedTime}</div></div>
    <div class="info-item"><div class="info-label">Progression</div><div class="info-value"><span id="global-progress">0%</span></div></div>
  </div>
  <div class="keyboard-hints">
    <div class="hint"><kbd>ESPACE</kbd> Exercice suivant / chrono</div>
    <div class="hint"><kbd>← →</kbd> Navigation</div>
    <div class="hint"><kbd>V</kbd> Mode Aperçu</div>
    <div class="hint"><kbd>P</kbd> Pause chrono</div>
  </div>
</header>
<main class="main-container">
  <section class="timer-section">
    <div class="circular-timer">
      <svg class="timer-circle" viewBox="0 0 100 100">
        <circle class="timer-background" cx="50" cy="50" r="40"></circle>
        <circle class="timer-progress" cx="50" cy="50" r="40" stroke-dasharray="0 251.2" id="timerProgress"></circle>
      </svg>
      <div class="timer-content">
        <div class="exercise-counter">EXERCICES</div>
        <div class="exercise-progress" id="exerciseProgress">0/${totalExercises()}</div>
        <div class="timer-label">TEMPS RESTANT</div>
        <div class="timer-display" id="timerDisplay">00:00</div>
        <div class="total-time">TEMPS TOTAL <span id="totalTime">00:00</span>
          <div class="total-time-controls">
            <button class="time-control-btn" id="pauseTotalBtn">⏸️</button>
            <button class="time-control-btn" id="resetTotalBtn">🔄</button>
          </div>
        </div>
      </div>
    </div>
    <div class="timer-controls">
      <button class="control-btn" id="resetBtn">⟲</button>
      <button class="control-btn play" id="playBtn" style="display:none;">▶</button>
    </div>
    <div class="planche-info"><span>${session.author}</span><div class="info-circle">ⓘ</div></div>
    <div class="tour-indicator" id="tourIndicator"></div>
  </section>
  <section class="exercises-section">
    <div class="preview-mode-indicator" id="previewIndicator">🔍 Mode Aperçu</div>
    <div class="current-exercise" id="currentExercise"></div>
    <div class="exercise-navigation">
      <button class="nav-btn" id="prevBtn">◀ Précédent</button>
      <button class="nav-btn preview-btn" id="previewBtn">👁️ Aperçu</button>
      <button class="nav-btn" id="nextBtn">Suivant ▶</button>
    </div>
    <div class="upcoming-exercises"><div class="upcoming-title">Programme de la séance</div><div class="upcoming-list" id="exercisesList"></div></div>
  </section>
</main>
<div class="rest-overlay" id="restOverlay">
  <div class="rest-content"><div class="rest-title" id="restTitle">⏱️ Repos</div><div class="rest-timer" id="restTimer">00:30</div><div class="exercise-actions"><button class="action-btn btn-secondary" id="skipRestBtn">⏭️ Passer</button><button class="action-btn btn-primary" id="pauseRestBtn">⏸️ Pause</button></div></div>
</div>`;

  /* Listeners */
  $("#prevBtn").onclick        = () => navigate(-1);
  $("#nextBtn").onclick        = () => navigate(+1);
  $("#previewBtn").onclick     = togglePreview;
  $("#pauseTotalBtn").onclick  = toggleTotalTime;
  $("#resetTotalBtn").onclick  = resetTotalTime;
  $("#resetBtn").onclick       = resetTimer;
  $("#playBtn").onclick        = toggleTimer;
  $("#skipRestBtn").onclick    = skipRest;
}

/* ------------------------------------------------------------------ */
/* 3. Rendu dynamique                                                 */
/* ------------------------------------------------------------------ */
function renderExercise () {
  const index   = state.previewMode ? state.previewIndex : state.currentIndex;
  const exercise = session.exercises[index];
  if (!exercise) return;

  const c = $("#currentExercise");
  c.innerHTML = `
    <div class="exercise-header">
      <div class="exercise-icon">${exercise.icon}</div>
      <div class="exercise-details"><h3>${exercise.name}</h3><div class="exercise-specs">${exercise.specs}</div></div>
    </div>
    <div class="video-preview"><iframe src="https://www.youtube.com/embed/${exercise.video}?rel=0&modestbranding=1" allowfullscreen></iframe></div>
    <div class="exercise-actions">
      ${exercise.duration ? `<button class="action-btn btn-primary" id="startBtn">⏱️ ${exercise.duration}s</button>` : ""}
      <button class="action-btn btn-success" id="doneBtn">✓ Terminé</button>
    </div>`;

  $("#startBtn")?.addEventListener("click", () => startExerciseTimer(exercise.duration));
  $("#doneBtn").addEventListener("click", completeCurrentExercise);

  renderUpcoming();
  renderProgress();
  renderTours();
  updateNavButtons();
  resetTimer();
}

function renderUpcoming () {
  const list = $("#exercisesList");
  list.innerHTML = session.exercises.map((ex, i) => {
    const done = state.completed.has(`${state.currentTour}-${i}`);
    return `<div class="upcoming-item ${done ? "completed" : ""}"><div class="upcoming-number">${ex.icon}</div><div><div style="font-weight:600">${ex.name}</div><div style="opacity:.8;font-size:.9rem">${ex.specs}</div></div></div>`;
  }).join("");
}

function renderProgress () {
  const done = state.completed.size;
  const total= totalExercises();
  const pct  = Math.round((done/total)*100);
  $("#global-progress").textContent = `${pct}%`;
  $("#exerciseProgress").textContent= `${done}/${total}`;

  const circumference = 2 * Math.PI * 40;
  $("#timerProgress").style.strokeDasharray = `${(done/total)*circumference} ${circumference}`;
}

function renderTours () {
  const dots = [];
  for (let i=1;i<=session.tours;i++) {
    const cls = i < state.currentTour ? "tour-dot completed" : i === state.currentTour ? "tour-dot active" : "tour-dot";
    dots.push(`<div class="${cls}"></div>`);
  }
  $("#tourIndicator").innerHTML = `<div class="tour-info"><div class="tour-label">Tour <span>${state.currentTour}</span>/${session.tours}</div><div class="tour-dots">${dots.join("")}</div></div>`;
}

function updateNavButtons () {
  const idx = state.previewMode ? state.previewIndex : state.currentIndex;
  $("#prevBtn").disabled = idx === 0;
  $("#nextBtn").disabled = idx === session.exercises.length -1;
}

/* ------------------------------------------------------------------ */
/* 4. Navigation & mode aperçu                                        */
/* ------------------------------------------------------------------ */
function navigate (step) {
  if (state.previewMode) {
    state.previewIndex = clamp(state.previewIndex + step, 0, session.exercises.length-1);
  } else {
    state.currentIndex = clamp(state.currentIndex + step, 0, session.exercises.length-1);
  }
  renderExercise();
}

function togglePreview () {
  state.previewMode = !state.previewMode;
  if (state.previewMode) {
    state.previewIndex = state.currentIndex;
    $("#previewIndicator").style.display = "block";
    $("#previewBtn").classList.add("active");
    $("#previewBtn").textContent = "🏃 Reprendre";
    if (!state.isTotalPaused) toggleTotalTime();
  } else {
    $("#previewIndicator").style.display = "none";
    $("#previewBtn").classList.remove("active");
    $("#previewBtn").textContent = "👁️ Aperçu";
    if (state.isTotalPaused) toggleTotalTime();
  }
  renderExercise();
}

/* ------------------------------------------------------------------ */
/* 5. Complétion d'un exercice                                        */
/* ------------------------------------------------------------------ */
function completeCurrentExercise () {
  const key = `${state.currentTour}-${state.currentIndex}`;
  if (!state.completed.has(key)) state.completed.add(key);

  // Passage à l'exercice suivant
  if (state.currentIndex < session.exercises.length -1) {
    state.currentIndex++;
    renderExercise();
    return;
  }

  // Fin de la liste
  if (state.currentTour < session.tours) {
    showRest(60, `Fin du tour ${state.currentTour}`, () => {
      state.currentTour++;
      state.currentIndex = 0;
      renderExercise();
    });
  } else {
    workoutComplete();
  }
}

function workoutComplete () {
  alert("🎉 Séance terminée ! Bravo !");
  state.completed.clear();
  for (let t=1;t<=session.tours;t++)
    for (let i=0;i<session.exercises.length;i++)
      state.completed.add(`${t}-${i}`);
  renderProgress();
}

/* ------------------------------------------------------------------ */
/* 6. Timers                                                          */
/* ------------------------------------------------------------------ */
function startExerciseTimer (duration) {
  if (!duration) return;
  clearInterval(state.exerciseTimer);
  let timeLeft = duration;
  state.isTimerRunning = true;
  $("#playBtn").style.display = "inline-block";
  $("#playBtn").textContent  = "⏸️";

  const circumference = 2*Math.PI*40;
  const tick = () => {
    $("#timerDisplay").textContent = `${pad2(Math.floor(timeLeft/60))}:${pad2(timeLeft%60)}`;
    $("#timerProgress").style.strokeDasharray = `${((duration-timeLeft)/duration)*circumference} ${circumference}`;
    if (timeLeft-- <= 0) {
      clearInterval(state.exerciseTimer);
      state.isTimerRunning = false;
      $("#playBtn").textContent = "▶";
      $("#timerDisplay").textContent = "✅ Fini !";
    }
  };
  tick();
  state.exerciseTimer = setInterval(tick, 1000);
}

function toggleTimer () {
  if (state.isTimerRunning) {
    clearInterval(state.exerciseTimer);
    state.isTimerRunning = false;
    $("#playBtn").textContent = "▶";
  } else {
    const [mm,ss] = $("#timerDisplay").textContent.split(":").map(Number);
    const secs = mm*60+ss;
    if (secs>0) startExerciseTimer(secs);
  }
}

function resetTimer () {
  clearInterval(state.exerciseTimer);
  state.isTimerRunning = false;
  $("#timerDisplay").textContent = "00:00";
  $("#playBtn").textContent = "▶";
  $("#playBtn").style.display = "none";
  $("#timerProgress").style.strokeDasharray = "0 251.2";
}

/* ------------------------------------------------------------------ */
/* 7. Chrono global                                                   */
/* ------------------------------------------------------------------ */
function toggleTotalTime () {
  state.isTotalPaused = !state.isTotalPaused;
  if (state.isTotalPaused) {
    state.totalLastPause = Date.now();
    $("#pauseTotalBtn").textContent = "▶️";
  } else {
    state.totalPaused += Date.now() - state.totalLastPause;
    $("#pauseTotalBtn").textContent = "⏸️";
  }
}

function resetTotalTime () {
  state.totalStart   = Date.now();
  state.totalPaused  = 0;
  state.totalLastPause = null;
  if (state.isTotalPaused) toggleTotalTime();
}

function updateTotalTime () {
  if (!state.totalStart || state.isTotalPaused) return;
  const elapsed = Date.now() - state.totalStart - state.totalPaused;
  $("#totalTime").textContent = `${pad2(Math.floor(elapsed/60000))}:${pad2(Math.floor(elapsed/1000)%60)}`;
}

/* ------------------------------------------------------------------ */
/* 8. Repos entre les tours                                           */
/* ------------------------------------------------------------------ */
function showRest (duration, title, cb) {
  state.restCallback = cb;
  $("#restTitle").textContent = title;
  $("#restOverlay").style.display = "flex";
  $("#pauseRestBtn").textContent = "⏸️ Pause";

  let t = duration;
  const tick = () => {
    $("#restTimer").textContent = `${pad2(Math.floor(t/60))}:${pad2(t%60)}`;
    if (t-- <=0) {
      clearInterval(state.restTimer);
      $("#restOverlay").style.display = "none";
      cb && cb();
    }
  };
  tick();
  state.restTimer = setInterval(tick, 1000);

  $("#pauseRestBtn").onclick = () => {
    if (state.restTimer) {
      clearInterval(state.restTimer);
      state.restTimer = null;
      $("#pauseRestBtn").textContent = "▶️ Reprendre";
    } else {
      showRest(t+1, title, cb); // relance avec le temps restant
    }
  };
}

function skipRest () {
  clearInterval(state.restTimer);
  $("#restOverlay").style.display = "none";
  state.restCallback && state.restCallback();
}

/* ------------------------------------------------------------------ */
/* 9. Raccourcis clavier                                              */
/* ------------------------------------------------------------------ */
function bindShortcuts () {
  document.addEventListener("keydown", e => {
    if (e.code === "Space") {
      e.preventDefault();
      if ($("#restOverlay").style.display === "flex") return skipRest();
      const ex = session.exercises[state.currentIndex];
      if (state.previewMode) return; // rien en preview
      if (ex.duration && !state.isTimerRunning) return startExerciseTimer(ex.duration);
      completeCurrentExercise();
    }
    if (e.code === "ArrowLeft") { e.preventDefault(); navigate(-1); }
    if (e.code === "ArrowRight") { e.preventDefault(); navigate(+1); }
    if (e.code === "KeyV") { e.preventDefault(); togglePreview(); }
    if (e.code === "KeyP") { e.preventDefault(); if (session.exercises[state.currentIndex].duration) toggleTimer(); }
  });
}

/* ------------------------------------------------------------------ */
/* 10. Utilitaires                                                    */
/* ------------------------------------------------------------------ */
function totalExercises(){ return session.exercises.length * session.tours; }

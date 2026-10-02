/* ==========================================================================
   МОДУЛЬ: ТРАНСПОРТ ПРИЁМА (RX-МАШИНА)
   - состояние кнопок ПУСК/СТОП/СБРОС и возобновляемая передача радиограммы;
   - нормирование интервалов: напев / межбуквенная / межгрупповая пауза;
   - зачин/концовка, повторы групп и знаков, подсветка позиции приёма.
   Совместимость: только ES5 (Gecko 38), общий скоуп единого <script>.
   ========================================================================== */
var rxActiveGeneration = 0, targetRadiogram = "";

// ТРАНСПОРТ ПРИЁМА: состояние кнопок и возобновляемая передача радиограммы.
// rxRun переживает нажатие «СТОП», поэтому «ПРОДОЛЖИТЬ» продолжает ровно с места
// обрыва; rxRunId защищает от «хвостов» предыдущей цепочки промисов.
var RX_IDLE = 0, RX_PLAYING = 1, RX_PAUSED = 2;
var rxState = RX_IDLE, rxRunId = 0, rxRun = null;
var RX_STAGE_PRE = 0, RX_STAGE_PRE_PAUSE = 1, RX_STAGE_GROUP = 2,
    RX_STAGE_POST = 3, RX_STAGE_POST_PAUSE = 4, RX_STAGE_DONE = 5;
var RX_TECH_PAUSE_MS = 1200;   // технологическая пауза после зачина и после окончания

function sleepRx(ms) {
  var gen = rxActiveGeneration;
  return workerSleep(ms).then(function () {
    if (!rxActive || gen !== rxActiveGeneration) throw new Error("STOPPED");
  });
}

// Источник истины - НОРМИЗОВАННОЕ состояние (зн/мин + коэффициенты пауз), которое
// объявлено в app.js. Поля ввода блока «Скоростные нормативы» являются только
// представлением этого состояния в выбранных единицах (зн/мин либо длительность
// точки в мс), поэтому переключение тумблера единиц не влияет на звук.
function getLiveAtomTimings() {
  var charSpd = speedCharWpm;
  var farnSpd = Math.min(charSpd, speedFarnWpm);
  var grpMult = speedGrpMult;
  var dotMs = 6000.0 / charSpd;
  var farnDotMs = 6000.0 / farnSpd;
  return {
    dotMs: dotMs,
    dashMs: dotMs * 3,
    elemPauseMs: dotMs,
    charPauseMs: Math.max(0, farnDotMs * 3 - dotMs),
    groupPauseMs: Math.max(0, (farnDotMs * 7 * grpMult) - dotMs)
  };
}

// ОБЩАЯ СКОРОСТЬ ПЕРЕДАЧИ по реальному тексту радиограммы (зн/мин).
// Полная длительность считается той же моделью, что и rxNextAction(), поэтому
// цифра совпадает с фактическим временем передачи: тон каждого элемента +
// межэлементная пауза ПОСЛЕ КАЖДОГО элемента (включая последний) + межзнаковая
// пауза после каждого экземпляра знака (в т.ч. между повторами знака) +
// межгрупповая пауза после каждой группы, кроме последней (пауза после
// последней группы - это уже пауза перед окончанием). Зачин/окончание и
// технологические паузы в расчёт не входят: это служебные сигналы, а не текст.
function measureRadiogramSpeed() {
  var groups = getGroupsFromTable();
  if (!groups.length) return null;
  var t = getLiveAtomTimings();
  var repeats = parseInt(document.getElementById("groupRepeat").value, 10) || 1;
  var charRepeats = parseInt(document.getElementById("charRepeat").value, 10) || 1;
  var totalMs = 0, signs = 0;
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g];
    for (var rep = 0; rep < repeats; rep++) {
      for (var c = 0; c < grp.length; c++) {
        var code = MORSE_MAP[grp[c]];
        if (!code) {                       // неизвестный знак - одна межзнаковая пауза
          totalMs += t.charPauseMs;
          signs++;
          continue;
        }
        var oneSign = t.charPauseMs;
        for (var i = 0; i < code.length; i++) {
          oneSign += (code[i] === "." ? t.dotMs : t.dashMs) + t.elemPauseMs;
        }
        totalMs += oneSign * charRepeats;
        signs += charRepeats;
      }
      var isLastPass = (g === groups.length - 1 && rep === repeats - 1);
      if (!isLastPass) totalMs += t.groupPauseMs;
    }
  }
  if (totalMs <= 0) return null;
  return { wpm: Math.round(signs * 60000 / totalMs), durationMs: totalMs, signs: signs };
}

function updateOverallSpeed() {
  var el = document.getElementById("lblOverallSpeed");
  if (!el) return;
  var m = measureRadiogramSpeed();
  if (!m) { setUiText("lblOverallSpeed", "—"); return; }
  var mm = Math.floor(m.durationMs / 60000);
  var ss = Math.round((m.durationMs - mm * 60000) / 1000);
  setUiText("lblOverallSpeed", m.wpm + " зн/мин · " + mm + ":" + (ss < 10 ? "0" : "") + ss);
  if (el.title) el.title = "Знаков с повторами: " + m.signs +
    "; полная длительность передачи: " + (m.durationMs / 1000).toFixed(1) + " с";
}

function getStudyAtomTimings() {
  var charSpd = parseInt(document.getElementById("rngStudySpeed").value, 10) || 70;
  var dotMs = 6000.0 / charSpd;
  return {
    dotMs: dotMs,
    dashMs: dotMs * 3,
    elemPauseMs: dotMs
  };
}

// ВОСПРОИЗВЕДЕНИЕ ВСТУПЛЕНИЙ (ЗАЧИНОВ) И ОКОНЧАНИЙ (КОНЦОВОК)
var PREAMBLE_CODES = {
  "NONE": [],
  "SINGLE_V": ["...-"],
  "SERIES_VVV": ["...-", "...-", "...-"],
  "HST_VTO": ["...-", "-", "---"],
  "CALL_VVV_EQ": ["...-", "...-", "...-", "-...-"]
};

var POSTAMBLE_CODES = {
  "NONE": [],
  "SINGLE_K": ["-.-"],
  "SERIES_KKK": ["-.-", "-.-", "-.-"],
  "EQ_PERIOD": ["-...-"],
  "K_EQ": ["-.-", "-...-"],
  "AR": [".-.-."],
  "SK": ["...-.-"]
};

function getSignalItems(selId, codesByMode) {
  var el = document.getElementById(selId);
  var codes = el ? codesByMode[el.value] : null;
  return codes || [];
}

// ПЕРЕДАЧА РАДИОГРАММЫ, ПРИОСТАНАВЛИВАЕМАЯ С МЕСТА ОБРЫВА
// Шаг передачи = один тон или одна пауза. rxNextAction() только ВЫБИРАЕТ шаг,
// не двигая позицию; позиция применяется функцией commit() лишь после того, как
// сон шага действительно завершился. Поэтому при СТОП посреди тона или паузы
// состояние остаётся на этом шаге, и «ПРОДОЛЖИТЬ» проигрывает его заново целиком.
function rxNextAction() {
  var st = rxRun, t = getLiveAtomTimings();

  // --- служебные сигналы: зачин (0) и окончание (3) ---
  if (st.stage === RX_STAGE_PRE || st.stage === RX_STAGE_POST) {
    var codes = st.stage === RX_STAGE_PRE ? st.pre : st.post;
    if (st.ci >= codes.length) { st.stage++; return rxNextAction(); }
    var code = codes[st.ci];
    // межэлементная пауза внутри знака (после каждой точки/тире)
    if (st.el) {
      return { tone: false, dur: t.elemPauseMs, commit: function () { st.el = false; } };
    }
    if (st.si < code.length) {
      var si = st.si + 1;
      var sigDur = code[st.si] === "." ? t.dotMs : t.dashMs;
      return {
        tone: true, dur: sigDur,
        commit: function () { st.si = si; st.el = true; }
      };
    }
    // конец служебного знака — межзнаковая пауза
    var ci = st.ci + 1;
    return {
      tone: false, dur: t.charPauseMs,
      commit: function () { st.ci = ci; st.si = 0; }
    };
  }

  // --- технологическая пауза после зачина и после окончания ---
  if (st.stage === RX_STAGE_PRE_PAUSE || st.stage === RX_STAGE_POST_PAUSE) {
    var nextStage = st.stage + 1;
    // без зачина/окончания паузы нет — как и в прежней реализации
    if (st.stage === RX_STAGE_PRE_PAUSE ? st.pre.length === 0 : st.post.length === 0) {
      st.stage = nextStage;
      return rxNextAction();
    }
    return {
      tone: false, dur: RX_TECH_PAUSE_MS,
      commit: function () { st.stage = nextStage; }
    };
  }

  if (st.stage >= RX_STAGE_DONE) return null;

  // --- группы радиограммы ---
  if (st.g >= st.groups.length) {
    // переход к окончанию: счётчики служебных кодов стартуют заново
    st.stage = RX_STAGE_POST;
    st.ci = 0; st.si = 0; st.el = false;
    rxRefreshStatus();
    return rxNextAction();
  }

  var grp = st.groups[st.g];
  if (st.c === 0 && st.k === 0 && st.s === 0) {
    // вход в группу (или в её повтор). Идемпотентно: повтор при ПРОДОЛЖИТЬ не мешает
    highlightGroup(st.g);
    var cell = document.getElementById("grp-cell-" + st.g);
    if (cell) {
      var slots = cell.querySelectorAll(".char-slot");
      for (var i = 0; i < slots.length; i++) slots[i].className = "char-slot";
    }
    rxRefreshStatus();
  }

  if (st.c >= grp.length) {
    // группа отработана: пауза между группами, затем следующий повтор или группа
    var r = st.r + 1;
    var isLast = r >= st.repeats;
    return {
      tone: false, dur: t.groupPauseMs,
      commit: function () {
        st.r = isLast ? 0 : r;
        if (isLast) st.g++;
        st.c = 0; st.k = 0; st.s = 0; st.el = false;
      }
    };
  }

  var charCode = MORSE_MAP[grp[st.c]];
  if (!charCode) {
    // Неизвестный знак: одна межзнаковая пауза, повторения не применяются
    var c0 = st.c + 1;
    return {
      tone: false, dur: t.charPauseMs,
      commit: function () { st.c = c0; st.k = 0; st.s = 0; st.el = false; rxRefreshStatus(); }
    };
  }

  // межэлементная пауза внутри знака (после каждой точки/тире)
  if (st.el) {
    return { tone: false, dur: t.elemPauseMs, commit: function () { st.el = false; } };
  }

  if (st.k >= st.charRepeats) {
    // повторы знака исчерпаны — переход к следующему знаку группы
    releaseCharHighlight(st.g, st.c);
    var c1 = st.c + 1;
    st.c = c1; st.k = 0; st.s = 0; st.el = false;
    rxRefreshStatus();
    return rxNextAction();
  }

  if (st.s < charCode.length) {
    if (st.k === 0) highlightChar(st.g, st.c);
    var s0 = st.s + 1;
    var charDur = charCode[st.s] === "." ? t.dotMs : t.dashMs;
    return {
      tone: true, dur: charDur,
      commit: function () { st.s = s0; st.el = true; }
    };
  }

  // конец знака (или его повтора) — межзнаковая пауза и счётчик повторов
  return {
    tone: false, dur: t.charPauseMs,
    commit: function () { st.s = 0; st.k++; st.el = false; }
  };
}

function rxStep() {
  var plan = rxNextAction();
  if (!plan) return Promise.resolve();
  if (plan.tone) toneOn("RX");
  return sleepRx(plan.dur).then(function () {
    if (plan.tone) toneOff("RX");
    plan.commit();
    return rxStep();
  });
}

// Запуск/продолжение цепочки шагов. Отказ = «СТОП» во время шага.
function rxRunChain(runId) {
  rxStep().then(function () {
    if (runId === rxRunId) rxFinish();
  }, function () {
    if (runId === rxRunId && rxState !== RX_PAUSED) rxPause();
  });
}
// =================== ТРАНСПОРТ ПРИЁМА: ПУСК / СТОП / ПРОДОЛЖИТЬ ===================
function setRxStatus(text, isPaused) {
  var el = document.getElementById("rxStatus");
  if (!el) return;
  el.innerHTML = text || "";
  el.className = isPaused ? "rx-status paused" : "rx-status";
}

// Текущее место передачи для строки статуса
function rxPositionText(paused) {
  if (!rxRun) return "";
  if (rxRun.stage === RX_STAGE_PRE || rxRun.stage === RX_STAGE_PRE_PAUSE) return paused ? "ЗАЧИНА" : "ЗАЧИН";
  if (rxRun.stage === RX_STAGE_POST || rxRun.stage === RX_STAGE_POST_PAUSE) return paused ? "ОКОНЧАНИЯ" : "ОКОНЧАНИЕ";
  var idx = rxRun.g * rxRun.repeats + rxRun.r + 1;
  var total = rxRun.groups.length * rxRun.repeats;
  return (paused ? "ГРУППЫ " : "ГРУППА ") + idx + "/" + total + " · ЗНАК " + (rxRun.c + 1);
}

// Перерисовать строку статуса на текущем месте передачи. Вызывается при каждой
// смене знака и группы: раньше статус обновлялся только при входе в группу, и
// счётчик знаков висел на первом знаке группы до её конца.
function rxRefreshStatus() {
  if (rxState !== RX_PLAYING) return;
  setRxStatus("ИДЁТ ПРИЁМ: " + rxPositionText(false), false);
}

function setRxTransportUI(state) {
  var startBtn = document.getElementById("btnRxStart");
  var stopBtn = document.getElementById("btnRxStop");
  var isPaused = state === RX_PAUSED;
  stopBtn.className = "action-btn " + (isPaused ? "btn-resume" : "btn-stop");
  stopBtn.innerHTML = isPaused ? "▶ ПРОДОЛЖИТЬ" : "СТОП";
  stopBtn.disabled = (state === RX_IDLE);
  startBtn.innerHTML = isPaused ? "СБРОС" : "ПУСК ПРИЁМА";
  startBtn.className = "action-btn " + (isPaused ? "btn-reset" : "btn-start");
  startBtn.disabled = (state === RX_PLAYING);
}

// Пауза: обрываем текущий шаг, состояние передачи сохраняем, бланок остаётся
// замороженным, подсветка группы/знака остаётся — видно, где остановились.
function rxPause() {
  if (rxState !== RX_PLAYING) return;
  rxActive = false;
  rxActiveGeneration++;
  toneOff("RX");
  applyAudioParamsNow();
  rxState = RX_PAUSED;
  setRxTransportUI(RX_PAUSED);
  setRxStatus("ПАУЗА · ПРОДОЛЖИТЬ С " + rxPositionText(true) + " · [СБРОС]", true);
}

function rxResume() {
  if (rxState !== RX_PAUSED) return;
  initAudio();
  rxActive = true;
  rxActiveGeneration++;
  rxState = RX_PLAYING;
  applyAudioParamsNow();
  setRxTransportUI(RX_PLAYING);
  setRxStatus("ИДЁТ ПРИЁМ: " + rxPositionText(false), false);
  document.getElementById("txtUserInput").focus();
  if (rxRun && rxRun.stage === RX_STAGE_GROUP) highlightGroup(rxRun.g);
  rxRunChain(rxRunId);
}

function rxFinish() {
  rxActive = false;
  rxSessionOn = false;
  rxRun = null;
  rxState = RX_IDLE;
  toneOff("RX");
  applyAudioParamsNow();
  clearAllHighlights();
  setTrainerLocked(false);
  setRxTransportUI(RX_IDLE);
  setRxStatus("", false);
}

// «СБРОС»: остановить приём с паузы и разблокировать панель управления.
// Журнал оператора и подсветка сохраняются для проверки — полную очистку
// делает кнопка «Сброс бланка».
function rxReset() {
  if (rxState !== RX_PAUSED) return;
  rxActive = false;
  rxSessionOn = false;
  rxRun = null;
  rxState = RX_IDLE;
  rxActiveGeneration++;
  toneOff("RX");
  applyAudioParamsNow();
  setTrainerLocked(false);
  setRxTransportUI(RX_IDLE);
  setRxStatus("", false);
}

document.getElementById("btnRxStart").onclick = function () {
  if (rxState === RX_PLAYING) return;
  if (rxState === RX_PAUSED) { rxReset(); return; }
  if (!validateInputs()) return;
  var groups = getGroupsFromTable();
  if (groups.length === 0) return;

  var repeats = parseInt(document.getElementById("groupRepeat").value, 10) || 1;
  // Повтор знака — только акустический: эталон радиограммы остаётся без повторов
  var charRepeats = parseInt(document.getElementById("charRepeat").value, 10) || 1;
  var fullList = [];
  for (var i = 0; i < groups.length; i++) {
    for (var r = 0; r < repeats; r++) fullList.push(groups[i]);
  }
  targetRadiogram = fullList.join(" ");

  rxRunId++;
  rxRun = {
    groups: groups, repeats: repeats, charRepeats: charRepeats,
    pre: getSignalItems("selPreambleMode", PREAMBLE_CODES),
    post: getSignalItems("selPostambleMode", POSTAMBLE_CODES),
    stage: RX_STAGE_PRE, ci: 0, si: 0, g: 0, r: 0, c: 0, k: 0, s: 0, el: false
  };

  initAudio();
  rxActive = true;
  rxSessionOn = true;
  rxActiveGeneration++;
  rxState = RX_PLAYING;
  setTrainerLocked(true);
  applyAudioParamsNow();
  setRxTransportUI(RX_PLAYING);

  document.getElementById("diffBox").style.display = "none";
  setUiText("examReport", "");
  document.getElementById("txtUserInput").value = "";
  setRxStatus("ИДЁТ ПРИЁМ: " + rxPositionText(false), false);
  document.getElementById("txtUserInput").focus();

  rxRunChain(rxRunId);
};

document.getElementById("btnRxStop").onclick = function () {
  if (rxState === RX_PLAYING) rxPause();
  else if (rxState === RX_PAUSED) rxResume();
};

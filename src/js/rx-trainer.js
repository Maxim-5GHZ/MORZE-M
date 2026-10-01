/* ==========================================================================
   МОДУЛЬ: ПРИЁМ НА СЛУХ И КОНТРОЛЬ РАДИОГРАММ (RX)
   - блокировка/подсветка групп и знаков, режим "приём вслепую";
   - нормирование интервалов: напев / межбуквенная / межгрупповая пауза;
   - генерация и передача радиограмм (зачин, концовка, Фарнсворт, повторы);
   - валидация ввода, сетка групп 5 знаков, пресеты, выравнивание
     Нидлмана — Вунша (alignSequences) и выставление оценки.
   ========================================================================== */
function setTrainerLocked(isLocked) {
  var cells = document.querySelectorAll(".group-cell:not(.group-cell-add)");
  for (var i = 0; i < cells.length; i++) {
    var inp = cells[i].querySelector(".group-input-val");
    var disp = cells[i].querySelector(".group-chars-display");
    if (isLocked) {
      cells[i].className = cells[i].className.replace(/\blocked\b/g, "").trim() + " locked";
      if (inp) inp.style.display = "none";
      if (disp) {
        disp.style.display = "flex";
        disp.innerHTML = "";
        var cleanVal = cleanMorseChars(inp ? inp.value : "");
        for (var c = 0; c < cleanVal.length; c++) {
          var span = document.createElement("span");
          span.className = "char-slot";
          span.textContent = cleanVal[c];
          disp.appendChild(span);
        }
      }
    } else {
      cells[i].className = cells[i].className.replace(/\blocked\b/g, "").trim();
      if (inp) inp.style.display = "block";
      if (disp) disp.style.display = "none";
    }
  }

  var addCell = document.getElementById("cellAddGroup");
  if (addCell) addCell.style.display = isLocked ? "none" : "flex";

  document.getElementById("customCharset").disabled = isLocked;
  document.getElementById("accentCharset").disabled = isLocked;
  document.getElementById("groupLength").disabled = isLocked;
  document.getElementById("numGroups").disabled = isLocked;
  document.getElementById("groupRepeat").disabled = isLocked;
  document.getElementById("charRepeat").disabled = isLocked;
  document.getElementById("chkMonoOnly").disabled = isLocked;
  document.getElementById("selPreambleMode").disabled = isLocked;
  document.getElementById("selPostambleMode").disabled = isLocked;
  document.getElementById("btnGenGroups").disabled = isLocked;
  document.getElementById("monoCharInput").disabled = isLocked;
  document.getElementById("monoCharCount").disabled = isLocked;
  document.getElementById("btnInsertMono").disabled = isLocked;
  var impBtn = document.getElementById("btnOpenImport");
  if (impBtn) impBtn.disabled = isLocked;

  var badges = document.querySelectorAll(".preset-badge");
  for (var b = 0; b < badges.length; b++) {
    if (isLocked) badges[b].className += " disabled";
    else badges[b].className = badges[b].className.replace(/\bdisabled\b/g, "").trim();
  }
}

function highlightGroup(gIdx) {
  var cells = document.querySelectorAll(".group-cell:not(.group-cell-add)");
  for (var i = 0; i < cells.length; i++) {
    if (i === gIdx) {
      cells[i].className += " active-group";
      try { cells[i].scrollIntoView(true); } catch (e) {}
    } else {
      cells[i].className = cells[i].className.replace(/\bactive-group\b/g, "").trim();
    }
  }
}

function highlightChar(gIdx, cIdx) {
  var cell = document.getElementById("grp-cell-" + gIdx);
  if (!cell) return;
  var slots = cell.querySelectorAll(".char-slot");
  for (var i = 0; i < slots.length; i++) {
    if (i === cIdx) slots[i].className = "char-slot active-char";
    else if (i < cIdx) slots[i].className = "char-slot past-char";
    else slots[i].className = "char-slot";
  }
}

function releaseCharHighlight(gIdx, cIdx) {
  var cell = document.getElementById("grp-cell-" + gIdx);
  if (!cell) return;
  var slots = cell.querySelectorAll(".char-slot");
  if (slots[cIdx]) slots[cIdx].className = "char-slot past-char";
}

function clearAllHighlights() {
  var slots = document.querySelectorAll(".char-slot");
  for (var i = 0; i < slots.length; i++) slots[i].className = "char-slot";
  var cells = document.querySelectorAll(".group-cell");
  for (var j = 0; j < cells.length; j++) cells[j].className = cells[j].className.replace(/\bactive-group\b/g, "").trim();
}

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
function validateInputs() {
  var errBox = document.getElementById("teacherErrorBox");
  var startBtn = document.getElementById("btnRxStart");
  var accInput = document.getElementById("accentCharset");
  var targetLen = parseInt(document.getElementById("groupLength").value, 10) || 5;

  var rawChars = cleanMorseChars(document.getElementById("customCharset").value);
  var uniqueChars = [];
  for (var i = 0; i < rawChars.length; i++) {
    if (uniqueChars.indexOf(rawChars[i]) === -1) uniqueChars.push(rawChars[i]);
  }

  // Импортированному бланку набор знаков не нужен: движок приёма читает только
  // ячейки, поэтому пустой набор и его рассогласование с приоритетными знаками
  // ПУСК не блокируют. Для обычных бланков - строго как раньше.
  var skipCharsetChecks = blankIsImported && uniqueChars.length === 0;

  if (uniqueChars.length === 0 && !skipCharsetChecks) {
    errBox.style.display = "block";
    errBox.innerHTML = "ВНИМАНИЕ: Набор знаков пуст. Выберите профиль или введите символы.";
    startBtn.disabled = true;
    return false;
  }

  var rawAcc = cleanMorseChars(document.getElementById("accentCharset").value);
  var uniqueAcc = [];
  for (var j = 0; j < rawAcc.length; j++) {
    if (uniqueAcc.indexOf(rawAcc[j]) === -1) uniqueAcc.push(rawAcc[j]);
  }

  var invalidAccChars = [];
  for (var k = 0; k < uniqueAcc.length; k++) {
    if (uniqueChars.indexOf(uniqueAcc[k]) === -1) invalidAccChars.push(uniqueAcc[k]);
  }

  if (invalidAccChars.length > 0 && !skipCharsetChecks) {
    accInput.style.borderColor = "var(--mil-red)";
    errBox.style.display = "block";
    errBox.innerHTML = "НЕСООТВЕТСТВИЕ: Знаков [ <b>" + invalidAccChars.join(", ") + "</b> ] нет в основном наборе.";
    startBtn.disabled = true;
    return false;
  } else {
    accInput.style.borderColor = "#33422d";
  }

  var groupInputs = document.querySelectorAll(".group-input-val");
  if (groupInputs.length === 0) {
    errBox.style.display = "none";
    startBtn.disabled = true;
    return false;
  }

  // Импортированный бланк (слова, хвост без добивки) законно содержит группы
  // короче «Размера группы» - для него проверяем только непустоту ячеек.
  var emptyGroupFound = false, brokenIndex = -1;
  for (var g = 0; g < groupInputs.length; g++) {
    var cell = findAncestor(groupInputs[g], "group-cell");
    var val = cleanMorseChars(groupInputs[g].value);
    var badCell = blankIsImported ? (val.length === 0) : (val.length < targetLen);
    if (badCell) {
      emptyGroupFound = true;
      if (brokenIndex === -1) brokenIndex = g + 1;
      if (cell) cell.className += " cell-error";
    } else {
      if (cell) cell.className = cell.className.replace(/\bcell-error\b/g, "").trim();
    }
  }

  if (emptyGroupFound) {
    errBox.style.display = "block";
    errBox.innerHTML = blankIsImported
      ? "НАРУШЕНИЕ СТРУКТУРЫ: Группа №" + brokenIndex + " пуста."
      : "НАРУШЕНИЕ СТРУКТУРЫ: Группа №" + brokenIndex + " содержит менее " + targetLen + " знаков.";
    startBtn.disabled = true;
    return false;
  }

  errBox.style.display = "none";
  if (!rxSessionOn) startBtn.disabled = false;
  return true;
}

// Признак импортированного бланка (загрузка текста через пульт импорта).
// Для такого бланка валидация мягкая: группы проверяются только на непустоту,
// набор знаков не требуется (движку приёма он не нужен - читаются только
// ячейки). Сбрасывается при перегенерации/очистке, ручной ввод его не трогает.
var blankIsImported = false;
var groupsHidden = false;
function toggleHideGroups() {
  groupsHidden = !groupsHidden;
  var container = document.getElementById("groupsContainer");
  var lbl = document.getElementById("lblHideGroups");
  if (groupsHidden) {
    container.style.opacity = "0.05";
    setUiText(lbl, "Показать радиограмму");
  } else {
    container.style.opacity = "1";
    setUiText(lbl, "Скрыть от оператора");
  }
}

function attachGroupInputEvents(inp, gIdx) {
  attachShortZeroHandler(inp); // Подключение ввода короткого нуля 0 + -

  inp.oninput = function () {
    this.value = cleanMorseChars(this.value);
    validateInputs();
    updateOverallSpeed();
  };

  inp.onkeydown = function (e) {
    var grpLen = parseInt(document.getElementById("groupLength").value, 10) || 5;
    var kc = e.keyCode || e.which;

    if (kc === 13 || kc === 32) {
      if (e.preventDefault) e.preventDefault();
      var val = cleanMorseChars(this.value);
      if (val.length === 1) {
        ensureCharInCharset(val);
        var full = "";
        for (var i = 0; i < grpLen; i++) full += val;
        this.value = full;
      }
      validateInputs();

      var allInputs = document.querySelectorAll(".group-input-val");
      var currentIndex = -1;
      for (var k = 0; k < allInputs.length; k++) {
        if (allInputs[k] === this) { currentIndex = k; break; }
      }

      if (currentIndex > -1 && currentIndex < allInputs.length - 1) {
        allInputs[currentIndex + 1].focus();
        allInputs[currentIndex + 1].select();
      } else if (currentIndex === allInputs.length - 1) {
        if (allInputs.length < 100) addNewEmptyGroup();
      }
    }

    if (kc === 8 && this.value === "") {
      var inputs = document.querySelectorAll(".group-input-val");
      if (inputs.length > 1) {
        if (e.preventDefault) e.preventDefault();
        var prevIdx = -1;
        for (var p = 0; p < inputs.length; p++) {
          if (inputs[p] === this) { prevIdx = p - 1; break; }
        }
        var cell = findAncestor(this, "group-cell");
        if (cell && cell.parentNode) cell.parentNode.removeChild(cell);
        reindexCells();
        var updatedInputs = document.querySelectorAll(".group-input-val");
        document.getElementById("numGroups").value = updatedInputs.length;
        if (prevIdx >= 0 && updatedInputs[prevIdx]) updatedInputs[prevIdx].focus();
        validateInputs();
      }
    }
  };
}

function reindexCells() {
  var cells = document.querySelectorAll(".group-cell:not(.group-cell-add)");
  for (var i = 0; i < cells.length; i++) {
    cells[i].id = "grp-cell-" + i;
    var idxLabel = cells[i].querySelector(".group-cell-idx");
    if (idxLabel) idxLabel.textContent = "№" + (i + 1);
  }
}

function renderGroupsFromList(groupsList) {
  var container = document.getElementById("groupsContainer");
  container.innerHTML = "";
  var grpLen = parseInt(document.getElementById("groupLength").value, 10) || 5;

  for (var g = 0; g < groupsList.length; g++) {
    var cell = document.createElement("div");
    cell.className = "group-cell";
    cell.id = "grp-cell-" + g;
    cell.innerHTML =
      '<span class="group-cell-idx">№' + (g + 1) + "</span>" +
      '<input type="text" class="group-input-val" value="' + groupsList[g] + '" maxlength="' + grpLen + '">' +
      '<div class="group-chars-display"></div>';
    var inp = cell.querySelector(".group-input-val");
    attachGroupInputEvents(inp, g);
    container.appendChild(cell);
  }

  var addBtn = document.createElement("div");
  addBtn.className = "group-cell group-cell-add";
  addBtn.id = "cellAddGroup";
  addBtn.title = "Добавить новую группу";
  addBtn.onclick = addNewEmptyGroup;
  addBtn.innerHTML = '<span class="add-icon">+</span><span class="add-text">НОВАЯ</span>';
  container.appendChild(addBtn);
  updateOverallSpeed();
}

function addNewEmptyGroup() {
  if (rxSessionOn) return;
  var currentGroups = getGroupsFromTable();
  if (currentGroups.length >= 100) {
    alert("ПРЕВЫШЕН ЛИМИТ: Максимальное число групп — 100.");
    return;
  }
  currentGroups.push("");
  document.getElementById("numGroups").value = currentGroups.length;
  renderGroupsFromList(currentGroups);
  validateInputs();
  var inputs = document.querySelectorAll(".group-input-val");
  if (inputs.length > 0) inputs[inputs.length - 1].focus();
}

function insertMonoGroupFromPanel() {
  if (rxSessionOn) return;
  var input = document.getElementById("monoCharInput");
  var countSel = document.getElementById("monoCharCount");
  var ch = cleanMorseChars(input.value);

  if (!ch || ch.length === 0) { input.focus(); return; }

  var count = parseInt(countSel.value, 10) || 1;
  var grpLen = parseInt(document.getElementById("groupLength").value, 10) || 5;
  var currentGroups = getGroupsFromTable();

  if (currentGroups.length + count > 100) {
    alert("ПРЕВЫШЕН ЛИМИТ: Максимальное число групп — 100 (сейчас: " + currentGroups.length + ").");
    return;
  }

  ensureCharInCharset(ch);

  var monoStr = "";
  for (var i = 0; i < grpLen; i++) monoStr += ch;
  for (var k = 0; k < count; k++) currentGroups.push(monoStr);

  document.getElementById("numGroups").value = currentGroups.length;
  renderGroupsFromList(currentGroups);
  validateInputs();

  input.value = "";
  input.focus();
  var container = document.getElementById("groupsContainer");
  container.scrollTop = container.scrollHeight;
}

/* ==========================================================================
   МОДУЛЬ ЗАГРУЗКИ ТЕКСТА В БЛАНК (ПКМ ПО БЛАНКУ / КНОПКА «ЗАГРУЗИТЬ»)
   - контекстное меню бланка: загрузка из буфера, копирование, очистка;
   - модальный пульт импорта: чтение буфера (navigator.clipboard с откатом
     на ручную вставку Ctrl+V для старых Gecko), морзе-транслит латиницы,
     нарезка на группы, превью, синхронизация набора знаков.
   Совместимость: только ES5 (Gecko 43), без Promise/async в основном пути.
   ========================================================================== */

// Морзе-транслит латиницы в кириллицу ПО КОДУ: латинская буква заменяется той
// русской буквой, чей код Морзе совпадает (CQ -> ЦЩ, QSO -> ЩСО, V -> Ж).
// X (-..-) в базе первым записан как Ъ - держим то же соответствие, что и
// обратный словарь REVERSE_MORSE. Цифры и знаки = / ? , . общие, не трогаем.
var IMPORT_LAT2CYR = {
  A: "А", B: "Б", C: "Ц", D: "Д", E: "Е", F: "Ф", G: "Г", H: "Х",
  I: "И", J: "Й", K: "К", L: "Л", M: "М", N: "Н", O: "О", P: "П",
  Q: "Щ", R: "Р", S: "С", T: "Т", U: "У", V: "Ж", W: "В", X: "Ъ",
  Y: "Ы", Z: "З"
};

var IMPORT_MAX_GROUPS = 100;

// Нормализация сырого текста: верхний регистр, Ё -> Е, короткий ноль 0-/-0
// -> Ø (та же конвенция, что и ручной ввод), морзе-транслит, чистка мусора.
function importTranslitLatin(s) {
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    out += IMPORT_LAT2CYR[ch] || ch;
  }
  return out;
}

// Сплошной поток знаков без пробелов (режим «строго по N»).
function importNormalizeStream(raw) {
  if (!raw) return "";
  var s = ("" + raw).toUpperCase().replace(/Ё/g, "Е");
  s = s.replace(/0-|-0/g, "Ø");
  s = importTranslitLatin(s);
  return cleanMorseChars(s);
}

// Слова для режима «по словам»: пробелы/переносы - разделители групп.
function importSplitWords(raw) {
  if (!raw) return [];
  var s = ("" + raw).toUpperCase().replace(/Ё/g, "Е");
  s = s.replace(/0-|-0/g, "Ø");
  s = importTranslitLatin(s);
  s = s.replace(/[^A-ZА-Я0-9Ø=\/?,\.\s]/gi, " ");
  var parts = s.split(/\s+/);
  var words = [];
  for (var i = 0; i < parts.length; i++) {
    var w = cleanMorseChars(parts[i]);
    if (w) words.push(w);
  }
  return words;
}

function importGetGroupLen() {
  var el = document.getElementById("importGroupLen");
  var n = el ? (parseInt(el.value, 10) || 5) : 5;
  if (n < 2) n = 2;
  if (n > 5) n = 5;
  return n;
}

function importPadGroup(g, n) {
  while (g.length < n) g += "=";
  return g;
}

// Нарезка групп по текущим настройкам пульта. Возвращает
// { groups: [...], truncated: bool, totalChars: N }.
function importSliceGroups() {
  var res = { groups: [], truncated: false, totalChars: 0 };
  var ta = document.getElementById("importText");
  var raw = ta ? ta.value : "";
  var n = importGetGroupLen();
  var strict = true;
  var modeW = document.getElementById("importModeWords");
  if (modeW && modeW.checked) strict = false;
  var padEl = document.getElementById("importPadEq");
  var pad = !padEl || padEl.checked;

  if (strict) {
    var stream = importNormalizeStream(raw);
    res.totalChars = stream.length;
    for (var i = 0; i < stream.length; i += n) {
      var chunk = stream.substr(i, n);
      if (chunk.length < n && pad) chunk = importPadGroup(chunk, n);
      res.groups.push(chunk);
    }
  } else {
    var words = importSplitWords(raw);
    var chars = 0;
    for (var w = 0; w < words.length; w++) {
      var word = words[w];
      chars += word.length;
      if (word.length <= n) {
        res.groups.push(word.length < n && pad ? importPadGroup(word, n) : word);
      } else {
        // Слово длиннее группы: режем на куски по N (maxlength ячейки
        // программно заданное значение не обрезает, но структура ломается).
        for (var k = 0; k < word.length; k += n) {
          var part = word.substr(k, n);
          if (part.length < n && pad) part = importPadGroup(part, n);
          res.groups.push(part);
        }
      }
    }
    res.totalChars = chars;
  }

  if (res.groups.length > IMPORT_MAX_GROUPS) {
    res.groups = res.groups.slice(0, IMPORT_MAX_GROUPS);
    res.truncated = true;
  }
  return res;
}

function importSetHint(text, cls) {
  var hint = document.getElementById("importHint");
  if (!hint) return;
  if (text !== undefined && text !== null) hint.textContent = text;
  hint.className = "import-hint" + (cls ? " " + cls : "");
}

// Живое превью + счётчик. Вызывается из разметки (oninput/onchange).
function refreshImportPreview() {
  var counter = document.getElementById("importCounter");
  var prev = document.getElementById("importPreview");
  var applyBtn = document.getElementById("btnApplyImport");
  if (!counter || !prev) return;
  var r = importSliceGroups();
  var t = "ЗНАКОВ: " + r.totalChars + " · ГРУПП: " + r.groups.length + " / " + IMPORT_MAX_GROUPS;
  if (r.truncated) t += " · ЛИШНЕЕ ОТСЕЧЕНО";
  // Заранее показываем, что часть групп короче «Размера группы» (слова без
  // добивки, короткий хвост): после применения такие группы пройдут мягкую
  // проверку импортированного бланка, но для uniform-тренировки лучше добивка.
  var gl = document.getElementById("groupLength");
  var needLen = gl ? (parseInt(gl.value, 10) || 5) : 5;
  var shortCount = 0;
  for (var si = 0; si < r.groups.length; si++) {
    if (r.groups[si].length < needLen) shortCount++;
  }
  if (shortCount > 0) t += " · КОРОТКИХ ГРУПП: " + shortCount + " (меньше " + needLen + ")";
  counter.textContent = t;
  counter.className = "import-counter" + ((r.truncated || shortCount > 0) ? " over" : "");
  if (!r.groups.length) {
    prev.innerHTML = '<span class="import-empty">Нет пригодных знаков: вставьте текст или считайте буфер обмена.</span>';
  } else {
    prev.textContent = r.groups.join(" ");
  }
  if (applyBtn) applyBtn.disabled = !r.groups.length;
}

function openTextImport() {
  if (typeof rxSessionOn !== "undefined" && rxSessionOn) return;
  hideGroupsCtxMenu();
  var ov = document.getElementById("importOverlay");
  if (!ov) return;
  // N по умолчанию - из текущего «Размера группы», чтобы импорт сразу
  // проходил проверку структуры бланка.
  var gl = document.getElementById("groupLength");
  var imp = document.getElementById("importGroupLen");
  if (gl && imp) imp.value = gl.value;
  ov.style.display = "block";
  refreshImportPreview();
  // Пробуем сразу подтянуть буфер; при отказе - фокус для ручной вставки.
  if (!readClipboardIntoImport(true)) {
    var ta = document.getElementById("importText");
    if (ta) ta.focus();
  }
}

function closeTextImport() {
  var ov = document.getElementById("importOverlay");
  if (ov) ov.style.display = "none";
}

// Чтение буфера обмена в поле пульта. Возвращает true, если попытка чтения
// запущена (результат придёт асинхронно), иначе false - тогда вызывающий
// код сам ставит фокус для ручной вставки Ctrl+V.
function readClipboardIntoImport(silent) {
  if (typeof rxSessionOn !== "undefined" && rxSessionOn) return false;
  var ta = document.getElementById("importText");
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard &&
        typeof navigator.clipboard.readText === "function" &&
        typeof Promise !== "undefined") {
      importSetHint("Чтение буфера обмена…");
      navigator.clipboard.readText().then(function (text) {
        if (ta) { ta.value = text || ""; refreshImportPreview(); ta.focus(); }
        importSetHint(text ? "Буфер обмена считан, проверьте превью." : "Буфер обмена пуст: вставьте текст вручную через Ctrl+V.", text ? "ok" : "warn");
      }, function () {
        importSetHint("Доступ к буферу запрещён: вставьте текст вручную через Ctrl+V.", "warn");
        if (ta) ta.focus();
      });
      return true;
    }
  } catch (e) {}
  // Старого Gecko без Clipboard API: только ручная вставка.
  if (!silent) {
    importSetHint("Ваш браузер не отдаёт буфер скриптам: вставьте текст вручную через Ctrl+V.", "warn");
    if (ta) ta.focus();
  }
  return false;
}

function applyTextImport() {
  if (typeof rxSessionOn !== "undefined" && rxSessionOn) return;
  var r = importSliceGroups();
  if (!r.groups.length) return;
  var strict = true;
  var modeW = document.getElementById("importModeWords");
  if (modeW && modeW.checked) strict = false;
  if (strict) {
    // В строгом режиме N становится «Размером группы» - тогда импортированный
    // бланк гарантированно проходит проверку структуры.
    var gl = document.getElementById("groupLength");
    if (gl) gl.value = String(importGetGroupLen());
  }
  // Синхронизация алфавита тренажёра: новые знаки - в «Набор знаков»,
  // иначе генератор и валидатор будут ругаться на чужие символы.
  var sync = document.getElementById("importSyncCharset");
  if (!sync || sync.checked) {
    var seen = {};
    for (var i = 0; i < r.groups.length; i++) {
      var g = r.groups[i];
      for (var k = 0; k < g.length; k++) {
        if (!seen[g.charAt(k)]) { seen[g.charAt(k)] = 1; ensureCharInCharset(g.charAt(k)); }
      }
    }
  }
  renderGroupsFromList(r.groups);
  document.getElementById("numGroups").value = r.groups.length;
  blankIsImported = true;
  closeTextImport();
  validateInputs();
  var container = document.getElementById("groupsContainer");
  if (container) container.scrollTop = 0;
}

/* ---------- Контекстное меню бланка (ПКМ) ---------- */

function hideGroupsCtxMenu() {
  var m = document.getElementById("groupsCtxMenu");
  if (m) m.style.display = "none";
}

function showGroupsCtxMenu(x, y) {
  var m = document.getElementById("groupsCtxMenu");
  if (!m) return;
  m.style.display = "block";
  m.style.left = "0px";
  m.style.top = "0px";
  var w = m.offsetWidth || 240, h = m.offsetHeight || 120;
  var vw = window.innerWidth || document.documentElement.clientWidth || 800;
  var vh = window.innerHeight || document.documentElement.clientHeight || 600;
  if (x + w > vw - 4) x = vw - w - 4;
  if (y + h > vh - 4) y = vh - h - 4;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  m.style.left = x + "px";
  m.style.top = y + "px";
}

// Копирование бланка: современный Clipboard API, откат на execCommand('copy')
// для старых Gecko (там копирование работает по жесту пользователя - клик по
// пункту меню подходит).
function legacyCopyText(text) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0px";
  document.body.appendChild(ta);
  var done = false;
  try {
    ta.focus();
    ta.select();
    if (typeof ta.setSelectionRange === "function") ta.setSelectionRange(0, ta.value.length);
    done = document.execCommand("copy");
  } catch (e) { done = false; }
  if (ta.parentNode) ta.parentNode.removeChild(ta);
  return !!done;
}

function copyRadiogramToClipboard() {
  hideGroupsCtxMenu();
  if (typeof rxSessionOn !== "undefined" && rxSessionOn) return;
  var list = getGroupsFromTable();
  var kept = [];
  for (var i = 0; i < list.length; i++) if (list[i]) kept.push(list[i]);
  if (!kept.length) { alert("БЛАНК ПУСТ: копировать нечего."); return; }
  var text = kept.join(" ");
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function" &&
        typeof Promise !== "undefined") {
      navigator.clipboard.writeText(text).then(function () {
        alert("РАДИОГРАММА СКОПИРОВАНА: групп " + kept.length + ".");
      }, function () {
        if (legacyCopyText(text)) alert("РАДИОГРАММА СКОПИРОВАНА: групп " + kept.length + ".");
        else alert("НЕ УДАЛОСЬ СКОПИРОВАТЬ: буфер недоступен.");
      });
      return;
    }
  } catch (e) {}
  if (legacyCopyText(text)) alert("РАДИОГРАММА СКОПИРОВАНА: групп " + kept.length + ".");
  else alert("НЕ УДАЛОСЬ СКОПИРОВАТЬ: буфер недоступен.");
}

function clearBlankGroups() {
  hideGroupsCtxMenu();
  if (typeof rxSessionOn !== "undefined" && rxSessionOn) return;
  renderGroupsFromList([]);
  document.getElementById("numGroups").value = 0;
  blankIsImported = false;
  validateInputs();
}

function initTextImport() {
  var container = document.getElementById("groupsContainer");
  if (container && !container.__ctxBound) {
    container.__ctxBound = true;
    // Gecko 43 понимает addEventListener("contextmenu") - подавляем родное
    // меню только над бланком, остальной странице не мешаем.
    if (container.addEventListener) {
      container.addEventListener("contextmenu", function (e) {
        if (typeof rxSessionOn !== "undefined" && rxSessionOn) return;
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        var x = (typeof e.clientX === "number") ? e.clientX : 0;
        var y = (typeof e.clientY === "number") ? e.clientY : 0;
        // Не даём DnD увидеть правую кнопку как начало перетаскивания:
        // DnD слушает только ЛКМ (e.button !== 0 - выход), так что тихо.
        showGroupsCtxMenu(x, y);
        return false;
      }, false);
    } else if (container.attachEvent) {
      container.attachEvent("oncontextmenu", function () { return false; });
    }
  }
  if (!document.__ctxGlobalBound) {
    document.__ctxGlobalBound = true;
    document.addEventListener("click", function (e) {
      var m = document.getElementById("groupsCtxMenu");
      if (!m || m.style.display === "none") return;
      var el = e.target;
      while (el) { if (el === m) return; el = el.parentNode; }
      hideGroupsCtxMenu();
    }, false);
    document.addEventListener("keydown", function (e) {
      var kc = e.keyCode || e.which;
      if (kc === 27) {
        hideGroupsCtxMenu();
        var ov = document.getElementById("importOverlay");
        if (ov && ov.style.display !== "none") closeTextImport();
      }
    }, false);
    var ov0 = document.getElementById("importOverlay");
    if (ov0) {
      ov0.addEventListener("mousedown", function (e) {
        if (e.target === ov0) closeTextImport();
      }, false);
    }
    // В старых браузерах значение в поле появляется ПОСЛЕ события paste -
    // обновляем превью с небольшой задержкой.
    var ta0 = document.getElementById("importText");
    if (ta0) {
      var refreshSoon = function () { setTimeout(refreshImportPreview, 30); };
      if (ta0.addEventListener) ta0.addEventListener("paste", refreshSoon, false);
    }
  }
}

function uiGenerateGroupsTable() {
  if (rxSessionOn) return;
  blankIsImported = false;
  var container = document.getElementById("groupsContainer");
  var numStr = ("" + document.getElementById("numGroups").value).trim();
  if (numStr === "") { container.innerHTML = ""; validateInputs(); return; }

  var grpCount = parseInt(numStr, 10);
  if (isNaN(grpCount) || grpCount < 0) { container.innerHTML = ""; validateInputs(); return; }
  if (grpCount === 0) {
    container.innerHTML = '<div style="padding:15px;color:var(--mil-dim);font-size:11px;width:100%;text-align:center">БЛАНК РАДИОГРАММЫ ПУСТ (ЧИСЛО ГРУПП: 0)</div>';
    validateInputs();
    return;
  }
  if (grpCount > 100) { container.innerHTML = ""; validateInputs(); return; }

  var raw = cleanMorseChars(document.getElementById("customCharset").value);
  var uniqueChars = [];
  for (var i = 0; i < raw.length; i++) {
    if (uniqueChars.indexOf(raw[i]) === -1) uniqueChars.push(raw[i]);
  }
  if (!uniqueChars.length) { container.innerHTML = ""; validateInputs(); return; }

  var rawAcc = cleanMorseChars(document.getElementById("accentCharset").value);
  var uniqueAcc = [];
  for (var j = 0; j < rawAcc.length; j++) {
    if (uniqueAcc.indexOf(rawAcc[j]) === -1) uniqueAcc.push(rawAcc[j]);
  }
  var validAccents = [];
  for (var k = 0; k < uniqueAcc.length; k++) {
    if (uniqueChars.indexOf(uniqueAcc[k]) !== -1) validAccents.push(uniqueAcc[k]);
  }

  var pool = [];
  for (var u = 0; u < uniqueChars.length; u++) {
    var ch = uniqueChars[u];
    var weight = validAccents.indexOf(ch) !== -1 ? 3 : 1;
    for (var w = 0; w < weight; w++) pool.push(ch);
  }

  var grpLen = parseInt(document.getElementById("groupLength").value, 10) || 5;
  var monoOnly = document.getElementById("chkMonoOnly");
  var wantMono = !!(monoOnly && monoOnly.checked);
  var generatedList = [];

  if (wantMono) {
    // МОНОГРУППЫ: в каждой группе все знаки одинаковые (напр. ЖЖЖЖЖ).
    // Символ выбирается случайно из того же взвешенного пула, что и обычная
    // генерация, поэтому приоритетные знаки («Знаки приоритетной отработки»)
    // сохраняются. Не допускаем больше двух одинаковых моногрупп подряд,
    // иначе весь бланк может оказаться одним знаком.
    var prevMono = "", sameStreak = 0;
    for (var mg = 0; mg < grpCount; mg++) {
      var monoCh, monoTries = 0;
      do {
        monoCh = pool[Math.floor(Math.random() * pool.length)];
        monoTries++;
      } while (monoCh === prevMono && sameStreak >= 2 && monoTries < 15);
      if (monoCh === prevMono) sameStreak++;
      else { prevMono = monoCh; sameStreak = 1; }
      var monoGrp = "";
      for (var mc = 0; mc < grpLen; mc++) monoGrp += monoCh;
      generatedList.push(monoGrp);
    }
  } else {
    for (var g = 0; g < grpCount; g++) {
      var grp = "", lastChar = "", repCount = 0;
      for (var c = 0; c < grpLen; c++) {
        var candidate, attempts = 0;
        do {
          candidate = pool[Math.floor(Math.random() * pool.length)];
          attempts++;
        } while (candidate === lastChar && repCount >= 2 && attempts < 15);

        if (candidate === lastChar) repCount++;
        else { lastChar = candidate; repCount = 1; }
        grp += candidate;
      }
      generatedList.push(grp);
    }
  }

  renderGroupsFromList(generatedList);
  validateInputs();
}

function getGroupsFromTable() {
  var inputs = document.querySelectorAll(".group-input-val");
  var list = [];
  for (var i = 0; i < inputs.length; i++) list.push(cleanMorseChars(inputs[i].value));
  return list;
}

function setPreset(chars) {
  if (rxSessionOn) return;
  var customField = document.getElementById("customCharset");
  customField.value = chars;
  document.getElementById("accentCharset").value = "";
  autoGrow(customField);
  autoGrow(document.getElementById("accentCharset"));
  uiGenerateGroupsTable();
}

function clearAllTrainer() {
  if (rxSessionOn) return;
  var inp = document.getElementById("customCharset");
  inp.value = "";
  document.getElementById("accentCharset").value = "";
  document.getElementById("groupsContainer").innerHTML = "";
  blankIsImported = false;
  document.getElementById("txtUserInput").value = "";
  document.getElementById("diffBox").style.display = "none";
  setUiText("examReport", "");
  autoGrow(inp);
  autoGrow(document.getElementById("accentCharset"));
  validateInputs();
  inp.focus();
}

function alignSequences(orig, user) {
  var n = orig.length, m = user.length;
  var dp = [];
  for (var i = 0; i <= n; i++) {
    dp[i] = [];
    for (var j = 0; j <= m; j++) dp[i][j] = 0;
    dp[i][0] = i;
  }
  for (var col = 0; col <= m; col++) dp[0][col] = col;

  for (var r = 1; r <= n; r++) {
    for (var c = 1; c <= m; c++) {
      var cost = orig[r - 1] === user[c - 1] ? 0 : 1;
      dp[r][c] = Math.min(dp[r - 1][c] + 1, dp[r][c - 1] + 1, dp[r - 1][c - 1] + cost);
    }
  }

  var curR = n, curC = m;
  var alignedOrig = [], alignedUser = [];
  while (curR > 0 || curC > 0) {
    if (curR > 0 && curC > 0 && dp[curR][curC] === dp[curR - 1][curC - 1] + (orig[curR - 1] === user[curC - 1] ? 0 : 1)) {
      alignedOrig.push(orig[curR - 1]);
      alignedUser.push(user[curC - 1]);
      curR--; curC--;
    } else if (curR > 0 && dp[curR][curC] === dp[curR - 1][curC] + 1) {
      alignedOrig.push(orig[curR - 1]);
      alignedUser.push("_");
      curR--;
    } else {
      alignedOrig.push("");
      alignedUser.push(user[curC - 1]);
      curC--;
    }
  }
  return { alignedOrig: alignedOrig.reverse(), alignedUser: alignedUser.reverse() };
}

document.getElementById("btnRxCheck").onclick = function () {
  if (!targetRadiogram) {
    alert("ПЕРЕДАЧА НЕ ВЫПОЛНЯЛАСЬ. НАЖМИТЕ «ПУСК ПРИЁМА».");
    return;
  }

  var cleanOrig = cleanMorseChars(targetRadiogram);
  var cleanUser = cleanMorseChars(document.getElementById("txtUserInput").value);
  var alignResult = alignSequences(cleanOrig, cleanUser);
  var alignedOrig = alignResult.alignedOrig;
  var alignedUser = alignResult.alignedUser;

  var diffHtml = "", errors = 0, validCharCount = 0;
  var grpLen = parseInt(document.getElementById("groupLength").value, 10) || 5;

  for (var k = 0; k < alignedOrig.length; k++) {
    var o = alignedOrig[k], u = alignedUser[k];
    if (o === u) {
      diffHtml += '<span class="char-ok">' + u + "</span>";
    } else {
      errors++;
      if (o === "") diffHtml += '<span class="char-err">' + u + "[+]</span>";
      else if (u === "_") diffHtml += '<span class="char-err">_[' + o + "]</span>";
      else diffHtml += '<span class="char-err">' + u + "[" + o + "]</span>";
    }
    if (o !== "") validCharCount++;
    if (validCharCount > 0 && validCharCount % grpLen === 0 && o !== "") diffHtml += " ";
  }

  var diffBox = document.getElementById("diffBox");
  diffBox.innerHTML = "<b>РЕЗУЛЬТАТ КОНТРОЛЬНОЙ СВЕРКИ:</b><br>" + diffHtml;
  diffBox.style.display = "block";

  var total = cleanOrig.length;
  var percent = Math.max(0, Math.round(((total - errors) / total) * 100));
  var mark = "НЕУДОВЛЕТВОРИТЕЛЬНО (2)";
  if (errors <= 1) mark = "ОТЛИЧНО (5)";
  else if (errors <= 3) mark = "ХОРОШО (4)";
  else if (errors <= 5) mark = "УДОВЛЕТВОРИТЕЛЬНО (3)";

  setUiText("examReport", "ИТОГ: ПРИНЯТО ВЕРНО " + Math.max(0, total - errors) + " ИЗ " + total + " (" + percent + "%). ОШИБОК: " + errors + ". ОЦЕНКА: " + mark);
};


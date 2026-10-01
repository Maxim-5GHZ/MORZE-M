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
  document.getElementById("selPreambleMode").disabled = isLocked;
  document.getElementById("selPostambleMode").disabled = isLocked;
  document.getElementById("btnGenGroups").disabled = isLocked;
  document.getElementById("monoCharInput").disabled = isLocked;
  document.getElementById("monoCharCount").disabled = isLocked;
  document.getElementById("btnInsertMono").disabled = isLocked;

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

function getLiveAtomTimings() {
  var charSpd = parseInt(document.getElementById("rngCharSpeed").value, 10) || 70;
  var farnSpd = Math.min(charSpd, parseInt(document.getElementById("rngFarnSpeed").value, 10) || 50);
  var grpMult = (parseFloat(document.getElementById("rngGroupPause").value) || 10) / 10.0;
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
    setRxStatus("ИДЁТ ПРИЁМ: " + rxPositionText(false), false);
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
      commit: function () { st.c = c0; st.k = 0; st.s = 0; st.el = false; }
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

  if (uniqueChars.length === 0) {
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

  if (invalidAccChars.length > 0) {
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

  var emptyGroupFound = false, brokenIndex = -1;
  for (var g = 0; g < groupInputs.length; g++) {
    var cell = findAncestor(groupInputs[g], "group-cell");
    var val = cleanMorseChars(groupInputs[g].value);
    if (val.length < targetLen) {
      emptyGroupFound = true;
      if (brokenIndex === -1) brokenIndex = g + 1;
      if (cell) cell.className += " cell-error";
    } else {
      if (cell) cell.className = cell.className.replace(/\bcell-error\b/g, "").trim();
    }
  }

  if (emptyGroupFound) {
    errBox.style.display = "block";
    errBox.innerHTML = "НАРУШЕНИЕ СТРУКТУРЫ: Группа №" + brokenIndex + " содержит менее " + targetLen + " знаков.";
    startBtn.disabled = true;
    return false;
  }

  errBox.style.display = "none";
  if (!rxSessionOn) startBtn.disabled = false;
  return true;
}

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

function uiGenerateGroupsTable() {
  if (rxSessionOn) return;
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
  var generatedList = [];

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


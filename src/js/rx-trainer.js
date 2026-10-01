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

function playSignalChain(codes) {
  var cIdx = 0;

  function nextCode() {
    if (cIdx >= codes.length || !rxActive) return Promise.resolve();
    var code = codes[cIdx++];
    var s = 0;

    function nextSym() {
      if (s >= code.length || !rxActive) {
        var t = getLiveAtomTimings();
        return sleepRx(t.charPauseMs);
      }
      var t = getLiveAtomTimings();
      toneOn("RX");
      return sleepRx(code[s] === "." ? t.dotMs : t.dashMs).then(function () {
        toneOff("RX");
        return sleepRx(t.elemPauseMs);
      }).then(function () {
        s++;
        return nextSym();
      });
    }

    return nextSym().then(nextCode);
  }

  return nextCode();
}

// Блок служебных сигналов (зачин/концовка) с последующей технологической паузой
function playSignalBlock(codes) {
  if (!codes || codes.length === 0 || !rxActive) return Promise.resolve();
  return playSignalChain(codes).then(function () {
    return sleepRx(1200);
  });
}

function playRadiogramProcess(groups, repeats, charRepeats) {
  charRepeats = charRepeats || 1;
  var preambleCodes = getSignalItems("selPreambleMode", PREAMBLE_CODES);
  var postambleCodes = getSignalItems("selPostambleMode", POSTAMBLE_CODES);

  return playSignalBlock(preambleCodes).then(function () {
    var g = 0;
    function nextGroup() {
      if (g >= groups.length || !rxActive) return Promise.resolve();
      var grp = groups[g], r = 0;
      function nextRepeat() {
        if (r >= repeats || !rxActive) { g++; return nextGroup(); }
        highlightGroup(g);
        var cell = document.getElementById("grp-cell-" + g);
        if (cell) {
          var slots = cell.querySelectorAll(".char-slot");
          for (var i = 0; i < slots.length; i++) slots[i].className = "char-slot";
        }
        var c = 0;
        function nextChar() {
          if (c >= grp.length || !rxActive) {
            var t = getLiveAtomTimings();
            return sleepRx(t.groupPauseMs).then(function () { r++; return nextRepeat(); });
          }
          var code = MORSE_MAP[grp[c]];
          if (!code) {
            // Неизвестный знак: одна межзнаковая пауза, повторения не применяются
            var t0 = getLiveAtomTimings();
            return sleepRx(t0.charPauseMs).then(function () { c++; return nextChar(); });
          }
          highlightChar(g, c);
          var k = 0;
          // ПОВТОРЕНИЕ ЗНАКА: один и тот же знак charRepeats раз подряд,
          // раздельно межзнаковой паузой (слитный приём удвоенных знаков)
          function nextCharRepeat() {
            if (k >= charRepeats || !rxActive) {
              releaseCharHighlight(g, c);
              c++;
              return nextChar();
            }
            k++;
            var s = 0;
            function nextSymbol() {
              if (s >= code.length || !rxActive) {
                var t = getLiveAtomTimings();
                return sleepRx(t.charPauseMs).then(function () { return nextCharRepeat(); });
              }
              var t = getLiveAtomTimings();
              toneOn("RX");
              return sleepRx(code[s] === "." ? t.dotMs : t.dashMs).then(function () {
                toneOff("RX");
                return sleepRx(t.elemPauseMs);
              }).then(function () { s++; return nextSymbol(); });
            }
            return nextSymbol();
          }
          return nextCharRepeat();
        }
        return nextChar();
      }
      return nextRepeat();
    }
    return nextGroup();
  }).then(function () {
    // Окончание (концовка) после передачи радиограммы + технологическая пауза
    return playSignalBlock(postambleCodes);
  });
}

document.getElementById("btnRxStart").onclick = function () {
  if (!validateInputs()) return;
  var groups = getGroupsFromTable();
  if (groups.length === 0) return;

  initAudio();
  rxActive = true;
  rxActiveGeneration++;
  setTrainerLocked(true);
  applyAudioParamsNow();

  document.getElementById("btnRxStart").disabled = true;
  document.getElementById("btnRxStop").disabled = false;
  document.getElementById("diffBox").style.display = "none";
  setUiText("examReport", "");
  document.getElementById("txtUserInput").value = "";
  document.getElementById("txtUserInput").focus();

  var repeats = parseInt(document.getElementById("groupRepeat").value, 10) || 1;
  // Повтор знака — только акустический: эталон радиограммы остаётся без повторов
  var charRepeats = parseInt(document.getElementById("charRepeat").value, 10) || 1;
  var fullList = [];
  for (var i = 0; i < groups.length; i++) {
    for (var r = 0; r < repeats; r++) fullList.push(groups[i]);
  }
  targetRadiogram = fullList.join(" ");

  function cleanup() {
    rxActive = false;
    toneOff("RX");
    applyAudioParamsNow();
    clearAllHighlights();
    setTrainerLocked(false);
    document.getElementById("btnRxStart").disabled = false;
    document.getElementById("btnRxStop").disabled = true;
  }
  playRadiogramProcess(groups, repeats, charRepeats).then(cleanup, cleanup);
};

document.getElementById("btnRxStop").onclick = function () {
  rxActive = false;
  rxActiveGeneration++;
  toneOff("RX");
  applyAudioParamsNow();
  clearAllHighlights();
  setTrainerLocked(false);
  document.getElementById("btnRxStart").disabled = false;
  document.getElementById("btnRxStop").disabled = true;
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
  if (!rxActive) startBtn.disabled = false;
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
  if (rxActive) return;
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
  if (rxActive) return;
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
  if (rxActive) return;
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
  if (rxActive) return;
  var customField = document.getElementById("customCharset");
  customField.value = chars;
  document.getElementById("accentCharset").value = "";
  autoGrow(customField);
  autoGrow(document.getElementById("accentCharset"));
  uiGenerateGroupsTable();
}

function clearAllTrainer() {
  if (rxActive) return;
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


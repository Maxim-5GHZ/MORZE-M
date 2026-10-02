/* ==========================================================================
   МОДУЛЬ: БЛАНК РАДИОГРАММЫ (СЕТКА ГРУПП)
   - блокировка/подсветка групп и знаков, валидация структуры бланка;
   - делегированные события контейнера (ввод, навигация, короткий ноль);
   - отрисовка сетки, ручные флаги, моногруппы.
   Совместимость: только ES5 (Gecko 38), общий скоуп единого <script>.
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
// Признак ручных правок бланка (ввод в ячейки, перетаскивание). Вместе с
// blankIsImported решает, спрашивать ли подтверждение перед перегенерацией:
// свежий сгенерированный бланк перестраивается молча, правленый - с confirm.
var groupsDirty = false;
var groupsHidden = false;

// Единая точка смены режима «импортированности»: держит бейдж в шапке бланка
// в согласии с флагом (бейджа может не быть в разметке - тогда только флаг).
function setBlankImported(v) {
  blankIsImported = !!v;
  if (blankIsImported) groupsDirty = false;
  var badge = document.getElementById("importBadge");
  if (badge) badge.style.display = blankIsImported ? "inline-block" : "none";
}

// Охранник перегенерации: явные действия (кнопка, пресеты, селекты) идут через
// него, тихие системные вызовы (старт, boot) - напрямую в uiGenerateGroupsTable.
function regenAllowed() {
  if (typeof rxSessionOn !== "undefined" && rxSessionOn) return false;
  var inputs = document.querySelectorAll(".group-input-val");
  if (!inputs || !inputs.length) return true;
  if (!groupsDirty && !blankIsImported) return true;
  var msg = blankIsImported
    ? "ПЕРЕГЕНЕРИРОВАТЬ МАШИННЫЕ ГРУППЫ? ЗАГРУЖЕННЫЕ СОХРАНЯТСЯ."
    : "ПЕРЕГЕНЕРИРОВАТЬ МАШИННЫЕ ГРУППЫ? РУЧНЫЕ СОХРАНЯТСЯ.";
  try { return !!confirm(msg); } catch (e) { return false; }
}

function requestRegenerate() {
  if (regenAllowed()) uiGenerateGroupsTable();
}
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

/* --------------------------------------------------------------------------
   ДЕЛЕГИРОВАННЫЕ СОБЫТИЯ БЛАНКА (Firefox 38).
   Раньше на каждый input ячейки вешалось по 5 слушателей (oninput/onkeydown
   + keydown/keyup/input короткого нуля) - при 100 группах ~500 замыканий.
   Теперь на контейнер #groupsContainer висят ровно 3 слушателя (input,
   keydown, keyup), события input/keydown/keyup всплывают в Gecko 38.
   Статичные поля (customCharset, monoCharInput, txtUserInput) по-прежнему
   обслуживаются per-element через attachShortZeroHandler().
   Соседний keydown DnD (CTRL+стрелки, groups-dnd.js) не пересекается:
   здесь коды 37/39 не обрабатываются.
   -------------------------------------------------------------------------- */
var blankDelegationBound = false;

function isBlankGroupInput(el) {
  return !!(el && el.className && (" " + el.className + " ").indexOf(" group-input-val ") !== -1);
}

function blankInputFromEvent(e) {
  var t = (e && (e.target || e.srcElement)) || null;
  return isBlankGroupInput(t) ? t : null;
}

// Единый обработчик ввода: автозамена 0-/-0 -> Ø (бывший per-element input
// из polyfills.js) + чистка cleanMorseChars (бывший oninput), с удержанием
// каретки при замене.
function handleBlankInputEvent(target) {
  var raw = target.value;
  var val = ("" + raw).toUpperCase().replace(/Ё/g, "Е");
  val = val.replace(/0-|-0/g, "Ø").replace(/[^A-ZА-Я0-9Ø=\/?,\.]/g, "");
  if (raw !== val) {
    var s = null;
    try { s = target.selectionStart; } catch (e) { s = null; }
    target.value = val;
    if (typeof s === "number") {
      try {
        var pos = s - (raw.length - val.length);
        if (pos < 0) pos = 0;
        if (pos > val.length) pos = val.length;
        target.setSelectionRange(pos, pos);
      } catch (e2) {}
    }
  }
  markGroupCellManual(findAncestor(target, "group-cell"), true);
  groupsDirty = true;
  validateInputs();
  updateOverallSpeed();
}

// Единый keydown: сначала аккорд короткого нуля 0+-(те же глобалы
// isZeroKeyPressed/isMinusKeyPressed из polyfills.js), затем навигация
// Enter/Space (монозаливка + фокус следующей) и Backspace на пустой ячейке
// (удаление группы). Портировано 1:1 из бывшего attachGroupInputEvents.
function handleBlankKeydown(target, e) {
  e = e || window.event;
  var kc = e.keyCode || e.which;
  var now = Date.now();

  if (isZeroKeyCode(kc)) {
    isZeroKeyPressed = true;
    lastZeroPressTime = now;
    if (isMinusKeyPressed || (now - lastMinusPressTime <= CHORD_TOLERANCE_MS)) {
      if (e.preventDefault) e.preventDefault();
      replaceTextAtCursor(target, "Ø", (now - lastMinusPressTime <= CHORD_TOLERANCE_MS) ? 1 : 0);
      lastZeroPressTime = 0;
      lastMinusPressTime = 0;
      return;
    }
  } else if (isMinusKeyCode(kc)) {
    isMinusKeyPressed = true;
    lastMinusPressTime = now;
    if (isZeroKeyPressed || (now - lastZeroPressTime <= CHORD_TOLERANCE_MS)) {
      if (e.preventDefault) e.preventDefault();
      replaceTextAtCursor(target, "Ø", (now - lastZeroPressTime <= CHORD_TOLERANCE_MS) ? 1 : 0);
      lastZeroPressTime = 0;
      lastMinusPressTime = 0;
      return;
    }
  }

  if (kc === 13 || kc === 32) {
    var grpLen = parseInt(document.getElementById("groupLength").value, 10) || 5;
    if (e.preventDefault) e.preventDefault();
    var val = cleanMorseChars(target.value);
    if (val.length === 1) {
      ensureCharInCharset(val);
      var full = "";
      for (var i = 0; i < grpLen; i++) full += val;
      target.value = full;
      markGroupCellManual(findAncestor(target, "group-cell"), true);
      groupsDirty = true;
    }
    validateInputs();

    var allInputs = document.querySelectorAll(".group-input-val");
    var currentIndex = -1;
    for (var k = 0; k < allInputs.length; k++) {
      if (allInputs[k] === target) { currentIndex = k; break; }
    }

    if (currentIndex > -1 && currentIndex < allInputs.length - 1) {
      allInputs[currentIndex + 1].focus();
      allInputs[currentIndex + 1].select();
    } else if (currentIndex === allInputs.length - 1) {
      if (allInputs.length < 100) addNewEmptyGroup();
    }
  }

  if (kc === 8 && target.value === "") {
    var inputs = document.querySelectorAll(".group-input-val");
    if (inputs.length > 1) {
      if (e.preventDefault) e.preventDefault();
      var prevIdx = -1;
      for (var p = 0; p < inputs.length; p++) {
        if (inputs[p] === target) { prevIdx = p - 1; break; }
      }
      var cell = findAncestor(target, "group-cell");
      if (cell && cell.parentNode) cell.parentNode.removeChild(cell);
      groupsDirty = true;
      reindexCells();
      if (blankIsImported && readManualFlags().indexOf(1) === -1) setBlankImported(false);
      var updatedInputs = document.querySelectorAll(".group-input-val");
      document.getElementById("numGroups").value = updatedInputs.length;
      if (prevIdx >= 0 && updatedInputs[prevIdx]) updatedInputs[prevIdx].focus();
      validateInputs();
    }
  }
}

function handleBlankKeyup(e) {
  e = e || window.event;
  var kc = e.keyCode || e.which;
  if (isZeroKeyCode(kc)) isZeroKeyPressed = false;
  if (isMinusKeyCode(kc)) isMinusKeyPressed = false;
}

function initBlankDelegation() {
  if (blankDelegationBound) return;
  var container = document.getElementById("groupsContainer");
  if (!container || !container.addEventListener) return;
  blankDelegationBound = true;
  container.addEventListener("input", function (e) {
    var t = blankInputFromEvent(e);
    if (!t) return;
    handleBlankInputEvent(t);
  }, false);
  container.addEventListener("keydown", function (e) {
    var t = blankInputFromEvent(e);
    if (!t) return;
    handleBlankKeydown(t, e);
  }, false);
  container.addEventListener("keyup", function (e) {
    handleBlankKeyup(e);
  }, false);
}

function reindexCells() {
  var cells = document.querySelectorAll(".group-cell:not(.group-cell-add)");
  for (var i = 0; i < cells.length; i++) {
    cells[i].id = "grp-cell-" + i;
    var idxLabel = cells[i].querySelector(".group-cell-idx");
    if (idxLabel) idxLabel.textContent = "№" + (i + 1);
  }
}

// Происхождение ячейки: "1" - ручная (написана/исправлена/вставлена/
// импортирована, переживает перегенерацию), иначе - машинная.
function markGroupCellManual(cell, manual) {
  if (!cell || !cell.setAttribute) return;
  var tip = "Ручная группа — не перегенерируется";
  var inp = (cell.querySelector) ? cell.querySelector(".group-input-val") : null;
  if (manual) {
    cell.setAttribute("data-manual", "1");
    if (cell.className.indexOf("manual") === -1) cell.className += " manual";
    cell.title = tip;
    if (inp) inp.title = tip;
  } else {
    if (cell.removeAttribute) cell.removeAttribute("data-manual");
    cell.className = cell.className.replace(/\bmanual\b/g, "").trim();
    cell.title = "";
    if (inp) inp.title = "";
  }
}

function isGroupCellManual(cell) {
  if (!cell || !cell.getAttribute) return false;
  return cell.getAttribute("data-manual") === "1";
}

// Флаги ручных ячеек в порядке getGroupsFromTable(): значения и флаги идут
// синхронно, т.к. читаются из одних и тех же DOM-узлов по порядку.
function readManualFlags() {
  var inputs = document.querySelectorAll(".group-input-val");
  var flags = [];
  for (var i = 0; i < inputs.length; i++) {
    flags.push(isGroupCellManual(findAncestor(inputs[i], "group-cell")) ? 1 : 0);
  }
  return flags;
}

function renderGroupsFromList(groupsList, manuals) {
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
    markGroupCellManual(cell, manuals && manuals[g]);
    // Слушатели не вешаем: ввод/навигация/короткий ноль идут через
    // делегированные хендлеры контейнера (initBlankDelegation, 3 шт.).
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
    showToast("ПРЕВЫШЕН ЛИМИТ: Максимальное число групп — 100.");
    return;
  }
  currentGroups.push("");
  document.getElementById("numGroups").value = currentGroups.length;
  var addFlags = readManualFlags();
  addFlags.push(1);
  renderGroupsFromList(currentGroups, addFlags);
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
    showToast("ПРЕВЫШЕН ЛИМИТ: Максимальное число групп — 100 (сейчас: " + currentGroups.length + ").");
    return;
  }

  ensureCharInCharset(ch);

  var monoStr = "";
  for (var i = 0; i < grpLen; i++) monoStr += ch;
  var monoFlags = readManualFlags();
  for (var k = 0; k < count; k++) { currentGroups.push(monoStr); monoFlags.push(1); }

  document.getElementById("numGroups").value = currentGroups.length;
  renderGroupsFromList(currentGroups, monoFlags);
  validateInputs();

  input.value = "";
  input.focus();
  var container = document.getElementById("groupsContainer");
  container.scrollTop = container.scrollHeight;
}

/* ==========================================================================
   МОДУЛЬ: ГЕНЕРАЦИЯ БЛАНКА РАДИОГРАММЫ
   - взвешенный пул знаков, моногруппы/смешанные группы, серия без троек;
   - ручные ячейки переживают перегенерацию; пресеты и сброс бланка.
   Совместимость: только ES5 (Gecko 38), общий скоуп единого <script>.
   ========================================================================== */
function genMonoGroup(pool, grpLen, st) {
  var monoCh, monoTries = 0;
  do {
    monoCh = pool[Math.floor(Math.random() * pool.length)];
    monoTries++;
  } while (monoCh === st.prev && st.streak >= 2 && monoTries < 15);
  if (monoCh === st.prev) st.streak++;
  else { st.prev = monoCh; st.streak = 1; }
  var monoGrp = "";
  for (var mc = 0; mc < grpLen; mc++) monoGrp += monoCh;
  return monoGrp;
}

function genMixGroup(pool, grpLen) {
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
  return grp;
}

// Односоставной ли текст (все знаки одинаковые) - для учёта ручных моногрупп
// в сквозной серии генератора.
function uniformGroupChar(s) {
  if (!s) return "";
  var ch0 = s.charAt(0);
  for (var i = 1; i < s.length; i++) {
    if (s.charAt(i) !== ch0) return "";
  }
  return ch0;
}

function uiGenerateGroupsTable() {
  if (rxSessionOn) return;
  var container = document.getElementById("groupsContainer");
  var numStr = ("" + document.getElementById("numGroups").value).trim();
  if (numStr === "") { container.innerHTML = ""; setBlankImported(false); groupsDirty = false; validateInputs(); return; }

  var grpCount = parseInt(numStr, 10);
  if (isNaN(grpCount) || grpCount < 0) { container.innerHTML = ""; setBlankImported(false); groupsDirty = false; validateInputs(); return; }
  if (grpCount === 0) {
    container.innerHTML = '<div style="padding:15px;color:var(--mil-dim);font-size:11px;width:100%;text-align:center">БЛАНК РАДИОГРАММЫ ПУСТ (ЧИСЛО ГРУПП: 0)</div>';
    setBlankImported(false); groupsDirty = false;
    validateInputs();
    return;
  }
  if (grpCount > 100) { container.innerHTML = ""; setBlankImported(false); groupsDirty = false; validateInputs(); return; }

  var raw = cleanMorseChars(document.getElementById("customCharset").value);
  var uniqueChars = [];
  for (var i = 0; i < raw.length; i++) {
    if (uniqueChars.indexOf(raw[i]) === -1) uniqueChars.push(raw[i]);
  }
  if (!uniqueChars.length) { container.innerHTML = ""; setBlankImported(false); groupsDirty = false; validateInputs(); return; }

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
  // Галочка «Сохранять ручные набранные группы»: если снята - ручные флаги
  // игнорируются, все слоты генерируются заново как машинные.
  var keepEl = document.getElementById("chkKeepManual");
  var keepManual = !keepEl || !!keepEl.checked;

  // Ручные ячейки (написанные/исправленные/вставленные/импортированные) стоят
  // на своих местах с тем же текстом; машинные слоты генерируются заново.
  // Сжатие - строго под число групп, режем с конца.
  var curVals = getGroupsFromTable();
  var curFlags = readManualFlags();
  var slots = [];
  for (var s = 0; s < grpCount && s < curVals.length; s++) {
    slots.push({ text: curVals[s], manual: keepManual && !!curFlags[s] });
  }
  while (slots.length < grpCount) slots.push({ text: "", manual: false });

  var monoSt = { prev: "", streak: 0 };
  var manualLeft = 0;
  for (var g = 0; g < slots.length; g++) {
    if (slots[g].manual) {
      manualLeft++;
      // Ручная моногруппа участвует в серии, чтобы не вышло три одинаковых.
      var uch = uniformGroupChar(slots[g].text);
      if (wantMono && uch) {
        if (uch === monoSt.prev) monoSt.streak++;
        else { monoSt.prev = uch; monoSt.streak = 1; }
      }
    } else if (wantMono) {
      slots[g].text = genMonoGroup(pool, grpLen, monoSt);
    } else {
      slots[g].text = genMixGroup(pool, grpLen);
    }
  }

  var outList = [], outFlags = [];
  for (var o = 0; o < slots.length; o++) { outList.push(slots[o].text); outFlags.push(slots[o].manual ? 1 : 0); }
  renderGroupsFromList(outList, outFlags);
  document.getElementById("numGroups").value = outList.length;
  groupsDirty = false;
  if (!manualLeft) setBlankImported(false);
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
  if (!regenAllowed()) return;
  var customField = document.getElementById("customCharset");
  customField.value = chars;
  document.getElementById("accentCharset").value = "";
  autoGrow(customField);
  autoGrow(document.getElementById("accentCharset"));
  uiGenerateGroupsTable();
}

function clearAllTrainer() {
  if (rxSessionOn) return;
  try {
    if (!confirm("СБРОСИТЬ БЛАНК: очистить набор знаков, группы и журнал?")) return;
  } catch (e) { return; }
  var inp = document.getElementById("customCharset");
  inp.value = "";
  document.getElementById("accentCharset").value = "";
  document.getElementById("groupsContainer").innerHTML = "";
  setBlankImported(false); groupsDirty = false;
  document.getElementById("txtUserInput").value = "";
  document.getElementById("diffBox").style.display = "none";
  setUiText("examReport", "");
  autoGrow(inp);
  autoGrow(document.getElementById("accentCharset"));
  validateInputs();
  inp.focus();
}

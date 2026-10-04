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

// Индекс группы под ПКМ-курсором (-1 - клик мимо групп). Объявлен явно,
// чтобы чтение до первого showGroupsCtxMenu не давало ReferenceError.
var ctxGroupIndex = -1;

// Нормализация сырого текста: верхний регистр, Ё -> Е, короткий ноль 0-/-0
// -> Ø (та же конвенция, что и ручной ввод), морзе-транслит, чистка мусора.
function importTranslitLatin(s) {
  try {
    if (typeof latinToCyrMorse === "function") return latinToCyrMorse(s);
  } catch (e) {}
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
// СТРОГО КИРИЛЛИЦА: латиница уже переведена транслитом выше, здесь и далее
// буквы только А-Я (cleanMorseChars тоже кириллический).
function importSplitWords(raw) {
  if (!raw) return [];
  var s = ("" + raw).toUpperCase().replace(/Ё/g, "Е");
  s = s.replace(/0-|-0/g, "Ø");
  s = importTranslitLatin(s);
  s = s.replace(/[^А-Я0-9Ø=\/?,\.\s]/g, " ");
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
  var impFlags = [];
  for (var fi = 0; fi < r.groups.length; fi++) impFlags.push(1);
  renderGroupsFromList(r.groups, impFlags);
  document.getElementById("numGroups").value = r.groups.length;
  setBlankImported(true);
  closeTextImport();
  validateInputs();
  var container = document.getElementById("groupsContainer");
  if (container) container.scrollTop = 0;
}

// Короткое немодальное уведомление вместо alert(): не блокирует работу,
// гаснет само. Откат на alert - только если разметки тоста нет (чужой хост).
var toastTimer = null;
function showToast(text) {
  var t = document.getElementById("toast");
  if (!t) { try { alert(text); } catch (e) {} return; }
  t.textContent = text;
  t.style.display = "block";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    t.style.display = "none";
    toastTimer = null;
  }, 2600);
}

/* ---------- Контекстное меню бланка (ПКМ) ---------- */

function hideGroupsCtxMenu() {
  var m = document.getElementById("groupsCtxMenu");
  if (m) m.style.display = "none";
  ctxGroupIndex = -1;
}

// Поставить фокус в ячейку idx и прокрутить к ней: после вставки пустой
// группы курсор сразу в ней, меню уже закрыто и ничего не перекрывает.
function ctxFocusGroupInput(idx) {
  try {
    var inputs = document.querySelectorAll(".group-input-val");
    if (!inputs || idx < 0 || idx >= inputs.length) return;
    var cell = document.getElementById("grp-cell-" + idx);
    if (cell && cell.scrollIntoView) {
      try { cell.scrollIntoView(false); } catch (e) {}
    }
    inputs[idx].focus();
  } catch (e) {}
}

function showGroupsCtxMenu(x, y, grpIdx) {
  var m = document.getElementById("groupsCtxMenu");
  if (!m) return;
  // Контекст группы: индекс ячейки под курсором (-1 - клик мимо групп).
  ctxGroupIndex = (typeof grpIdx === "number") ? grpIdx : -1;
  var list = getGroupsFromTable();
  if (ctxGroupIndex < 0 || ctxGroupIndex >= list.length) ctxGroupIndex = -1;
  var box = document.getElementById("groupsCtxGroup");
  if (box) {
    box.style.display = ctxGroupIndex >= 0 ? "block" : "none";
    var title = document.getElementById("groupsCtxGroupTitle");
    if (title && ctxGroupIndex >= 0) setUiText(title, "ГРУППА №" + (ctxGroupIndex + 1));
  }
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
  if (!kept.length) { showToast("БЛАНК ПУСТ: копировать нечего."); return; }
  var text = kept.join(" ");
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function" &&
        typeof Promise !== "undefined") {
      navigator.clipboard.writeText(text).then(function () {
        showToast("РАДИОГРАММА СКОПИРОВАНА: групп " + kept.length + ".");
      }, function () {
        if (legacyCopyText(text)) showToast("РАДИОГРАММА СКОПИРОВАНА: групп " + kept.length + ".");
        else showToast("НЕ УДАЛОСЬ СКОПИРОВАТЬ: буфер недоступен.");
      });
      return;
    }
  } catch (e) {}
  if (legacyCopyText(text)) showToast("РАДИОГРАММА СКОПИРОВАНА: групп " + kept.length + ".");
  else showToast("НЕ УДАЛОСЬ СКОПИРОВАТЬ: буфер недоступен.");
}

function clearBlankGroups() {
  hideGroupsCtxMenu();
  if (typeof rxSessionOn !== "undefined" && rxSessionOn) return;
  try {
    if (!confirm("ОЧИСТИТЬ ГРУППЫ БЛАНКА?")) return;
  } catch (e) { return; }
  renderGroupsFromList([]);
  document.getElementById("numGroups").value = 0;
  setBlankImported(false); groupsDirty = false;
  validateInputs();
}

function ctxGroupInsertAbove() {
  if (typeof rxSessionOn !== "undefined" && rxSessionOn) { hideGroupsCtxMenu(); return; }
  var list = getGroupsFromTable();
  var idx = ctxGroupIndex;
  if (idx < 0 || idx >= list.length) { hideGroupsCtxMenu(); return; }
  if (list.length >= IMPORT_MAX_GROUPS) { hideGroupsCtxMenu(); showToast("ПРЕВЫШЕН ЛИМИТ: Максимальное число групп — 100."); return; }
  hideGroupsCtxMenu();
  var flags = readManualFlags();
  var newList = list.slice();
  newList.splice(idx, 0, "");
  flags.splice(idx, 0, 1);
  document.getElementById("numGroups").value = newList.length;
  renderGroupsFromList(newList, flags);
  groupsDirty = true;
  validateInputs();
  ctxFocusGroupInput(idx);
}

function ctxGroupInsertBelow() {
  if (typeof rxSessionOn !== "undefined" && rxSessionOn) { hideGroupsCtxMenu(); return; }
  var list = getGroupsFromTable();
  var idx = ctxGroupIndex;
  if (idx < 0 || idx >= list.length) { hideGroupsCtxMenu(); return; }
  if (list.length >= IMPORT_MAX_GROUPS) { hideGroupsCtxMenu(); showToast("ПРЕВЫШЕН ЛИМИТ: Максимальное число групп — 100."); return; }
  hideGroupsCtxMenu();
  var flags = readManualFlags();
  var newList = list.slice();
  newList.splice(idx + 1, 0, "");
  flags.splice(idx + 1, 0, 1);
  document.getElementById("numGroups").value = newList.length;
  renderGroupsFromList(newList, flags);
  groupsDirty = true;
  validateInputs();
  ctxFocusGroupInput(idx + 1);
}

function ctxGroupDuplicate() {
  if (typeof rxSessionOn !== "undefined" && rxSessionOn) { hideGroupsCtxMenu(); return; }
  var list = getGroupsFromTable();
  var idx = ctxGroupIndex;
  if (idx < 0 || idx >= list.length) { hideGroupsCtxMenu(); return; }
  if (list.length >= IMPORT_MAX_GROUPS) { hideGroupsCtxMenu(); showToast("ПРЕВЫШЕН ЛИМИТ: Максимальное число групп — 100."); return; }
  hideGroupsCtxMenu();
  var flags = readManualFlags();
  var newList = list.slice();
  newList.splice(idx + 1, 0, list[idx]);
  flags.splice(idx + 1, 0, 1);
  document.getElementById("numGroups").value = newList.length;
  renderGroupsFromList(newList, flags);
  groupsDirty = true;
  validateInputs();
  ctxFocusGroupInput(idx + 1);
}

function ctxGroupCopy() {
  if (typeof rxSessionOn !== "undefined" && rxSessionOn) { hideGroupsCtxMenu(); return; }
  var list = getGroupsFromTable();
  var idx = ctxGroupIndex;
  hideGroupsCtxMenu();
  if (idx < 0 || idx >= list.length) return;
  var text = list[idx];
  if (!text) { showToast("ГРУППА ПУСТА: что копировать?"); return; }
  if (typeof navigator !== "undefined" && navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(text).then(function () {
      showToast("СКОПИРОВАНО: " + text);
    }, function () {
      if (legacyCopyText(text)) showToast("СКОПИРОВАНО: " + text);
      else showToast("НЕ УДАЛОСЬ СКОПИРОВАТЬ: буфер недоступен.");
    });
  } else {
    if (legacyCopyText(text)) showToast("СКОПИРОВАНО: " + text);
    else showToast("НЕ УДАЛОСЬ СКОПИРОВАТЬ: буфер недоступен.");
  }
}

function ctxGroupDelete() {
  if (typeof rxSessionOn !== "undefined" && rxSessionOn) { hideGroupsCtxMenu(); return; }
  var idx = ctxGroupIndex;
  var list = getGroupsFromTable();
  if (idx < 0 || idx >= list.length) { hideGroupsCtxMenu(); return; }
  hideGroupsCtxMenu();
  var flags = readManualFlags();
  var newList = list.slice();
  newList.splice(idx, 1);
  flags.splice(idx, 1);
  document.getElementById("numGroups").value = newList.length;
  renderGroupsFromList(newList, flags);
  groupsDirty = true;
  if (blankIsImported && flags.indexOf(1) === -1) setBlankImported(false);
  validateInputs();
  if (newList.length) ctxFocusGroupInput(idx < newList.length ? idx : newList.length - 1);
  showToast("ГРУППА №" + (idx + 1) + " УДАЛЕНА.");
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
        // Определяем индекс группы под курсором
        var groupIndex = -1;
        var cell = document.elementFromPoint(x, y);
        while (cell && cell !== document) {
          if (cell.className && (" " + cell.className + " ").indexOf(" group-cell ") !== -1) {
            // находим индекс среди всех group-cell (кроме add)
            var cells = document.querySelectorAll("#groupsContainer .group-cell:not(.group-cell-add)");
            for (var i = 0; i < cells.length; i++) {
              if (cells[i] === cell) { groupIndex = i; break; }
            }
            break;
          }
          cell = cell.parentNode;
        }
        // Не даём DnD увидеть правую кнопку как начало перетаскивания:
        // DnD слушает только ЛКМ (e.button !== 0 - выход), так что тихо.
        showGroupsCtxMenu(x, y, groupIndex);
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

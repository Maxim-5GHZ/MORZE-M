/* ==========================================================================
   МОДУЛЬ: ПОЛИФИЛЫ И СОВМЕСТИМОСТЬ (DEBIAN 8 / ASTRA LINUX / FIREFOX 43)
   - innerText для старых Gecko;
   - DOM-хелперы: findAncestor(), setUiText(), hasClass/addClass/removeClass;
   - ввод короткого нуля (Ø) сочетанием 0 и -;
   - фоновый таймер Web Worker (обход троттлинга) с fallback на setTimeout
     и отменой незаконченных ожиданий (workerSleepCancel).
   ВАЖНО: Worker создаётся ТОЛЬКО из Blob + createObjectURL — внешний файл
   worker'а с флешки (file://) будет заблокирован политикой same-origin.
   ========================================================================== */

if (!("innerText" in document.createElement("div"))) {
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    get: function(){ return this.textContent; },
    set: function(val){ this.textContent = val; },
    configurable: true, enumerable: true
  });
}

function findAncestor(el, cls) {
  while (el && el !== document) {
    if (el.className && el.className.indexOf(cls) !== -1) return el;
    el = el.parentNode;
  }
  return null;
}

function setUiText(idOrElem, text) {
  var el = typeof idOrElem === "string" ? document.getElementById(idOrElem) : idOrElem;
  if (el) el.textContent = text;
}

// РАБОТА С КЛАССАМИ ЧЕРЕЗ className (без classList - правило проекта: Gecko 38/ES5).
// Токены сравниваются с пробелами по краям, чтобы "open" не совпал с "opened".
function hasClass(el, cls) {
  return !!el && (" " + el.className + " ").indexOf(" " + cls + " ") !== -1;
}

function addClass(el, cls) {
  if (!el || hasClass(el, cls)) return;
  el.className = (el.className ? el.className.replace(/\s+$/, "") + " " : "") + cls;
}

function removeClass(el, cls) {
  if (!el) return;
  el.className = (" " + el.className + " ").split(" " + cls + " ").join(" ")
    .replace(/^\s+|\s+$/g, "");
}

// РЕАЛИЗАЦИЯ 1.2 В: ВВОД КОРОТКОГО НУЛЯ (Ø) ЧЕРЕЗ 0 И -
var isZeroKeyPressed = false;
var isMinusKeyPressed = false;
var lastZeroPressTime = 0;
var lastMinusPressTime = 0;
var CHORD_TOLERANCE_MS = 180; // Временное окно одновременности

function isZeroKeyCode(code) {
  return code === 48 || code === 96; // Основной '0' или Numpad 0
}

function isMinusKeyCode(code) {
  return code === 189 || code === 173 || code === 109; // '-' в Firefox/Standard и NumpadSubtract
}

function replaceTextAtCursor(target, replacement, replaceCharsBack) {
  replaceCharsBack = replaceCharsBack || 0;
  var start = target.selectionStart;
  var end = target.selectionEnd;
  var val = target.value;

  if (typeof start === "number" && typeof end === "number") {
    var actualStart = Math.max(0, start - replaceCharsBack);
    var before = val.substring(0, actualStart);
    var after = val.substring(end);
    target.value = before + replacement + after;
    var newPos = actualStart + replacement.length;
    target.setSelectionRange(newPos, newPos);
  } else {
    target.value += replacement;
  }

  // Генерация события input для пересчёта валидации и генератора
  try {
    var evt = document.createEvent("Event");
    evt.initEvent("input", true, true);
    target.dispatchEvent(evt);
  } catch (ex) {
    if (target.oninput) target.oninput();
  }
}

function attachShortZeroHandler(elem) {
  if (!elem || elem.__shortZeroAttached) return;
  elem.__shortZeroAttached = true;

  elem.addEventListener("keydown", function (e) {
    var kc = e.keyCode || e.which;
    var now = Date.now();

    if (isZeroKeyCode(kc)) {
      isZeroKeyPressed = true;
      lastZeroPressTime = now;

      // Если в этот момент уже зажат минус, либо минус был нажат менее CHORD_TOLERANCE_MS назад
      if (isMinusKeyPressed || (now - lastMinusPressTime <= CHORD_TOLERANCE_MS)) {
        if (e.preventDefault) e.preventDefault();
        var eraseCount = (now - lastMinusPressTime <= CHORD_TOLERANCE_MS) ? 1 : 0;
        replaceTextAtCursor(elem, "Ø", eraseCount);
        lastZeroPressTime = 0;
        lastMinusPressTime = 0;
        return;
      }
    } else if (isMinusKeyCode(kc)) {
      isMinusKeyPressed = true;
      lastMinusPressTime = now;

      // Если в этот момент уже зажат 0, либо 0 был нажат менее CHORD_TOLERANCE_MS назад
      if (isZeroKeyPressed || (now - lastZeroPressTime <= CHORD_TOLERANCE_MS)) {
        if (e.preventDefault) e.preventDefault();
        var eraseCount2 = (now - lastZeroPressTime <= CHORD_TOLERANCE_MS) ? 1 : 0;
        replaceTextAtCursor(elem, "Ø", eraseCount2);
        lastZeroPressTime = 0;
        lastMinusPressTime = 0;
        return;
      }
    }
  }, false);

  elem.addEventListener("keyup", function (e) {
    var kc = e.keyCode || e.which;
    if (isZeroKeyCode(kc)) isZeroKeyPressed = false;
    if (isMinusKeyCode(kc)) isMinusKeyPressed = false;
  }, false);

  // Комбинированная автозамена: если ввод 0- или -0 проскочил
  elem.addEventListener("input", function () {
    var val = this.value;
    if (val.indexOf("0-") !== -1 || val.indexOf("-0") !== -1) {
      var s = this.selectionStart;
      this.value = val.replace(/0-|-0/g, "Ø");
      if (typeof s === "number") {
        var diff = val.length - this.value.length;
        this.setSelectionRange(Math.max(0, s - diff), Math.max(0, s - diff));
      }
    }
  }, false);
}

// Прикрепление слушателя ко всем существующим статичным полям ввода.
// Ячейки бланка (#groupsContainer .group-input-val) сюда НЕ входят: их ввод,
// аккорд 0+- и навигацию обслуживают 3 делегированных слушателя контейнера
// (initBlankDelegation в rx-trainer.js) - те же глобалы isZeroKeyPressed и co.
function setupShortZeroHandlers() {
  var inputs = [
    document.getElementById("customCharset"),
    document.getElementById("accentCharset"),
    document.getElementById("monoCharInput"),
    document.getElementById("txtUserInput")
  ];
  for (var i = 0; i < inputs.length; i++) {
    if (inputs[i]) attachShortZeroHandler(inputs[i]);
  }
}

var bgTimerWorker = null;
var workerTimerSeq = 0;
// id -> { cb:Function, timer:Number|null }. timer заполняется только в fallback'е
// на setTimeout; для Worker-таймера отмена шлёт в воркер { action: "cancel" }.
var pendingWorkerCallbacks = {};

try {
  var workerBlob = new Blob(
    ["var timers={};self.onmessage=function(e){if(e.data.action==='start'){timers[e.data.id]=setTimeout(function(){self.postMessage({id:e.data.id});delete timers[e.data.id];},e.data.ms);}else if(e.data.action==='cancel'){if(timers[e.data.id]){clearTimeout(timers[e.data.id]);delete timers[e.data.id];}}};"],
    { type: "application/javascript" }
  );
  var workerUrl = window.URL.createObjectURL(workerBlob);
  bgTimerWorker = new Worker(workerUrl);
  bgTimerWorker.onmessage = function (e) {
    var entry = pendingWorkerCallbacks[e.data.id];
    if (entry) { delete pendingWorkerCallbacks[e.data.id]; entry.cb(); }
  };
} catch (err) {
  bgTimerWorker = null;
}

// holder (необязательно) получает поле id - чтобы таймер можно было отменить
// до истечения срока (workerSleepCancel).
function workerSleep(ms, holder) {
  var delay = Math.max(1, Math.round(ms));
  return new Promise(function (resolve) {
    var id = ++workerTimerSeq;
    if (holder) holder.id = id;
    if (!bgTimerWorker) {
      var entry = { cb: resolve, timer: null };
      pendingWorkerCallbacks[id] = entry;
      entry.timer = setTimeout(function () {
        delete pendingWorkerCallbacks[id];
        resolve();
      }, delay);
      return;
    }
    pendingWorkerCallbacks[id] = { cb: resolve, timer: null };
    try {
      bgTimerWorker.postMessage({ action: "start", id: id, ms: delay });
    } catch (e) {
      delete pendingWorkerCallbacks[id];
      setTimeout(resolve, delay);
    }
  });
}

// ОТМЕНА ОЖИДАЮЩЕГО СНА: промис не выполняется никогда (цепочка-«хвост» умирает
// и собирается сборщиком мусора), воркер сбрасывает свой таймер.
function workerSleepCancel(id) {
  if (!id || !pendingWorkerCallbacks[id]) return;
  var entry = pendingWorkerCallbacks[id];
  delete pendingWorkerCallbacks[id];
  if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; return; }
  if (bgTimerWorker) {
    try { bgTimerWorker.postMessage({ action: "cancel", id: id }); } catch (e) {}
  }
}

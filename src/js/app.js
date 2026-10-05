/* ==========================================================================
   МОДУЛЬ: ИНИЦИАЛИЗАЦИЯ И ОБЩИЙ КАРКАС ПРИЛОЖЕНИЯ (APP)
   - таблица кодов (карточки знаков), переключение вкладок;
   - двусторонняя синхронизация слайдеров и подписей;
   - часы на индикаторе;
   - стартовый запуск модулей (boot-секция в конце файла).
   ========================================================================== */
var isCardPlaying = false;
function renderStudyTable() {
  var grid = document.getElementById("studyGrid");
  grid.innerHTML = "";
  for (var i = 0; i < MORSE_DB.length; i++) {
    (function (item) {
      var c = document.createElement("div");
      c.className = "morse-card";
      c.innerHTML = '<div class="card-fill-gauge"></div><div class="sym">' + item.ch + '</div><div class="code">' + item.code + '</div><div class="mnemonic">' + item.mn + '</div>';

      c.onclick = function () {
        if (rxActive || isCardPlaying) return;
        isCardPlaying = true;
        grid.className += " cards-locked";
        c.className += " playing";
        initAudio();

        var t = getStudyAtomTimings();
        var gauge = c.querySelector(".card-fill-gauge");
        var totalDurationMs = 0;
        for (var k = 0; k < item.code.length; k++) {
          totalDurationMs += item.code[k] === "." ? t.dotMs : t.dashMs;
          if (k < item.code.length - 1) totalDurationMs += t.elemPauseMs;
        }

        gauge.style.transition = "width " + totalDurationMs + "ms linear";
        requestAnimationFrame(function () { gauge.style.width = "100%"; });

        var s = 0;
        function nextSym() {
          if (s >= item.code.length) {
            setTimeout(function () {
              gauge.style.transition = "none";
              gauge.style.width = "0%";
              c.className = c.className.replace(/\bplaying\b/g, "").trim();
              grid.className = grid.className.replace(/\bcards-locked\b/g, "").trim();
              isCardPlaying = false;
            }, 40);
            return;
          }
          toneOn("RX");
          workerSleep(item.code[s] === "." ? t.dotMs : t.dashMs).then(function () {
            toneOff("RX");
            if (s < item.code.length - 1) return workerSleep(t.elemPauseMs);
          }).then(function () { s++; nextSym(); });
        }
        nextSym();
      };
      grid.appendChild(c);
    })(MORSE_DB[i]);
  }
}

function switchTab(tabId, el) {
  var tabs = document.querySelectorAll(".tab-btn");
  for (var i = 0; i < tabs.length; i++) tabs[i].className = "tab-btn";
  var contents = document.querySelectorAll(".content-block");
  for (var j = 0; j < contents.length; j++) contents[j].className = "content-block";
  el.className += " active";
  document.getElementById(tabId).className += " active";
  applyAudioParamsNow();
  if (tabId === "tab-rx") refreshAllAutoGrows();
}

// Ограничение частоты применения звука при перетаскивании ползунков:
// label обновляется на каждый input, а в аудио-параметры пишем не чаще 50 мс
// с гарантией финального значения (trailing call).
function throttle(fn, ms) {
  var last = 0, timer = null, self, args;
  return function () {
    self = this; args = arguments;
    var nowTime = Date.now();
    var remaining = ms - (nowTime - last);
    if (remaining <= 0) {
      last = nowTime;
      if (timer) { clearTimeout(timer); timer = null; }
      fn.apply(self, args);
    } else if (!timer) {
      timer = setTimeout(function () {
        last = Date.now(); timer = null;
        fn.apply(self, args);
      }, remaining);
    }
  };
}
var throttleApply = throttle(applyAudioParamsNow, 50);

function sync(rId, lId, unit, scale) {
  scale = scale || 1;
  var r = document.getElementById(rId), l = document.getElementById(lId);
  if (!r || !l) return;
  var handler = function () {
    var val = scale === 1 ? r.value : (r.value / scale).toFixed(1);
    setUiText(l, val + " " + unit);
    throttleApply();
  };
  r.oninput = handler;
  r.onchange = handler;
}

var rngChar = document.getElementById("rngCharSpeed");
var rngFarn = document.getElementById("rngFarnSpeed");
var rngGrpPause = document.getElementById("rngGroupPause");
var rngStudy = document.getElementById("rngStudySpeed");

// РЕЖИМ ОТОБРАЖЕНИЯ СКОРОСТИ: 'WPM' - знаки в минуту, 'MS' - длительность точки в мс.
// speedCharWpm / speedFarnWpm / speedGrpMult - НОРМИЗОВАННОЕ состояние движка, всегда
// в зн/мин и в коэффициентах пауз. Поля ввода - лишь представление этого состояния
// в выбранных единицах, поэтому переключение тумблера не влияет на звук.
var speedUnitMode = 'WPM';
var speedCharWpm = 70, speedFarnWpm = 50, speedGrpMult = 1.0;
// РЕЖИМ ПАУЗ ВНУТРИ РЕЖИМА ТОЧКА (МС): 'MS' - интервал и межгрупповая пауза
// в миллисекундах (прежнее поведение), 'DOTS' - в кратности точке (точек).
// Действует только при speedUnitMode === 'MS' и только на два поля:
// интервал и пауза между группами. Скорость посылки всегда остаётся в мс.
var pauseUnitMode = 'MS';
var CHAR_WPM_MIN = 30, CHAR_WPM_MAX = 200;
var FARN_WPM_MIN = 20;
var GRP_MULT_MIN = 1.0, GRP_MULT_MAX = 5.0;
// Поле ввода, которое в данный момент редактируется: его value не перезаписывается
// при перерисовке, иначе стрелки числового поля «прыгают» через шаг.
var speedEditingEl = null;

// Стандарт PARIS в конвенции прибора: длительность точки T = 6000 / W (мс).
// Обратная формула: W = 6000 / T. Это ЕДИНСТВЕННЫЙ источник пересчёта единиц.
function wpmToDotMs(wpm) { return 6000.0 / wpm; }
function dotMsToWpm(ms) { return 6000.0 / ms; }
function clampNum(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Межгрупповая пауза в мс по той же модели, что и getLiveAtomTimings().
function groupPauseMsByMult(mult) {
  return Math.max(0, wpmToDotMs(speedFarnWpm) * 7 * mult - wpmToDotMs(speedCharWpm));
}

// Тумблер пауз активен: режим ТОЧКА (МС) + выбраны ТОЧКИ.
function pauseDotsActive() {
  return speedUnitMode === 'MS' && pauseUnitMode === 'DOTS';
}
// Полные интервалы в кратности точке (включая замыкающий межэлементный такт):
// K_межбукв = 3*char/farn (стандарт 3), K_межгрупп = 7*mult*char/farn (стандарт 7).
function charGapDots() {
  if (!(speedFarnWpm > 0)) return 3;
  return 3 * speedCharWpm / speedFarnWpm;
}
function groupGapDots() {
  if (!(speedFarnWpm > 0)) return 7;
  return 7 * speedGrpMult * speedCharWpm / speedFarnWpm;
}
// Подпись к K: стандарт / ниже стандарта / без пометки (выше стандарта).
function gapStdHint(k, std) {
  if (Math.abs(k - std) < 0.05) return " (стандарт)";
  if (k < std) return " (ниже стандарта)";
  return "";
}

// Приведение нормализованного состояния к допустимым пределам + защита связки
// Фарнсворта. ОКРУГЛЕНИЯ ЗДЕСЬ НАМЕРЕННО НЕТ: состояние хранит точное
// значение, иначе переключение «зн/мин <-> мс» перестаёт быть чистой
// конвертацией (70.588 зн/мин превратился бы в 71, а обратно - в 85 мс
// вместо исходных 85.71). Округление живёт только в отображении.
// Паузы КОРОЧЕ стандарта разрешены: K_межбукв до 1 (farn до 3*char),
// K_межгрупп до 1 (mult до farn/(7*char)). Пол - физический: при K < 1 пауза
// ушла бы в минус (в тракте она всё равно упёрлась бы в 0 через Math.max,
// а подпись врала бы). Старые сохранения (farn <= char, mult >= 1)
// заведомо внутри новых границ - молча подхватываются.
function normalizeSpeedState() {
  if (!(speedCharWpm > 0)) speedCharWpm = 70;
  speedCharWpm = clampNum(speedCharWpm, CHAR_WPM_MIN, CHAR_WPM_MAX);
  if (!(speedFarnWpm > 0)) speedFarnWpm = FARN_WPM_MIN;
  speedFarnWpm = clampNum(speedFarnWpm, FARN_WPM_MIN, 3 * speedCharWpm);
  if (!(speedGrpMult > 0)) speedGrpMult = GRP_MULT_MIN;
  var multFloor = speedFarnWpm / (7 * speedCharWpm);
  if (speedGrpMult < multFloor) speedGrpMult = multFloor;
  if (speedGrpMult > GRP_MULT_MAX) speedGrpMult = GRP_MULT_MAX;
}

// Пересчёт состояния -> поля ввода (min/max/step/value) и текстовые метки.
function renderSpeedControls() {
  normalizeSpeedState();
  var msMode = speedUnitMode === 'MS';
  var dotsMode = pauseDotsActive();
  var dotMs = wpmToDotMs(speedCharWpm);
  var farnDotMs = wpmToDotMs(speedFarnWpm);

  // Строка тумблера пауз видна только в режиме ТОЧКА (МС); его состояние
  // синхронизируем здесь же - единый источник истины (перерисовка после
  // восстановления из localStorage тоже проходит через эту функцию).
  try {
    var prow = document.getElementById("pauseUnitRow");
    if (prow) prow.style.display = msMode ? "" : "none";
    var ptg = document.getElementById("pauseUnitToggle");
    if (ptg) {
      if (pauseUnitMode === "MS") { if (ptg.className.indexOf("ms") === -1) ptg.className += " ms"; }
      else ptg.className = ptg.className.replace(/\s*ms\b/g, "");
    }
    var oD = document.getElementById("pauseUnitToggleOptDots"), oM = document.getElementById("pauseUnitToggleOptMs");
    if (oD) oD.className = "unit-toggle-opt" + (pauseUnitMode === "DOTS" ? " on" : "");
    if (oM) oM.className = "unit-toggle-opt" + (pauseUnitMode === "MS" ? " on" : "");
  } catch (e2) {}

  rngChar.min = msMode ? Math.round(wpmToDotMs(CHAR_WPM_MAX)) : CHAR_WPM_MIN;
  rngChar.max = msMode ? Math.round(wpmToDotMs(CHAR_WPM_MIN)) : CHAR_WPM_MAX;
  rngChar.step = 1;

  if (msMode) {
    // Режим ТОЧКА - инверсия шкалы: меньше миллисекунд, выше скорость.
    // Поле, которое сейчас редактируется, не перезаписываем: иначе браузерные
    // стрелки «прыгают» (поле уводит значение мимо того числа, что ввёл user).
    if (rngChar !== speedEditingEl) rngChar.value = Math.round(dotMs);
    setUiText("lblCharSpeed", Math.round(dotMs) + " мс");
    if (dotsMode) {
      // Интервал и пауза в кратности точке: K_межбукв (стандарт 3, пол 1),
      // K_межгрупп (стандарт 7, пол 1). Ниже стандарта - можно,
      // ниже пола - не даст нормализация. Скорость посылки остаётся в мс.
      var kChar = charGapDots();
      var kGrp = groupGapDots();
      // ВАЖНО: шаг "any", а не 0.5. Значение округляем до 0.1, а база шага -
      // дробный min (напр. 24.1): (37.9-24.1)/0.5 не целое -> stepMismatch,
      // и Firefox подсвечивает поле красным (:-moz-ui-invalid). С "any"
      // проверки шага нет, стрелки идут по 1 точке, дробный ввод свободный.
      // Границы целочисленные/ceil: округлённое значение всегда внутри,
      // иначе снова красное (range underflow/overflow).
      var kCharMax = 3 * speedCharWpm / FARN_WPM_MIN;
      rngFarn.min = 1;
      rngFarn.max = Math.ceil(kCharMax * 10) / 10;
      rngFarn.step = "any";
      if (rngFarn !== speedEditingEl) rngFarn.value = clampNum(Math.round(kChar * 10) / 10, 1, rngFarn.max);
      var kGrpMax = 35 * speedCharWpm / speedFarnWpm;
      rngGrpPause.min = 1;
      rngGrpPause.max = Math.ceil(kGrpMax * 10) / 10;
      rngGrpPause.step = "any";
      if (rngGrpPause !== speedEditingEl) {
        rngGrpPause.value = clampNum(Math.round(kGrp * 10) / 10, 1, rngGrpPause.max);
      }
      var kCharTxt = (Math.round(kChar * 10) / 10).toFixed(1);
      var kGrpTxt = (Math.round(kGrp * 10) / 10).toFixed(1);
      setUiText("lblFarnSpeed", kCharTxt + " точек (пауза " + Math.round(getLiveAtomTimings().charPauseMs) + " мс)" + gapStdHint(kChar, 3));
      setUiText("lblGroupPause", kGrpTxt + " точек (пауза " + Math.round(groupPauseMsByMult(speedGrpMult)) + " мс)" + gapStdHint(kGrp, 7));
    } else {
      rngFarn.step = 1;
      rngGrpPause.step = 1;
      // Фарнсворт быстрее посылки разрешён (до 3*char): интервал короче
      // стандарта. min целочисленный вниз (floor): округлённое значение поля
      // всегда внутри [min, max], иначе Firefox даст красное (underflow).
      rngFarn.min = Math.floor(dotMs / 3);
      rngFarn.max = Math.round(wpmToDotMs(FARN_WPM_MIN));
      if (rngFarn !== speedEditingEl) rngFarn.value = clampNum(Math.round(farnDotMs), rngFarn.min, rngFarn.max);
      var grpFloor = speedFarnWpm / (7 * speedCharWpm);
      rngGrpPause.min = Math.round(groupPauseMsByMult(grpFloor));  // всегда 0: пол K=1
      rngGrpPause.max = Math.round(groupPauseMsByMult(GRP_MULT_MAX));
      if (rngGrpPause !== speedEditingEl) {
        rngGrpPause.value = clampNum(Math.round(groupPauseMsByMult(speedGrpMult)), rngGrpPause.min, rngGrpPause.max);
      }
      setUiText("lblFarnSpeed", Math.round(farnDotMs) + " мс");
      setUiText("lblGroupPause", Math.round(groupPauseMsByMult(speedGrpMult)) + " мс");
    }
  } else {
    // Поля показывают округлённое представление, состояние остаётся точным.
    // Фарнсворт до 3*char, множитель от динамического пола (K_межгрупп >= 1).
    // min целочисленный вниз: округлённое значение всегда внутри границ.
    rngFarn.step = 1;
    rngGrpPause.step = 1;
    var wpmGrpFloor = speedFarnWpm / (7 * speedCharWpm);
    rngChar.value = Math.round(speedCharWpm);
    rngFarn.min = FARN_WPM_MIN;
    rngFarn.max = Math.round(3 * speedCharWpm);
    rngFarn.value = clampNum(Math.round(speedFarnWpm), FARN_WPM_MIN, rngFarn.max);
    rngGrpPause.min = Math.floor(wpmGrpFloor * 10);
    rngGrpPause.max = GRP_MULT_MAX * 10;
    rngGrpPause.value = clampNum(Math.round(speedGrpMult * 10), rngGrpPause.min, rngGrpPause.max);
    var mTxt = speedGrpMult.toFixed(1);
    setUiText("lblCharSpeed", Math.round(speedCharWpm) + " зн/мин");
    setUiText("lblFarnSpeed", Math.round(speedFarnWpm) + " зн/мин");
    setUiText("lblGroupPause", "x" + mTxt + (mTxt === "1.0" ? " (стандарт)" : ""));
  }
  updateOverallSpeed();
  throttleApply();
}

// Разбор значения поля ввода -> нормализованное состояние (без перерисовки).
// Возвращает false, если в поле пусто или значение не число.
// Конвертация ЕДИНСТВЕННАЯ И ТОЧНАЯ: мс -> зн/мин по формуле W = 6000 / T,
// без округления, поэтому переключение единиц ничего не меняет по существу.
function readSpeedInput(el, kind) {
  var v = parseFloat(el.value);
  if (isNaN(v) || el.value === "") return false;
  if (speedUnitMode === 'MS') {
    if (kind === 'char') speedCharWpm = dotMsToWpm(v);
    else if (kind === 'farn') {
      // В точках поле - полный межбуквенный интервал K (стандарт 3, пол 1):
      // farn = 3*char/K. Ниже 1 не пускаем (там уже отрицательная пауза),
      // остальное выровняет нормализация.
      if (pauseUnitMode === 'DOTS') {
        if (v < 1) v = 1;
        speedFarnWpm = 3 * speedCharWpm / v;
      } else speedFarnWpm = dotMsToWpm(v);
    }
    else {
      // В точках поле - полный межгрупповой интервал K (стандарт 7, пол 1):
      // mult = K*farn/(7*char). Пол и потолок держит нормализация.
      if (pauseUnitMode === 'DOTS') {
        if (!(speedCharWpm > 0)) speedCharWpm = 70;
        if (!(speedFarnWpm > 0)) speedFarnWpm = speedCharWpm;
        speedGrpMult = v * speedFarnWpm / (7 * speedCharWpm);
      }
      else speedGrpMult = (v + wpmToDotMs(speedCharWpm)) / (7 * wpmToDotMs(speedFarnWpm));
    }
  } else {
    if (kind === 'char') speedCharWpm = v;
    else if (kind === 'farn') speedFarnWpm = v;
    else speedGrpMult = v / 10;
  }
  return true;
}

function applySpeedInput(el, kind) {
  speedEditingEl = el;
  readSpeedInput(el, kind);
  renderSpeedControls();
  speedEditingEl = null;
}

function toggleSpeedUnit() {
  speedUnitMode = speedUnitMode === 'WPM' ? 'MS' : 'WPM';
  var tg = document.getElementById("unitToggle");
  var oW = document.getElementById("unitToggleOptWpm");
  var oM = document.getElementById("unitToggleOptMs");
  if (tg) {
    if (speedUnitMode === 'MS') tg.className = tg.className.replace(/\s*ms\b/, "") + " ms";
    else tg.className = tg.className.replace(/\s*ms\b/, "");
  }
  if (oW) oW.className = "unit-toggle-opt" + (speedUnitMode === 'WPM' ? " on" : "");
  if (oM) oM.className = "unit-toggle-opt" + (speedUnitMode === 'MS' ? " on" : "");
  // Смена единиц - чистая конвертация: сбрасываем «редактируемое» поле, чтобы
  // значения в полях пересчитались из того же самого состояния.
  // Видимость и подсветка тумблера пауз - в renderSpeedControls().
  speedEditingEl = null;
  renderSpeedControls();
}

// ТУМБЛЕР ПАУЗ (только в режиме ТОЧКА): ТОЧКИ <-> МС для интервала и паузы
// между группами. Скорость посылки не затрагивается. Чистая конвертация:
// нормализованное состояние (char/farn/mult) не меняется, меняется лишь
// представление двух полей. Подсветка и видимость - в renderSpeedControls().
function togglePauseUnit() {
  pauseUnitMode = pauseUnitMode === 'DOTS' ? 'MS' : 'DOTS';
  speedEditingEl = null;
  renderSpeedControls();
}

// ПЕРЕКЛЮЧЕНИЕ «ЧИСЛОВОЙ ВВОД / ПОЛЗУНКИ» в блоке «Скоростные нормативы».
// Набор полей один и тот же - меняется только тип элемента (number <-> range),
// поэтому обработчики, границы и подписи остаются теми же. Состояние движка
// при переключении не меняется: перед сменой типа незакоммиченное значение поля
// переносится в нормализованное состояние.
var SPEED_FIELDS = [
  { id: "rngCharSpeed", kind: "char" },
  { id: "rngFarnSpeed", kind: "farn" },
  { id: "rngGroupPause", kind: "grp" }
];
var speedInputIsRange = false;

function applySpeedInputType() {
  for (var i = 0; i < SPEED_FIELDS.length; i++) {
    var el = document.getElementById(SPEED_FIELDS[i].id);
    if (!el) continue;
    if (speedInputIsRange) {
      el.type = "range";
      el.className = el.className.replace(/\s*\bnum-field\b/g, "");
      el.removeAttribute("inputmode");
    } else {
      el.type = "number";
      if (!/\bnum-field\b/.test(el.className)) el.className = (el.className + " num-field").replace(/^\s+/, "");
      el.setAttribute("inputmode", "numeric");
    }
  }
  var btn = document.getElementById("toggleInputTypeBtn");
  if (btn) {
    btn.className = "toggle-input-btn" + (speedInputIsRange ? " active" : "");
    btn.textContent = speedInputIsRange ? "СТРЕЛОЧКИ" : "ПОЛЗУНКИ";
    btn.title = speedInputIsRange
      ? "Вернуть числовой ввод (стрелочки)"
      : "Переключить между числовым вводом (стрелочки) и ползунками (range)";
  }
  renderSpeedControls();
}

function toggleSpeedInputType() {
  // Значение, введённое в числовое поле, фиксируем до смены типа элемента:
  // смена type может сбросить несохранённый текст поля.
  if (!speedInputIsRange) {
    for (var i = 0; i < SPEED_FIELDS.length; i++) {
      var el = document.getElementById(SPEED_FIELDS[i].id);
      if (el) readSpeedInput(el, SPEED_FIELDS[i].kind);
    }
  }
  speedInputIsRange = !speedInputIsRange;
  speedEditingEl = null;   // тип элемента сменился - значения надо пересчитать
  applySpeedInputType();
}

rngChar.oninput = function () { applySpeedInput(this, 'char'); };
rngChar.onchange = rngChar.oninput;

rngFarn.oninput = function () { applySpeedInput(this, 'farn'); };
rngFarn.onchange = rngFarn.oninput;

rngGrpPause.oninput = function () { applySpeedInput(this, 'grp'); };
rngGrpPause.onchange = rngGrpPause.oninput;

// Повторы групп и знаков тоже меняют общую скорость (повтор знака - акустический,
// он занимает время передачи, поэтому входит в расчёт).
["groupRepeat", "charRepeat"].forEach(function (id) {
  var sel = document.getElementById(id);
  if (!sel) return;
  var h = function () { updateOverallSpeed(); };
  sel.onchange = h;
  sel.oninput = h;
});

if (rngStudy) {
  rngStudy.oninput = function() {
    setUiText("lblStudySpeed", this.value + " зн/мин");
  };
  rngStudy.onchange = rngStudy.oninput;
}

// Кастомный выпадающий список «Профиль огибающей» с мини-осциллограммами в пунктах:
// нативный <select> не умеет рисовать SVG внутри <option> (в т.ч. в старых Gecko).
function rampSetValue(value, close) {
  var dd = document.getElementById("selRampShape");
  if (!dd) return;
  var li = dd.querySelector('.ramp-options li[data-value="' + value + '"]');
  if (!li) return;
  dd.value = value;
  var curSvg = document.getElementById("rampCurSvg");
  var curText = document.getElementById("rampCurText");
  var liSvg = li.querySelector("svg");
  var liText = li.querySelector("span");
  if (curSvg && liSvg) curSvg.innerHTML = liSvg.innerHTML;
  if (curText && liText) curText.textContent = liText.textContent;
  var items = dd.querySelectorAll(".ramp-options li");
  for (var i = 0; i < items.length; i++) items[i].className = items[i] === li ? "active" : "";
  if (close) { removeClass(dd, "open"); removeClass(dd, "up"); }
}

function rampDropdownToggle(ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  var dd = document.getElementById("selRampShape");
  if (!dd) return;
  if (hasClass(dd, "open")) removeClass(dd, "open");
  else rampDropdownOpen(dd);
}

function rampDropdownOpen(dd) {
  addClass(dd, "open");
  removeClass(dd, "up");
  var list = dd.querySelector(".ramp-options");
  if (!list || !dd.getBoundingClientRect || !getComputedStyle) return;
  var r = dd.getBoundingClientRect();
  var h = list.offsetHeight || list.scrollHeight || 0;
  var clipTop = 0, clipBottom = Infinity, el = dd.parentNode;
  while (el && el.nodeType === 1 && el !== document.body) {
    var ov = getComputedStyle(el).overflowY || "visible";
    if (ov === "hidden" || ov === "auto" || ov === "scroll") {
      var er = el.getBoundingClientRect();
      var eb = er.top + (el.clientHeight || er.bottom - er.top);
      if (eb < clipBottom) clipBottom = eb;
      if (er.top > clipTop) clipTop = er.top;
    }
    el = el.parentNode;
  }
  var vh = window.innerHeight || document.documentElement.clientHeight || 0;
  if (clipBottom > vh) clipBottom = vh;
  if (clipTop < 0) clipTop = 0;
  var down = clipBottom - r.bottom - 6;
  var up = r.top - clipTop - 6;
  if (down >= h) removeClass(dd, "up");
  else addClass(dd, "up");
}

function rampDropdownSelect(li, ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  rampSetValue(li.getAttribute("data-value"), true);
  applyAudioParamsNow();
}

function initRampDropdown() {
  var dd = document.getElementById("selRampShape");
  if (!dd) return;
  rampSetValue("hann", false);
  document.addEventListener("click", function (ev) {
    var el = ev.target, ddEl = document.getElementById("selRampShape");
    if (!ddEl) return;
    while (el) { if (el === ddEl) return; el = el.parentNode; }
    removeClass(ddEl, "open");
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" || ev.keyCode === 27) {
      var ddEl = document.getElementById("selRampShape");
      if (ddEl) removeClass(ddEl, "open");
    }
  });
}

sync("rngIambicSpeed", "lblIambicSpeed", "зн/мин");
sync("rngToneFreq", "lblToneFreq", "Гц");
sync("rngToneVol", "lblToneVol", "%");
sync("rngRampTime", "lblRampTime", "мс");
sync("rngQsbDepth", "lblQsbDepth", "%");
sync("rngQsbPeriod", "lblQsbPeriod", "сек", 10);
sync("rngNoiseVol", "lblNoiseVol", "%");
sync("rngQrmVol", "lblQrmVol", "%");
sync("rngTapeSpeed", "lblTapeSpeed", "px/s");

setInterval(function () {
  var d = new Date();
  var h = (d.getHours() < 10 ? "0" : "") + d.getHours();
  var m = (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  var s = (d.getSeconds() < 10 ? "0" : "") + d.getSeconds();
  setUiText("clock", h + ":" + m + ":" + s);
}, 1000);

setupShortZeroHandlers();
resizeCanvas();
// АВТОСОХРАНЕНИЕ (storage.js): раннее восстановление сырых значений и
// нормированного состояния скоростей ДО первой отрисовки бланка.
var __morzeRestored = null;
try { if (typeof morzeStoreRead === "function") __morzeRestored = morzeStoreRead(); } catch (e) { __morzeRestored = null; }
try { if (__morzeRestored && typeof morzeStoreApplyEarly === "function") morzeStoreApplyEarly(__morzeRestored); } catch (e) {}
renderStudyTable();
var __morzeHadGroups = false;
try { __morzeHadGroups = !!(__morzeRestored && __morzeRestored.groups && __morzeRestored.groups.length); } catch (e) { __morzeHadGroups = false; }
if (__morzeHadGroups) {
  try { renderGroupsFromList(__morzeRestored.groups, __morzeRestored.manuals); } catch (e) { try { uiGenerateGroupsTable(); } catch (e2) {} }
  try { document.getElementById("numGroups").value = String(__morzeRestored.groups.length); } catch (e) {}
  try { if (typeof setBlankImported === "function") setBlankImported(!!__morzeRestored.imported); } catch (e) {}
} else {
  uiGenerateGroupsTable();
}
initBlankDelegation(); // 3 делегированных слушателя бланка (FF38) - до первой отрисовки групп
initGroupsDragAndDrop();
initTextImport();
refreshAllAutoGrows();
try { if (typeof updateAccentWeightLabel === "function") updateAccentWeightLabel(); } catch (e) {}
initRampDropdown();
initRxHotkeys();
if (__morzeRestored) {
  try { if (typeof morzeStoreApplyLate === "function") morzeStoreApplyLate(__morzeRestored); } catch (e) { applySpeedInputType(); renderSpeedControls(); }
} else {
  applySpeedInputType();     // согласует тип полей ввода с подписью на кнопке
  renderSpeedControls();   // нормализует стартовые значения и заполняет поля ввода
}
try { if (typeof morzeStoreBindAuto === "function") morzeStoreBindAuto(); } catch (e) {}
requestAnimationFrame(renderUndulator);

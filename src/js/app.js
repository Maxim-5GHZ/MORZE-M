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

function updateSpeedControls() {
  var charVal = parseInt(rngChar.value, 10);
  rngFarn.max = charVal;
  if (parseInt(rngFarn.value, 10) > charVal) {
    rngFarn.value = charVal;
    setUiText("lblFarnSpeed", charVal + " зн/мин");
  }
  setUiText("lblCharSpeed", charVal + " зн/мин");
  throttleApply();
}

rngChar.oninput = updateSpeedControls;
rngChar.onchange = updateSpeedControls;

rngFarn.oninput = function () {
  setUiText("lblFarnSpeed", rngFarn.value + " зн/мин");
  throttleApply();
};
rngFarn.onchange = rngFarn.oninput;

rngGrpPause.oninput = function () {
  var mult = (parseFloat(this.value) / 10).toFixed(1);
  var suffix = mult === "1.0" ? " (стандарт)" : "";
  setUiText("lblGroupPause", "x" + mult + suffix);
};
rngGrpPause.onchange = rngGrpPause.oninput;

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
  if (close) { dd.classList.remove("open"); dd.classList.remove("up"); }
}

function rampDropdownToggle(ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  var dd = document.getElementById("selRampShape");
  if (!dd) return;
  if (dd.classList.contains("open")) dd.classList.remove("open");
  else rampDropdownOpen(dd);
}

function rampDropdownOpen(dd) {
  dd.classList.add("open");
  dd.classList.remove("up");
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
  if (down >= h) dd.classList.remove("up");
  else dd.classList.add("up");
}

function rampDropdownSelect(li, ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  rampSetValue(li.getAttribute("data-value"), true);
  applyAudioParamsNow();
}

function initRampDropdown() {
  var dd = document.getElementById("selRampShape");
  if (!dd) return;
  rampSetValue("rc", false);
  document.addEventListener("click", function (ev) {
    var el = ev.target, ddEl = document.getElementById("selRampShape");
    if (!ddEl) return;
    while (el) { if (el === ddEl) return; el = el.parentNode; }
    ddEl.classList.remove("open");
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" || ev.keyCode === 27) {
      var ddEl = document.getElementById("selRampShape");
      if (ddEl) ddEl.classList.remove("open");
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
renderStudyTable();
uiGenerateGroupsTable();
initGroupsDragAndDrop();
refreshAllAutoGrows();
initRampDropdown();
requestAnimationFrame(renderUndulator);

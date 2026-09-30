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

function sync(rId, lId, unit, scale) {
  scale = scale || 1;
  var r = document.getElementById(rId), l = document.getElementById(lId);
  if (!r || !l) return;
  var handler = function () {
    var val = scale === 1 ? r.value : (r.value / scale).toFixed(1);
    setUiText(l, val + " " + unit);
    applyAudioParamsNow();
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
  applyAudioParamsNow();
}

rngChar.oninput = updateSpeedControls;
rngChar.onchange = updateSpeedControls;

rngFarn.oninput = function () {
  setUiText("lblFarnSpeed", rngFarn.value + " зн/мин");
  applyAudioParamsNow();
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
requestAnimationFrame(renderUndulator);

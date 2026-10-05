/* ==========================================================================
   МОДУЛЬ: АВТОСОХРАНЕНИЕ СОСТОЯНИЙ В LOCALSTORAGE
   - сохранение включено по умолчанию, без меню и переключателей;
   - каждый доступ к хранилищу закрыт try-catch: на устройствах с запретом
     localStorage (приватный режим, file://, политики) изделие просто
     работает без сохранения;
   - кнопка "НАСТРОЙКИ ПО УМОЛЧАНИЮ" (вкладка 4) очищает хранилище и
     возвращает заводские значения.
   Совместимость: только ES5 (Firefox 38): var, function, без let/const,
   без стрелок, без Object.assign, без classList/dataset, без includes.
   ========================================================================== */
var MORZE_STORE_KEY = "morze-m-settings-v1";
var MORZE_STORE_VERSION = 1;
var MORZE_STORE_SAVE_DELAY = 500;
var morzeStoreSaveTimer = null;
var morzeStoreSuspend = 0;
var morzeStoreBound = false;

function morzeStoreEl(id) {
  try { return document.getElementById(id); } catch (e) { return null; }
}

function morzeStoreGetVal(id, def) {
  var el = morzeStoreEl(id);
  if (!el) return def;
  try { if (el.value !== undefined && el.value !== null) return el.value; } catch (e) {}
  return def;
}

function morzeStoreGetChecked(id, def) {
  var el = morzeStoreEl(id);
  if (!el) return def;
  try { return !!el.checked; } catch (e) { return def; }
}

function morzeStoreSetVal(id, v) {
  if (v === undefined || v === null) return;
  var el = morzeStoreEl(id);
  if (!el) return;
  try { el.value = v; } catch (e) {}
}

function morzeStoreSetChecked(id, b) {
  var el = morzeStoreEl(id);
  if (!el) return;
  try { el.checked = !!b; } catch (e) {}
}

/* --- Безопасный доступ к localStorage: любой запрет глушится --- */
function morzeStoreLsGet() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return null;
    try { return localStorage.getItem(MORZE_STORE_KEY); } catch (e) { return null; }
  } catch (e) { return null; }
}

function morzeStoreLsSet(s) {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return false;
    try { localStorage.setItem(MORZE_STORE_KEY, s); return true; } catch (e) { return false; }
  } catch (e) { return false; }
}

function morzeStoreLsDel() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return;
    try { localStorage.removeItem(MORZE_STORE_KEY); } catch (e) {}
  } catch (e) {}
}

/* --- Журнал результатов экзаменов --- */
var MORZE_EXAM_KEY = "morze-m-exam-log-v1";
function examLogAppend(errors, total, percent, mark) {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return;
    var log = [];
    var raw = localStorage.getItem(MORZE_EXAM_KEY);
    if (raw) {
      try { log = JSON.parse(raw); } catch (e) { log = []; }
    }
    // сохраняем последние 50 результатов
    log.push({ errors: errors, total: total, percent: percent, mark: mark, date: new Date().toLocaleString() });
    if (log.length > 50) log.splice(0, log.length - 50);
    localStorage.setItem(MORZE_EXAM_KEY, JSON.stringify(log));
  } catch (e) {}
}
function examLogRead() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return null;
    var raw = localStorage.getItem(MORZE_EXAM_KEY);
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { return null; }
    }
    return null;
  } catch (e) { return null; }
}
function examLogClear() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return;
    localStorage.removeItem(MORZE_EXAM_KEY);
  } catch (e) {}
}

/* --- Чтение: битая строка / чужая версия -> null (заводские) --- */
function morzeStoreRead() {
  var raw = morzeStoreLsGet();
  if (!raw) return null;
  try {
    var o = JSON.parse(raw);
    if (!o || o.v !== MORZE_STORE_VERSION) return null;
    return o;
  } catch (e) { return null; }
}

/* --- Заводские значения: один в один как value=/checked в index.html --- */
function morzeStoreFactory() {
  return {
    v: MORZE_STORE_VERSION,
    tapeSpeed: "120",
    tapeSource: "ALL",
    customCharset: "А Б В Г Д Е Ж З И Й К Л М Н О П Р С Т У Ф Х Ц Ч Ш Щ Ъ Ы Ь Э Ю Я",
    accentCharset: "",
    accentWeight: "3",
    groupLength: "5",
    numGroups: "12",
    groupRepeat: "1",
    charRepeat: "1",
    preamble: "SINGLE_V",
    postamble: "SINGLE_K",
    monoOnly: false,
    keepManual: true,
    monoCount: "3",
    studySpeed: "70",
    iambicSpeed: "70",
    iambicSource: "KEYS",
    toneFreq: "700",
    toneVol: "70",
    rampTime: "10",
    rampShape: "hann",
    qsbDepth: "50",
    qsbPeriod: "50",
    noiseVol: "35",
    qrmVol: "25",
    quickNoise: false,
    importLen: "5",
    importStrict: true,
    importPad: true,
    importSync: true,
    userInput: "",
    speedUnitMode: "WPM",
    pauseUnitMode: "MS",
    speedRange: false,
    charWpm: 70,
    farnWpm: 50,
    grpMult: 1.0,
    keyerMode: "straight",
    iambicSrc: "KEYS",
    txHistory: "",
    groups: null,
    manuals: null,
    imported: false
  };
}

/* --- Сбор текущего состояния в плоский объект --- */
function morzeStoreCollect() {
  var o = { v: MORZE_STORE_VERSION };
  try {
    o.tapeSpeed = morzeStoreGetVal("rngTapeSpeed", "120");
    o.tapeSource = morzeStoreGetVal("selTapeSource", "ALL");
    o.customCharset = morzeStoreGetVal("customCharset", "");
    o.accentCharset = morzeStoreGetVal("accentCharset", "");
    o.accentWeight = morzeStoreGetVal("rngAccentWeight", "3");
    o.groupLength = morzeStoreGetVal("groupLength", "5");
    o.numGroups = morzeStoreGetVal("numGroups", "12");
    o.groupRepeat = morzeStoreGetVal("groupRepeat", "1");
    o.charRepeat = morzeStoreGetVal("charRepeat", "1");
    o.preamble = morzeStoreGetVal("selPreambleMode", "SINGLE_V");
    o.postamble = morzeStoreGetVal("selPostambleMode", "SINGLE_K");
    o.monoOnly = morzeStoreGetChecked("chkMonoOnly", false);
    o.keepManual = morzeStoreGetChecked("chkKeepManual", true);
    o.monoCount = morzeStoreGetVal("monoCharCount", "3");
    o.studySpeed = morzeStoreGetVal("rngStudySpeed", "70");
    o.iambicSpeed = morzeStoreGetVal("rngIambicSpeed", "70");
    o.iambicSource = morzeStoreGetVal("selIambicInputSource", "KEYS");
    o.toneFreq = morzeStoreGetVal("rngToneFreq", "700");
    o.toneVol = morzeStoreGetVal("rngToneVol", "70");
    o.rampTime = morzeStoreGetVal("rngRampTime", "10");
    o.rampShape = "hann";
    try {
      var rampEl = morzeStoreEl("selRampShape");
      if (rampEl && rampEl.value) o.rampShape = rampEl.value;
    } catch (e) {}
    o.qsbDepth = morzeStoreGetVal("rngQsbDepth", "50");
    o.qsbPeriod = morzeStoreGetVal("rngQsbPeriod", "50");
    o.noiseVol = morzeStoreGetVal("rngNoiseVol", "35");
    o.qrmVol = morzeStoreGetVal("rngQrmVol", "25");
    o.quickNoise = morzeStoreGetChecked("chkQuickNoise", false);
    o.importLen = morzeStoreGetVal("importGroupLen", "5");
    o.importStrict = true;
    try {
      var mw = morzeStoreEl("importModeWords");
      var ms = morzeStoreEl("importModeStrict");
      if (mw && mw.checked) o.importStrict = false;
      else if (ms) o.importStrict = !!ms.checked;
    } catch (e) {}
    o.importPad = morzeStoreGetChecked("importPadEq", true);
    o.importSync = morzeStoreGetChecked("importSyncCharset", true);
    o.userInput = morzeStoreGetVal("txtUserInput", "");
    try { o.speedUnitMode = (typeof speedUnitMode !== "undefined") ? speedUnitMode : "WPM"; } catch (e) { o.speedUnitMode = "WPM"; }
    try { o.pauseUnitMode = (typeof pauseUnitMode !== "undefined") ? pauseUnitMode : "MS"; } catch (e) { o.pauseUnitMode = "MS"; }
    try { o.speedRange = (typeof speedInputIsRange !== "undefined") ? !!speedInputIsRange : false; } catch (e) { o.speedRange = false; }
    try { o.charWpm = (typeof speedCharWpm !== "undefined") ? speedCharWpm : 70; } catch (e) { o.charWpm = 70; }
    try { o.farnWpm = (typeof speedFarnWpm !== "undefined") ? speedFarnWpm : 50; } catch (e) { o.farnWpm = 50; }
    try { o.grpMult = (typeof speedGrpMult !== "undefined") ? speedGrpMult : 1.0; } catch (e) { o.grpMult = 1.0; }
    try { o.keyerMode = (typeof currentKeyerMode !== "undefined") ? currentKeyerMode : "straight"; } catch (e) { o.keyerMode = "straight"; }
    try { o.iambicSrc = (typeof currentIambicSource !== "undefined") ? currentIambicSource : "KEYS"; } catch (e) { o.iambicSrc = "KEYS"; }
    try { o.txHistory = (typeof txHistory !== "undefined" && txHistory) ? txHistory : ""; } catch (e) { o.txHistory = ""; }
    try {
      if (typeof getGroupsFromTable === "function") o.groups = getGroupsFromTable();
      else o.groups = null;
    } catch (e) { o.groups = null; }
    try {
      if (typeof readManualFlags === "function") o.manuals = readManualFlags();
      else o.manuals = null;
    } catch (e) { o.manuals = null; }
    try { o.imported = (typeof blankIsImported !== "undefined") ? !!blankIsImported : false; } catch (e) { o.imported = false; }
  } catch (e) {}
  return o;
}

/* --- Раннее применение: сырые значения + JS-переменные, без отрисовки --- */
function morzeStoreApplyEarly(s) {
  if (!s) return;
  morzeStoreSuspend++;
  try {
    if (s.tapeSpeed !== undefined) morzeStoreSetVal("rngTapeSpeed", s.tapeSpeed);
    if (s.tapeSource !== undefined) morzeStoreSetVal("selTapeSource", s.tapeSource);
    if (s.customCharset !== undefined) morzeStoreSetVal("customCharset", s.customCharset);
    if (s.accentCharset !== undefined) morzeStoreSetVal("accentCharset", s.accentCharset);
    if (s.accentWeight !== undefined) morzeStoreSetVal("rngAccentWeight", s.accentWeight);
    if (s.groupLength !== undefined) morzeStoreSetVal("groupLength", s.groupLength);
    if (s.numGroups !== undefined) morzeStoreSetVal("numGroups", s.numGroups);
    if (s.groupRepeat !== undefined) morzeStoreSetVal("groupRepeat", s.groupRepeat);
    if (s.charRepeat !== undefined) morzeStoreSetVal("charRepeat", s.charRepeat);
    if (s.preamble !== undefined) morzeStoreSetVal("selPreambleMode", s.preamble);
    if (s.postamble !== undefined) morzeStoreSetVal("selPostambleMode", s.postamble);
    if (s.monoOnly !== undefined) morzeStoreSetChecked("chkMonoOnly", s.monoOnly);
    if (s.keepManual !== undefined) morzeStoreSetChecked("chkKeepManual", s.keepManual);
    if (s.monoCount !== undefined) morzeStoreSetVal("monoCharCount", s.monoCount);
    if (s.studySpeed !== undefined) morzeStoreSetVal("rngStudySpeed", s.studySpeed);
    if (s.iambicSpeed !== undefined) morzeStoreSetVal("rngIambicSpeed", s.iambicSpeed);
    if (s.iambicSource !== undefined) morzeStoreSetVal("selIambicInputSource", s.iambicSource);
    if (s.toneFreq !== undefined) morzeStoreSetVal("rngToneFreq", s.toneFreq);
    if (s.toneVol !== undefined) morzeStoreSetVal("rngToneVol", s.toneVol);
    if (s.rampTime !== undefined) morzeStoreSetVal("rngRampTime", s.rampTime);
    if (s.qsbDepth !== undefined) morzeStoreSetVal("rngQsbDepth", s.qsbDepth);
    if (s.qsbPeriod !== undefined) morzeStoreSetVal("rngQsbPeriod", s.qsbPeriod);
    if (s.noiseVol !== undefined) morzeStoreSetVal("rngNoiseVol", s.noiseVol);
    if (s.qrmVol !== undefined) morzeStoreSetVal("rngQrmVol", s.qrmVol);
    if (s.quickNoise !== undefined) morzeStoreSetChecked("chkQuickNoise", s.quickNoise);
    if (s.importLen !== undefined) morzeStoreSetVal("importGroupLen", s.importLen);
    try {
      var ms = morzeStoreEl("importModeStrict"), mw = morzeStoreEl("importModeWords");
      if (ms && mw) {
        if (s.importStrict === false) { mw.checked = true; ms.checked = false; }
        else { ms.checked = true; mw.checked = false; }
      }
    } catch (e) {}
    if (s.importPad !== undefined) morzeStoreSetChecked("importPadEq", s.importPad);
    if (s.importSync !== undefined) morzeStoreSetChecked("importSyncCharset", s.importSync);
    if (s.userInput !== undefined) morzeStoreSetVal("txtUserInput", s.userInput);
    try { if (s.speedUnitMode === "MS" || s.speedUnitMode === "WPM") speedUnitMode = s.speedUnitMode; } catch (e) {}
    try { if (s.pauseUnitMode === "DOTS" || s.pauseUnitMode === "MS") pauseUnitMode = s.pauseUnitMode; } catch (e) {}
    try { if (s.speedRange !== undefined) speedInputIsRange = !!s.speedRange; } catch (e) {}
    try { var cw = parseFloat(s.charWpm); if (cw > 0 && isFinite(cw)) speedCharWpm = cw; } catch (e) {}
    try { var fw = parseFloat(s.farnWpm); if (fw > 0 && isFinite(fw)) speedFarnWpm = fw; } catch (e) {}
    try { var gm = parseFloat(s.grpMult); if (gm > 0 && isFinite(gm)) speedGrpMult = gm; } catch (e) {}
    try { if (s.keyerMode === "straight" || s.keyerMode === "iambic") currentKeyerMode = s.keyerMode; } catch (e) {}
    try { if (s.iambicSrc === "MOUSE" || s.iambicSrc === "KEYS") currentIambicSource = s.iambicSrc; } catch (e) {}
    try { if (typeof s.txHistory === "string") txHistory = s.txHistory; } catch (e) {}
    try { if (s.quickNoise !== undefined) noiseEnabled = !!s.quickNoise; } catch (e) {}
  } catch (e) {}
  morzeStoreSuspend--;
}

/* --- Обновление подписей простых слайдеров через их же oninput --- */
function morzeStoreRefreshSliderLabels() {
  var ids = ["rngIambicSpeed", "rngToneFreq", "rngToneVol", "rngRampTime",
             "rngQsbDepth", "rngQsbPeriod", "rngNoiseVol", "rngQrmVol", "rngTapeSpeed"];
  morzeStoreSuspend++;
  try {
    for (var i = 0; i < ids.length; i++) {
      try {
        var el = morzeStoreEl(ids[i]);
        if (el && typeof el.oninput === "function") el.oninput();
      } catch (e) {}
    }
    try {
      var st = morzeStoreEl("rngStudySpeed");
      if (st && typeof st.oninput === "function") st.oninput();
    } catch (e) {}
  } catch (e) {}
  morzeStoreSuspend--;
}

/* --- Позднее применение: после initRampDropdown/initTextImport --- */
function morzeStoreApplyLate(s) {
  if (!s) return;
  morzeStoreSuspend++;
  try {
    try {
      var tg = morzeStoreEl("unitToggle");
      var oW = morzeStoreEl("unitToggleOptWpm"), oM = morzeStoreEl("unitToggleOptMs");
      if (tg && typeof speedUnitMode !== "undefined") {
        if (speedUnitMode === "MS") {
          if (tg.className.indexOf("ms") === -1) tg.className += " ms";
        } else {
          tg.className = tg.className.replace(/\s*ms\b/g, "");
        }
      }
      if (oW) oW.className = "unit-toggle-opt" + (speedUnitMode === "WPM" ? " on" : "");
      if (oM) oM.className = "unit-toggle-opt" + (speedUnitMode === "MS" ? " on" : "");
    } catch (e) {}
    try {
      if (s.rampShape && typeof rampSetValue === "function") rampSetValue(s.rampShape, false);
    } catch (e) {}
    var savedTx = "";
    try { savedTx = txHistory || s.txHistory || ""; } catch (e) {}
    try {
      if (s.keyerMode && typeof setKeyerMode === "function") {
        setKeyerMode(s.keyerMode === "iambic" ? "iambic" : "straight");
      }
    } catch (e) {}
    try {
      if (s.iambicSrc && typeof switchIambicInputSource === "function") {
        var sel = morzeStoreEl("selIambicInputSource");
        if (sel) { try { sel.value = s.iambicSrc; } catch (e2) {} }
        switchIambicInputSource(s.iambicSrc);
      }
    } catch (e) {}
    try {
      txHistory = savedTx || "";
      var scr = morzeStoreEl("txDecoded");
      if (scr) {
        try {
          if ("textContent" in scr) scr.textContent = txHistory;
          else scr.innerHTML = txHistory;
        } catch (e2) {}
      }
      if (typeof updateLiveBufferDisplay === "function") updateLiveBufferDisplay();
    } catch (e) {}
    try { morzeStoreRefreshSliderLabels(); } catch (e) {}
    try { if (typeof applySpeedInputType === "function") applySpeedInputType(); } catch (e) {}
    try { if (typeof renderSpeedControls === "function") renderSpeedControls(); } catch (e) {}
    try { if (typeof updateAccentWeightLabel === "function") updateAccentWeightLabel(); } catch (e) {}
    try { if (typeof validateInputs === "function") validateInputs(); } catch (e) {}
    try { if (typeof updateOverallSpeed === "function") updateOverallSpeed(); } catch (e) {}
    try { if (typeof refreshAllAutoGrows === "function") refreshAllAutoGrows(); } catch (e) {}
    try { if (typeof applyAudioParamsNow === "function") applyAudioParamsNow(); } catch (e) {}
  } catch (e) {}
  morzeStoreSuspend--;
}

/* --- Планировщик сохранения с debounce --- */
function morzeStoreDoSave() {
  morzeStoreSaveTimer = null;
  try {
    if (morzeStoreSuspend > 0) return;
    var o = null;
    try { o = morzeStoreCollect(); } catch (e) { return; }
    var s = null;
    try { s = JSON.stringify(o); } catch (e) { return; }
    if (s) morzeStoreLsSet(s);
  } catch (e) {}
}

function morzeStoreScheduleSave() {
  try {
    if (morzeStoreSuspend > 0) return;
    if (morzeStoreSaveTimer) { try { clearTimeout(morzeStoreSaveTimer); } catch (e) {} morzeStoreSaveTimer = null; }
    try { morzeStoreSaveTimer = setTimeout(morzeStoreDoSave, MORZE_STORE_SAVE_DELAY); } catch (e) {}
  } catch (e) {}
}

/* --- Обёртка программных изменений (кнопки, пресеты, DnD): они не дают input/change --- */
function morzeStoreHookGlobal(name) {
  var g = null;
  try { g = (typeof window !== "undefined") ? window : null; } catch (e) { return; }
  if (!g) return;
  var orig = null;
  try { orig = g[name]; } catch (e) { return; }
  if (typeof orig !== "function") return;
  try { if (orig.__morzeHooked) return; } catch (e) {}
  var wrapped = function () {
    var r = null;
    try { r = orig.apply(this, arguments); } catch (e) { throw e; }
    try { morzeStoreScheduleSave(); } catch (e2) {}
    return r;
  };
  try { wrapped.__morzeHooked = true; } catch (e) {}
  try { g[name] = wrapped; } catch (e) {}
}

function morzeStoreBindAuto() {
  if (morzeStoreBound) return;
  morzeStoreBound = true;
  try {
    if (document && document.addEventListener) {
      document.addEventListener("input", function () { try { morzeStoreScheduleSave(); } catch (e) {} }, false);
      document.addEventListener("change", function () { try { morzeStoreScheduleSave(); } catch (e) {} }, false);
    }
  } catch (e) {}
  try {
    if (typeof window !== "undefined" && window && window.addEventListener) {
      window.addEventListener("beforeunload", function () {
        try {
          if (morzeStoreSuspend > 0) return;
          var o = morzeStoreCollect();
          var s = JSON.stringify(o);
          if (s) morzeStoreLsSet(s);
        } catch (e) {}
      }, false);
    }
  } catch (e) {}
  try {
    var names = ["rampDropdownSelect", "toggleSpeedUnit", "togglePauseUnit", "toggleSpeedInputType",
      "setKeyerMode", "switchIambicInputSource", "toggleNoiseFromMain", "toggleNoiseViaBox",
      "renderGroupsFromList", "uiGenerateGroupsTable", "setPreset", "clearAllTrainer",
      "insertMonoGroupFromPanel", "addNewEmptyGroup", "applyTextImport", "clearBlankGroups",
      "moveGroupToIndex", "moveGroupByStep", "setBlankImported", "clearTx", "commitMorseLetter"];
    for (var i = 0; i < names.length; i++) { try { morzeStoreHookGlobal(names[i]); } catch (e) {} }
  } catch (e) {}
}

/* --- Кнопка "НАСТРОЙКИ ПО УМОЛЧАНИЮ" --- */
function resetSettingsToDefaults() {
  try { if (morzeStoreSaveTimer) { try { clearTimeout(morzeStoreSaveTimer); } catch (e) {} morzeStoreSaveTimer = null; } } catch (e) {}
  morzeStoreSuspend++;
  try { morzeStoreLsDel(); } catch (e) {}
  var f = null;
  try { f = morzeStoreFactory(); } catch (e) { f = null; }
  try {
    if (f) morzeStoreApplyEarly(f);
  } catch (e) {}
  try {
    try { if (typeof setBlankImported === "function") setBlankImported(false); } catch (e) {}
    try { groupsDirty = false; } catch (e) {}
    try { morzeStoreSetVal("txtUserInput", ""); } catch (e) {}
    try { txHistory = ""; } catch (e) {}
    try {
      var scr = morzeStoreEl("txDecoded");
      if (scr) { try { if ("textContent" in scr) scr.textContent = ""; else scr.innerHTML = ""; } catch (e2) {} }
    } catch (e) {}
    try { if (typeof setKeyerMode === "function") setKeyerMode("straight"); } catch (e) {}
    try {
      var sel = morzeStoreEl("selIambicInputSource");
      if (sel) { try { sel.value = "KEYS"; } catch (e2) {} }
      if (typeof switchIambicInputSource === "function") switchIambicInputSource("KEYS");
    } catch (e) {}
    try { txHistory = ""; } catch (e) {}
    try { if (typeof updateLiveBufferDisplay === "function") updateLiveBufferDisplay(); } catch (e) {}
    try {
      var tg = morzeStoreEl("unitToggle");
      if (tg) { try { tg.className = tg.className.replace(/\s*ms\b/g, ""); } catch (e2) {} }
      var oW = morzeStoreEl("unitToggleOptWpm"), oM = morzeStoreEl("unitToggleOptMs");
      if (oW) oW.className = "unit-toggle-opt on";
      if (oM) oM.className = "unit-toggle-opt";
    } catch (e) {}
    try { if (typeof uiGenerateGroupsTable === "function") uiGenerateGroupsTable(); } catch (e) {}
    try { if (f && f.rampShape && typeof rampSetValue === "function") rampSetValue(f.rampShape, true); } catch (e) {}
    try { if (typeof applySpeedInputType === "function") applySpeedInputType(); } catch (e) {}
    try { if (typeof renderSpeedControls === "function") renderSpeedControls(); } catch (e) {}
    try { if (typeof updateAccentWeightLabel === "function") updateAccentWeightLabel(); } catch (e) {}
    try { morzeStoreRefreshSliderLabels(); } catch (e) {}
    try { if (typeof validateInputs === "function") validateInputs(); } catch (e) {}
    try { if (typeof updateOverallSpeed === "function") updateOverallSpeed(); } catch (e) {}
    try { if (typeof refreshAllAutoGrows === "function") refreshAllAutoGrows(); } catch (e) {}
    try { if (typeof refreshImportPreview === "function") refreshImportPreview(); } catch (e) {}
    try { if (typeof applyAudioParamsNow === "function") applyAudioParamsNow(); } catch (e) {}
  } catch (e) {}
  morzeStoreSuspend--;
  try { morzeStoreScheduleSave(); } catch (e) {}
  try { if (typeof showToast === "function") showToast("НАСТРОЙКИ СБРОШЕНЫ К ЗАВОДСКИМ."); } catch (e) {}
}

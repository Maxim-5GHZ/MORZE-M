/* ==========================================================================
   МОДУЛЬ: РАБОТА НА КЛЮЧЕ (TX)
   - вертикальный (прямой) ключ с АРУ темпа руки (EMA-фильтр);
   - электронный ключ Iambic Mode B: память элементов, чередование,
     ямбическое сжатие;
   - ввод с клавиатуры (латиница Z/X и русская Я/Ч) и манипулятора "мышь";
   - накопление переданного текста в буфер приёма.
   ========================================================================== */
var currentKeyerMode = "straight", currentIambicSource = "KEYS";

function switchIambicInputSource(src) {
  currentIambicSource = src;
  resetIambicHardware();
  var vPaddle = document.getElementById("virtualPaddle");
  var mousePad = document.getElementById("mousePadZone");
  if (currentKeyerMode === "iambic") {
    if (src === "MOUSE") { vPaddle.style.display = "none"; mousePad.style.display = "block"; }
    else { vPaddle.style.display = "flex"; mousePad.style.display = "none"; }
  }
}

function setKeyerMode(mode) {
  currentKeyerMode = mode;
  var btnStraight = document.getElementById("btnModeStraight");
  var btnIambic = document.getElementById("btnModeIambic");
  var straightParams = document.getElementById("straightKeyParams");
  var iambicParams = document.getElementById("iambicKeyParams");
  var virtualKey = document.getElementById("virtualKey");
  var virtualPaddle = document.getElementById("virtualPaddle");
  var mousePad = document.getElementById("mousePadZone");

  if (mode === "straight") {
    btnStraight.className = "keyer-mode-btn active";
    btnIambic.className = "keyer-mode-btn";
    straightParams.style.display = "block";
    iambicParams.style.display = "none";
    virtualKey.style.display = "flex";
    virtualPaddle.style.display = "none";
    mousePad.style.display = "none";
  } else {
    btnStraight.className = "keyer-mode-btn";
    btnIambic.className = "keyer-mode-btn active";
    straightParams.style.display = "none";
    iambicParams.style.display = "block";
    virtualKey.style.display = "none";
    if (currentIambicSource === "MOUSE") { vPaddle.style.display = "none"; mousePad.style.display = "block"; }
    else { virtualPaddle.style.display = "flex"; mousePad.style.display = "none"; }
  }
  clearTx(true);
}

var txHistory = "", currentMorseChar = "", charTimeout = null, wordTimeout = null;

function updateLiveBufferDisplay() {
  var el = document.getElementById("lblLiveMorseBuffer");
  if (!el) return;
  if (currentMorseChar.length > 0) {
    var preview = REVERSE_MORSE[currentMorseChar] || "?";
    setUiText(el, "БУФЕР СИМВОЛА: [ " + currentMorseChar + " ] -> " + preview);
  } else {
    setUiText(el, "БУФЕР СИМВОЛА: [ ГОТОВ ]");
  }
}

function commitMorseLetter() {
  if (currentMorseChar.length > 0) {
    var rec = REVERSE_MORSE[currentMorseChar] || ("[" + currentMorseChar + "?]");
    txHistory += rec;
    var screen = document.getElementById("txDecoded");
    if (screen) { setUiText(screen, txHistory); screen.scrollTop = screen.scrollHeight; }
    currentMorseChar = "";
    updateLiveBufferDisplay();
  }
}

function scheduleDecoders(unitMs, isStraight) {
  clearTimeout(charTimeout);
  clearTimeout(wordTimeout);
  var letterPause = isStraight ? unitMs * 3.0 : unitMs * 2.6;
  var wordPause = isStraight ? unitMs * 7.0 : unitMs * 6.0;

  charTimeout = setTimeout(function () { commitMorseLetter(); }, letterPause);
  wordTimeout = setTimeout(function () {
    if (txHistory.length > 0 && txHistory.charAt(txHistory.length - 1) !== " ") {
      txHistory += " ";
      var screen = document.getElementById("txDecoded");
      if (screen) { setUiText(screen, txHistory); screen.scrollTop = screen.scrollHeight; }
    }
  }, wordPause);
}

var keyStartTime = 0, estimatedDot = 95, ALPHA = 0.28;

function onStraightKeyDown() {
  if (currentKeyerMode !== "straight" || keyStartTime !== 0) return;
  keyStartTime = Date.now();
  toneOn("TX");
  var el = document.getElementById("virtualKey");
  if (el) el.className += " pressed";
  clearTimeout(charTimeout);
  clearTimeout(wordTimeout);
}

function onStraightKeyUp() {
  if (currentKeyerMode !== "straight" || keyStartTime === 0) return;
  var duration = Date.now() - keyStartTime;
  keyStartTime = 0;
  toneOff("TX");
  var el = document.getElementById("virtualKey");
  if (el) el.className = el.className.replace(/\bpressed\b/g, "").trim();

  if (duration < 25) return;
  var threshold = estimatedDot * 1.85;

  if (duration < threshold) {
    currentMorseChar += ".";
    estimatedDot = estimatedDot * (1 - ALPHA) + duration * ALPHA;
  } else {
    currentMorseChar += "-";
    var normalizedDot = duration / 3.0;
    estimatedDot = estimatedDot * (1 - ALPHA) + normalizedDot * ALPHA;
  }

  updateLiveBufferDisplay();
  estimatedDot = Math.max(33, Math.min(240, estimatedDot));
  var currentSpeed = Math.round(6000 / estimatedDot);
  setUiText("lblTxDetected", currentSpeed + " зн/мин [АРУ-АКТИВНА]");
  scheduleDecoders(estimatedDot, true);
}

var ditPressed = false, dahPressed = false, ditMemory = false, dahMemory = false;
var iambicTimer = null, iambicState = "IDLE", currentSendingElement = null, lastCompletedElement = null;

function getIambicUnitMs() {
  var spd = parseInt(document.getElementById("rngIambicSpeed").value, 10) || 70;
  return 6000.0 / Math.max(20, spd);
}

function updatePaddleVisuals() {
  var pL = document.getElementById("paddleLeft"), pR = document.getElementById("paddleRight");
  var padL = document.getElementById("padHalfLeft"), padR = document.getElementById("padHalfRight");

  if (ditPressed) {
    if (pL) pL.className += " pressed";
    if (padL) padL.className += " pressed";
  } else {
    if (pL) pL.className = pL.className.replace(/\bpressed\b/g, "").trim();
    if (padL) padL.className = padL.className.replace(/\bpressed\b/g, "").trim();
  }

  if (dahPressed) {
    if (pR) pR.className += " pressed";
    if (padR) padR.className += " pressed";
  } else {
    if (pR) pR.className = pR.className.replace(/\bpressed\b/g, "").trim();
    if (padR) padR.className = padR.className.replace(/\bpressed\b/g, "").trim();
  }
}

function startIambicIfIdle() {
  if (iambicState !== "IDLE") return;
  stepIambicFSM();
}

function stepIambicFSM() {
  var unitMs = getIambicUnitMs();
  if (iambicState === "IDLE") {
    var nextElem = null;
    if (ditMemory) { nextElem = "dit"; ditMemory = false; }
    else if (dahMemory) { nextElem = "dah"; dahMemory = false; }
    else if (ditPressed && dahPressed) { nextElem = lastCompletedElement === "dit" ? "dah" : "dit"; }
    else if (ditPressed) { nextElem = "dit"; }
    else if (dahPressed) { nextElem = "dah"; }

    if (!nextElem) { toneOff("TX"); return; }

    clearTimeout(charTimeout);
    clearTimeout(wordTimeout);

    currentSendingElement = nextElem;
    iambicState = "SENDING_MARK";
    currentMorseChar += nextElem === "dit" ? "." : "-";
    updateLiveBufferDisplay();
    toneOn("TX");

    var markDuration = nextElem === "dit" ? unitMs : unitMs * 3;
    clearTimeout(iambicTimer);
    iambicTimer = setTimeout(stepIambicFSM, markDuration);
  } else if (iambicState === "SENDING_MARK") {
    toneOff("TX");
    lastCompletedElement = currentSendingElement;
    iambicState = "SENDING_SPACE";
    clearTimeout(iambicTimer);
    iambicTimer = setTimeout(stepIambicFSM, unitMs);
  } else if (iambicState === "SENDING_SPACE") {
    iambicState = "IDLE";
    currentSendingElement = null;
    if (ditPressed || dahPressed || ditMemory || dahMemory) {
      stepIambicFSM();
    } else {
      scheduleDecoders(unitMs, false);
    }
  }
}

function triggerDitDown() {
  clearTimeout(charTimeout); clearTimeout(wordTimeout);
  ditPressed = true;
  if (iambicState === "SENDING_MARK") { if (currentSendingElement === "dah") ditMemory = true; }
  else if (iambicState === "SENDING_SPACE") { ditMemory = true; }
  updatePaddleVisuals();
  startIambicIfIdle();
}

function triggerDitUp() { ditPressed = false; updatePaddleVisuals(); }

function triggerDahDown() {
  clearTimeout(charTimeout); clearTimeout(wordTimeout);
  dahPressed = true;
  if (iambicState === "SENDING_MARK") { if (currentSendingElement === "dit") dahMemory = true; }
  else if (iambicState === "SENDING_SPACE") { dahMemory = true; }
  updatePaddleVisuals();
  startIambicIfIdle();
}

function triggerDahUp() { dahPressed = false; updatePaddleVisuals(); }

function resetIambicHardware() {
  clearTimeout(iambicTimer);
  iambicTimer = null;
  iambicState = "IDLE";
  currentSendingElement = null;
  lastCompletedElement = null;
  ditPressed = false;
  dahPressed = false;
  ditMemory = false;
  dahMemory = false;
  toneOff("TX");
  updatePaddleVisuals();
}

function clearTx(silent) {
  txHistory = "";
  currentMorseChar = "";
  estimatedDot = 95;
  clearTimeout(charTimeout);
  clearTimeout(wordTimeout);
  resetIambicHardware();
  setUiText("txDecoded", "");
  setUiText("lblTxDetected", "70 зн/мин [СБРОС]");
  updateLiveBufferDisplay();
  var el = document.getElementById("virtualKey");
  if (el) el.className = el.className.replace(/\bpressed\b/g, "").trim();
}

function bindAction(el, downFn, upFn) {
  if (!el) return;
  var isDown = false;
  el.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    if (e.preventDefault) e.preventDefault();
    isDown = true; downFn();
  }, false);

  window.addEventListener("mouseup", function () {
    if (isDown) { isDown = false; upFn(); }
  }, false);

  el.addEventListener("touchstart", function (e) {
    if (e.preventDefault) e.preventDefault();
    isDown = true; downFn();
  }, false);

  window.addEventListener("touchend", function () {
    if (isDown) { isDown = false; upFn(); }
  }, false);
}

bindAction(document.getElementById("virtualKey"), onStraightKeyDown, onStraightKeyUp);
bindAction(document.getElementById("paddleLeft"), triggerDitDown, triggerDitUp);
bindAction(document.getElementById("paddleRight"), triggerDahDown, triggerDahUp);

var mousePad = document.getElementById("mousePadZone");
mousePad.addEventListener("contextmenu", function (e) { if (e.preventDefault) e.preventDefault(); return false; });
mousePad.addEventListener("mousedown", function (e) {
  if (e.preventDefault) e.preventDefault();
  if (currentKeyerMode !== "iambic" || currentIambicSource !== "MOUSE") return;
  if (e.button === 0) triggerDitDown();
  else if (e.button === 2) triggerDahDown();
});
mousePad.addEventListener("mouseup", function (e) {
  if (e.preventDefault) e.preventDefault();
  if (currentKeyerMode !== "iambic" || currentIambicSource !== "MOUSE") return;
  if (e.button === 0) triggerDitUp();
  else if (e.button === 2) triggerDahUp();
});
mousePad.addEventListener("mouseleave", function () {
  if (currentIambicSource === "MOUSE") { triggerDitUp(); triggerDahUp(); }
});

var keySpacePressed = false, keyZPressed = false, keyXPressed = false;

window.addEventListener("keydown", function (e) {
  var tag = (e.target || {}).tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;

  var kc = e.keyCode || e.which;
  var key = (e.key || "").toLowerCase();

  if (kc === 32) {
    if (e.preventDefault) e.preventDefault();
    if (!keySpacePressed) { keySpacePressed = true; onStraightKeyDown(); }
  } else if (kc === 90 || key === "z" || key === "я") {
    if (currentKeyerMode === "iambic" && currentIambicSource === "KEYS") {
      if (e.preventDefault) e.preventDefault();
      if (!keyZPressed) { keyZPressed = true; triggerDitDown(); }
    }
  } else if (kc === 88 || key === "x" || key === "ч") {
    if (currentKeyerMode === "iambic" && currentIambicSource === "KEYS") {
      if (e.preventDefault) e.preventDefault();
      if (!keyXPressed) { keyXPressed = true; triggerDahDown(); }
    }
  }
});

window.addEventListener("keyup", function (e) {
  var tag = (e.target || {}).tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;

  var kc = e.keyCode || e.which;
  var key = (e.key || "").toLowerCase();

  if (kc === 32) {
    if (e.preventDefault) e.preventDefault();
    keySpacePressed = false; onStraightKeyUp();
  } else if (kc === 90 || key === "z" || key === "я") {
    if (currentKeyerMode === "iambic" && currentIambicSource === "KEYS") {
      if (e.preventDefault) e.preventDefault();
      keyZPressed = false; triggerDitUp();
    }
  } else if (kc === 88 || key === "x" || key === "ч") {
    if (currentKeyerMode === "iambic" && currentIambicSource === "KEYS") {
      if (e.preventDefault) e.preventDefault();
      keyXPressed = false; triggerDahUp();
    }
  }
});


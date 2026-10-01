/* ==========================================================================
   МОДУЛЬ: ЗВУКОВОЙ ТРАКТ (WEB AUDIO API)
   Синтез телеграфного тона, коммутация ключом, QSB-модуляция, фильтры
   ПЧ/НЧ, шум эфира (QRN), мешающая станция (QRM), компрессор, тест-тон.
   ВАЖНО (Gecko 43): только ScriptProcessorNode / createOscillator /
   createBufferSource. AudioWorklet отсутствует — не применять.
   ========================================================================== */
var audioCtx = null, mainToneOsc = null, keyingGain = null, qsbGain = null, qsbLfo = null, qsbDepthGain = null, masterToneGain = null;
var noiseNode = null, noiseGain = null, qrmOsc = null, qrmGain = null;
var noiseEnabled = false, rxActive = false, isTestToneOn = false;
// Текущее значение громкости ключа (JS-зеркало AudioParam: в старых Gecko
// param.value не отражает значение во время автоматизации).
var keyGainValue = 0;
// Кэш последних применённых параметров: одинаковые значения повторно не
// планируются, иначе в старых браузерах копились события на одном батче.
var lastAudioParams = { freq: -1, vol: -1, noiseVol: -1, qrmVol: -1, qsbDepth: -1, qsbPeriod: -1 };
// Сессия приёма жива: передача идёт ИЛИ стоит на паузе (кнопка «ПРОДОЛЖИТЬ»).
// rxActive означает только «шаг передачи выполняется», поэтому блокировку бланка
// и шум эфира надо вести по rxSessionOn, иначе пауза всё разморозит.
var rxSessionOn = false;

function initAudio() {
  if (audioCtx) {
    if (audioCtx.state === "suspended" && audioCtx.resume) { try { audioCtx.resume(); } catch (e) {} }
    return true;
  }
  try {
    var AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxClass) return false;
    audioCtx = new AudioCtxClass();
    var now = audioCtx.currentTime;

    mainToneOsc = audioCtx.createOscillator();
    mainToneOsc.type = "sine";
    var freq = parseFloat(document.getElementById("rngToneFreq").value) || 700;
    mainToneOsc.frequency.setValueAtTime(freq, now);

    keyingGain = audioCtx.createGain();
    keyingGain.gain.setValueAtTime(0, now);

    qsbGain = audioCtx.createGain();
    qsbGain.gain.setValueAtTime(1.0, now);

    qsbLfo = audioCtx.createOscillator();
    qsbLfo.type = "sine";
    var qsbPeriod = Math.max(1.5, (parseFloat(document.getElementById("rngQsbPeriod").value) || 50) / 10);
    qsbLfo.frequency.setValueAtTime(1 / qsbPeriod, now);

    qsbDepthGain = audioCtx.createGain();
    qsbDepthGain.gain.setValueAtTime(0, now);

    qsbLfo.connect(qsbDepthGain);
    qsbDepthGain.connect(qsbGain.gain);
    try { qsbLfo.start(0); } catch (e) {}

    masterToneGain = audioCtx.createGain();
    var vol = ((parseFloat(document.getElementById("rngToneVol").value) || 70) / 100) * 0.4;
    masterToneGain.gain.setValueAtTime(vol, now);

    mainToneOsc.connect(keyingGain);
    keyingGain.connect(qsbGain);
    qsbGain.connect(masterToneGain);
    masterToneGain.connect(audioCtx.destination);
    try { mainToneOsc.start(0); } catch (e) {}

    var sampleRate = audioCtx.sampleRate || 44100;
    var bufSize = sampleRate * 2;
    var buf = audioCtx.createBuffer(1, bufSize, sampleRate);
    var data = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0;
    for (var i = 0; i < bufSize; i++) {
      var white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.055;
      b1 = 0.963 * b1 + white * 0.16;
      b2 = 0.57 * b2 + white * 0.42;
      data[i] = (b0 + b1 + b2 + white * 0.08) * 0.12;
    }

    noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = buf;
    noiseNode.loop = true;

    var bpf = audioCtx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.setValueAtTime(750, now);
    bpf.Q.setValueAtTime(1.4, now);

    noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseNode.connect(bpf);
    bpf.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    try { noiseNode.start(0); } catch (e) {}

    qrmOsc = audioCtx.createOscillator();
    qrmGain = audioCtx.createGain();
    qrmOsc.frequency.setValueAtTime(890, now);
    qrmGain.gain.setValueAtTime(0, now);
    qrmOsc.connect(qrmGain);
    qrmGain.connect(audioCtx.destination);
    try { qrmOsc.start(0); } catch (e) {}

    applyAudioParamsNow();
    return true;
  } catch (err) {
    return false;
  }
}

function smoothParam(param, value, tau) {
  var now = audioCtx.currentTime;
  try { param.cancelScheduledValues(now); } catch (e) {}
  param.setTargetAtTime(value, now, tau);
}

function applyAudioParamsNow() {
  if (!audioCtx || audioCtx.state === "closed") return;
  try {
    var freq = parseFloat(document.getElementById("rngToneFreq").value) || 700;
    var vol = ((parseFloat(document.getElementById("rngToneVol").value) || 70) / 100) * 0.4;
    if (freq !== lastAudioParams.freq) {
      lastAudioParams.freq = freq;
      smoothParam(mainToneOsc.frequency, freq, 0.006);
    }
    if (vol !== lastAudioParams.vol) {
      lastAudioParams.vol = vol;
      smoothParam(masterToneGain.gain, vol, 0.01);
    }

    var isNoiseAudible = (noiseEnabled && rxSessionOn) || isTestToneOn;
    var nVol = isNoiseAudible ? parseFloat(document.getElementById("rngNoiseVol").value) / 250 : 0;
    if (nVol !== lastAudioParams.noiseVol) {
      lastAudioParams.noiseVol = nVol;
      smoothParam(noiseGain.gain, nVol, 0.02);
    }

    var qVol = isNoiseAudible ? parseFloat(document.getElementById("rngQrmVol").value) / 350 : 0;
    if (qVol !== lastAudioParams.qrmVol) {
      lastAudioParams.qrmVol = qVol;
      smoothParam(qrmGain.gain, qVol, 0.02);
    }

    var qsbActive = noiseEnabled || isTestToneOn;
    var qsbDepth = qsbActive ? parseFloat(document.getElementById("rngQsbDepth").value) / 100 : 0;
    var qsbPeriod = Math.max(1.0, parseFloat(document.getElementById("rngQsbPeriod").value) / 10);
    if (qsbPeriod !== lastAudioParams.qsbPeriod) {
      lastAudioParams.qsbPeriod = qsbPeriod;
      smoothParam(qsbLfo.frequency, 1 / qsbPeriod, 0.02);
    }
    if (qsbDepth !== lastAudioParams.qsbDepth) {
      lastAudioParams.qsbDepth = qsbDepth;
      smoothParam(qsbGain.gain, 1.0 - qsbDepth * 0.48, 0.02);
      smoothParam(qsbDepthGain.gain, qsbDepth * 0.48, 0.02);
    }
  } catch (e) {}
}

function toneOn(source) {
  source = source || "TX";
  if (!initAudio()) return;
  var led = document.getElementById("rxTxLed");
  if (led) led.className = "led on";
  setTapeSignal(1, source);
  try {
    var now = audioCtx.currentTime;
    var rampSec = Math.max(0.001, (parseFloat(document.getElementById("rngRampTime").value) || 6) / 1000);
    var shape = document.getElementById("selRampShape").value;
    keyingGain.gain.cancelScheduledValues(now);
    if (shape === "linear") {
      keyingGain.gain.setValueAtTime(keyGainValue, now);
      keyingGain.gain.linearRampToValueAtTime(1.0, now + rampSec);
    } else {
      keyingGain.gain.setTargetAtTime(1.0, now, rampSec / 2.5);
    }
    keyGainValue = 1.0;
  } catch (e) {}
}

function toneOff(source) {
  source = source || "TX";
  var led = document.getElementById("rxTxLed");
  if (led) led.className = "led";
  setTapeSignal(0, source);
  if (!audioCtx || !keyingGain) return;
  try {
    var now = audioCtx.currentTime;
    var rampSec = Math.max(0.001, (parseFloat(document.getElementById("rngRampTime").value) || 6) / 1000);
    var shape = document.getElementById("selRampShape").value;
    keyingGain.gain.cancelScheduledValues(now);
    if (shape === "linear") {
      keyingGain.gain.setValueAtTime(keyGainValue, now);
      keyingGain.gain.linearRampToValueAtTime(0.0001, now + rampSec);
    } else {
      keyingGain.gain.setTargetAtTime(0.0001, now, rampSec / 2.5);
    }
    keyGainValue = 0.0001;
  } catch (e) {}
}

function toggleTestTone() {
  initAudio();
  var btn = document.getElementById("btnTestTone");
  isTestToneOn = !isTestToneOn;
  if (isTestToneOn) {
    btn.style.background = "#5a1e1c";
    setUiText(btn, "■ ОСТАНОВИТЬ ТЕСТОВЫЙ ТОН");
    toneOn("RX");
  } else {
    btn.style.background = "#23374c";
    setUiText(btn, "🔊 ВКЛЮЧИТЬ ТЕСТОВЫЙ ТОН");
    toneOff("RX");
  }
  applyAudioParamsNow();
}

function toggleNoiseViaBox() {
  var chk = document.getElementById("chkQuickNoise");
  chk.checked = !chk.checked;
  toggleNoiseFromMain(chk.checked);
}

function toggleNoiseFromMain(state) {
  initAudio();
  noiseEnabled = state;
  applyAudioParamsNow();
}


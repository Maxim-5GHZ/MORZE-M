/* ==========================================================================
   МОДУЛЬ: ЗВУКОВОЙ ТРАКТ (WEB AUDIO API)
   Синтез телеграфного тона, коммутация ключом, QSB-модуляция, фильтры
   ПЧ/НЧ, шум эфира (QRN), мешающая станция (QRM), компрессор, тест-тон.
   ВАЖНО (Gecko 43): только ScriptProcessorNode / createOscillator /
   createBufferSource. AudioWorklet отсутствует — не применять.
   ========================================================================== */
var audioCtx = null, mainToneOsc = null, keyingGain = null, qsbGain = null, qsbLfo = null, qsbDepthGain = null, masterToneGain = null, toneFilter = null;
var noiseNode = null, noiseGain = null, qrmOsc = null, qrmGain = null;
var noiseEnabled = false, rxActive = false, isTestToneOn = false;
// Модуляция QSB (LFO -> AudioParam) подключается ТОЛЬКО на время действия
// затухания: в старых Gecko постоянная a-rate связь с параметром громкости
// гоняет лишний ресемплинг по каждому блоку и подсыпает микротреск в фон.
var qsbModConnected = false;
// Запас планирования коммутации, сек. Событие, поставленное ровно на
// audioCtx.currentTime, попадает на середину обрабатываемого блока Linux-буфера
// (512-2048 отсчётов) и вызывает XRUN. 4 мс для уха неразличимы, а PulseAudio
// успевает переключиться на следующий период.
var KEYING_LOOKAHEAD = 0.012;

// Отмена событий с микросдвигом назад: если точка сегментной кривой попала
// ровно на момент переключения, cancelScheduledValues(now) её срежет, и до
// нового якоря огибающая будет стоять на последнем уцелевшем отсчёте кривой -
// ступенька величиной в один сегмент (при 16 точках и фронте 10 мс это ~0.07
// громкости за 20 мкс - тонкий цок на скоростях от 400 зн/мин). Отменяем на
// 10 мкс раньше: уцелевшие точки мгновенно перекрываются якорем setValueAtTime,
// а конфликтующие события всё равно удаляются.
var KEYING_CANCEL_EPS = 0.00001;

// Таблица мягкого фронта (приподнятый косинус, Хэннинг): 0..1, производная на
// обоих концах строго нулевая - поэтому щелчок на фронте практически исчезает.
// Через setValueCurveAtTime это сделать НЕЛЬЗЯ: в Gecko уже начавшуюся кривую
// нельзя отменить (bug 1752775 - отмечен в browser-compat-data как
// ограничение cancelScheduledValues), а спека запрещает ставить события внутрь
// интервала кривой (NotSupportedError). Наш тракт перепланирует огибающую на
// каждой точке, то есть почти всегда попадает внутрь - огибающая залипла бы
// намертво. Поэтому та же кривая раскладывается на HANN_POINTS-1 линейных
// сегментов: их отменять можно всегда, а зеркало считает тот же результат.
var HANN_POINTS = 16;
var HANN_UP = (function () {
  var a = [];
  for (var i = 0; i < HANN_POINTS; i++) a.push(0.5 * (1 - Math.cos(Math.PI * i / (HANN_POINTS - 1))));
  return a;
})();

/* --------------------------------------------------------------------------
   ЗЕРКАЛА ОГИБАЮЩИХ AudioParam (Gecko 43).
   Проблема: AudioParam.value в старых Gecko не отражает ход автоматизации, а
   cancelAndHoldAtTime() появился только в Firefox 46. Поэтому "заморозить"
   текущий уровень штатным способом нельзя - приходится держать собственную
   копию огибающей (та же формула, что в Web Audio) и перед каждой
   перепланировкой якорять param.setValueAtTime() на РЕАЛЬНУЮ текущую
   величину. Иначе дважды щёлкает:
     - если якорь равен "целевому" значению, сигнал прыгает с недошедшего
       уровня (быстрая точка / клик оператора) на 1.0 - щелчок-хлыст;
     - если якорь не задан вовсе, после cancelScheduledValues() param
       откатывается к внутреннему значению по умолчанию (для gain это 1.0) -
       короткий выброс на полную громкость.
   -------------------------------------------------------------------------- */
function newRamp(shape, v0, target, t0, dur, tau, pts) {
  return { shape: shape, v0: v0, target: target, t: t0, dur: dur || 0, tau: tau || 0, pts: pts || null };
}

function rampValueAt(r, t) {
  if (!r) return 0;
  if (t <= r.t) return r.v0;
  if (r.shape === "curve" && r.pts && r.dur > 0) {
    var f = (t - r.t) / r.dur;
    if (f >= 1) return r.target;
    var x = f * (r.pts.length - 1);
    var i = Math.floor(x);
    var y = r.pts[i] + (r.pts[i + 1] - r.pts[i]) * (x - i);
    return r.v0 + (r.target - r.v0) * y;
  }
  if (r.shape === "linear") {
    if (r.dur <= 0) return r.target;
    if (t >= r.t + r.dur) return r.target;
    return r.v0 + (r.target - r.v0) * ((t - r.t) / r.dur);
  }
  if (r.tau <= 0) return r.target;
  return r.target + (r.v0 - r.target) * Math.exp(-(t - r.t) / r.tau);
}

// Огибающая громкости ключа и её зеркала остальных автоматизируемых параметров.
var keyRamp = newRamp("linear", 0, 0, 0, 0, 0);
var paramRamps = {};
// Кэш последних применённых параметров: одинаковые значения повторно не
// планируются, иначе в старых браузерах копились события на одном батче.
var lastAudioParams = { freq: -1, vol: -1, noiseVol: -1, qrmVol: -1, qsbDepth: -1, qsbPeriod: -1, filterFc: -1 };
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

    // ВАЖНО: qsbLfo -> qsbDepthGain -> qsbGain.gain здесь НЕ подключаем.
    // Связь включается только при ненулевой глубине QSB (см. setQsbModulation).
    qsbModConnected = false;
    try { qsbLfo.start(0); } catch (e) {}

    masterToneGain = audioCtx.createGain();
    var vol = ((parseFloat(document.getElementById("rngToneVol").value) || 70) / 100) * 0.4;
    masterToneGain.gain.setValueAtTime(vol, now);

    // ФНЧ тона - аналог ключевого фильтра Р-140/«Катран». Коммутированный ключом
    // синус всегда даёт на фронте выброс гармоник (у линейной рампы спад
    // спектра ~1/f^2, у RC - V'(0)=1/tau тоже максимальная), и без фильтра
    // это слышно как сухой «цок» на 2-4 кГц. Срез держим привязанным к тону
    // (2.4*f, не ниже 1.3 кГц): на частоте тона потерь нет (-0.1 дБ), а всё
    // внеполосное гасится на 30+ дБ. Q=0.707 - баттервортовский, без горба.
    toneFilter = audioCtx.createBiquadFilter();
    toneFilter.type = "lowpass";
    toneFilter.frequency.setValueAtTime(getToneFilterCutoff(freq), now);
    toneFilter.Q.setValueAtTime(0.707, now);

    mainToneOsc.connect(keyingGain);
    keyingGain.connect(toneFilter);
    toneFilter.connect(qsbGain);
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

    // Синхронизируем зеркала огибающих с фактическими стартовыми значениями,
    // иначе первый же сглаживающий рамп прыгнул бы от 1.0 (значение gain
    // по умолчанию) к нужному уровню.
    keyRamp = newRamp("linear", 0, 0, 0, 0, 0);
    paramRamps.freq = newRamp("linear", freq, freq, 0, 0, 0);
    paramRamps.vol = newRamp("linear", vol, vol, 0, 0, 0);
    paramRamps.noiseVol = newRamp("linear", 0, 0, 0, 0, 0);
    paramRamps.qrmVol = newRamp("linear", 0, 0, 0, 0, 0);
    paramRamps.qsbGain = newRamp("linear", 1.0, 1.0, 0, 0, 0);
    paramRamps.qsbDepth = newRamp("linear", 0, 0, 0, 0, 0);
    paramRamps.qsbFreq = newRamp("linear", 1 / qsbPeriod, 1 / qsbPeriod, 0, 0, 0);
    paramRamps.toneFilter = newRamp("linear", getToneFilterCutoff(freq), getToneFilterCutoff(freq), 0, 0, 0);
    lastAudioParams = { freq: -1, vol: -1, noiseVol: -1, qrmVol: -1, qsbDepth: -1, qsbPeriod: -1, filterFc: -1 };

    applyAudioParamsNow();
    return true;
  } catch (err) {
    return false;
  }
}

// Сглаженное (экспоненциальное) изменение параметра. Обязательно якорим
// setValueAtTime() на реальном текущем уровне из зеркала: после
// cancelScheduledValues() Gecko откатывает param к внутреннему значению
// (для gain это 1.0), и без якоря громкость на кадр выстреливает вверх.
// Срез ключевого ФНЧ: привязан к тону, чтобы фильтр не душил сам тон при
// заборе в верхнюю часть диапазона (слайдер 400-1100 Гц).
function getToneFilterCutoff(freq) {
  return Math.max(1300, freq * 2.4);
}

function smoothParam(param, value, tau, key) {
  if (!audioCtx || !param) return;
  var now = audioCtx.currentTime;
  var prev = key ? paramRamps[key] : null;
  var v = prev ? rampValueAt(prev, now) : null;
  try {
    param.cancelScheduledValues(now);
    if (v !== null) param.setValueAtTime(v, now);
    param.setTargetAtTime(value, now, tau);
  } catch (e) {}
  if (key) paramRamps[key] = newRamp("exp", v === null ? value : v, value, now, 0, tau);
}

// Включение/выключение модуляции QSB. Пока глубина нулевая, цепочку LFO ->
// AudioParam держим разомкнутой (см. комментарий в initAudio).
// ВАЖНО (Gecko): перегрузка disconnect(destinationNode) в Firefox не
// реализована вообще (только Chrome 43+), а WebIDL на лишний аргумент
// отвечает TypeError - выборочно отключить узел нельзя. Рвём без аргументов:
// у qsbLfo и qsbDepthGain выход всё равно только один.
function setQsbModulation(on) {
  if (!qsbLfo || !qsbDepthGain || !qsbGain) return;
  if (on === qsbModConnected) return;
  try {
    if (on) {
      qsbLfo.connect(qsbDepthGain);
      qsbDepthGain.connect(qsbGain.gain);
    } else {
      qsbDepthGain.disconnect();
      qsbLfo.disconnect();
    }
    qsbModConnected = !!on;
  } catch (e) {}
}

function applyAudioParamsNow() {
  if (!audioCtx || audioCtx.state === "closed") return;
  try {
    var freq = parseFloat(document.getElementById("rngToneFreq").value) || 700;
    var vol = ((parseFloat(document.getElementById("rngToneVol").value) || 70) / 100) * 0.4;
    if (freq !== lastAudioParams.freq) {
      lastAudioParams.freq = freq;
      smoothParam(mainToneOsc.frequency, freq, 0.006, "freq");
    }
    if (vol !== lastAudioParams.vol) {
      lastAudioParams.vol = vol;
      smoothParam(masterToneGain.gain, vol, 0.01, "vol");
    }
    var filterFc = getToneFilterCutoff(freq);
    if (filterFc !== lastAudioParams.filterFc) {
      lastAudioParams.filterFc = filterFc;
      smoothParam(toneFilter.frequency, filterFc, 0.02, "toneFilter");
    }

    var isNoiseAudible = (noiseEnabled && rxSessionOn) || isTestToneOn;
    var nVol = isNoiseAudible ? parseFloat(document.getElementById("rngNoiseVol").value) / 250 : 0;
    if (nVol !== lastAudioParams.noiseVol) {
      lastAudioParams.noiseVol = nVol;
      smoothParam(noiseGain.gain, nVol, 0.02, "noiseVol");
    }

    var qVol = isNoiseAudible ? parseFloat(document.getElementById("rngQrmVol").value) / 350 : 0;
    if (qVol !== lastAudioParams.qrmVol) {
      lastAudioParams.qrmVol = qVol;
      smoothParam(qrmGain.gain, qVol, 0.02, "qrmVol");
    }

    var qsbActive = noiseEnabled || isTestToneOn;
    var qsbDepth = qsbActive ? parseFloat(document.getElementById("rngQsbDepth").value) / 100 : 0;
    var qsbPeriod = Math.max(1.0, parseFloat(document.getElementById("rngQsbPeriod").value) / 10);
    if (qsbPeriod !== lastAudioParams.qsbPeriod) {
      lastAudioParams.qsbPeriod = qsbPeriod;
      smoothParam(qsbLfo.frequency, 1 / qsbPeriod, 0.02, "qsbFreq");
    }
    if (qsbDepth !== lastAudioParams.qsbDepth) {
      lastAudioParams.qsbDepth = qsbDepth;
      smoothParam(qsbGain.gain, 1.0 - qsbDepth * 0.48, 0.02, "qsbGain");
      smoothParam(qsbDepthGain.gain, qsbDepth * 0.48, 0.02, "qsbDepth");
    }
    setQsbModulation(qsbDepth > 0.0005);
  } catch (e) {}
}

/* Единая коммутация громкости ключа (toneOn/toneOff/toggleTestTone).
   Порядок событий обязателен и одинаков для обоих направлений:
     now - якорь setValueAtTime(v) с РЕАЛЬНОЙ текущей громкостью из зеркала
           (закрывает весь промежуток, пока старые события ещё не отменены);
     t0  - начало самой рампы, с запасом KEYING_LOOKAHEAD вперёд, чтобы событие
           не попало в середину текущего блока Linux-буфера (XRUN).
   События, запланированные на now и позже, отменяются - иначе старый рамп,
   запущенный с запасом, продолжит доводить уровень до 1.0 и выстрелит
   щелчком, когда придёт toneOff.
   ВАЖНО про linearRampToValueAtTime: по спецификации рамп интерполирует
   ОТ ПРЕДЫДУЩЕГО СОБЫТИЯ (T0 = время предыдущего события), а не от того
   момента, где мы его запланировали. Без второго якоря на t0 рамп незаметно
   растянется на KEYING_LOOKAHEAD + rampSec, а зеркало останется с исходной
   rampSec - и якорь следующей коммутации возьмёт неверный уровень.
   Про setTargetAtTime якорь на t0 НЕ нужен: по спеке он сам берёт V0 из
   таймлайна на момент startTime (там стоит якорь v). Зато якорь на now
   убрать нельзя: между currentTime и t0 не остаётся ни одного события, и
   параметр там равен внутреннему значению 1.0 - выброс на полную громкость
   длиной в KEYING_LOOKAHEAD на каждой точке. */
function setKeyingLevel(target) {
  var g = keyingGain.gain;
  var now = audioCtx.currentTime;
  var t0 = now + KEYING_LOOKAHEAD;
  var rampSec = Math.max(0.001, (parseFloat(document.getElementById("rngRampTime").value) || 10) / 1000);
  var shape = document.getElementById("selRampShape").value;
  var v = rampValueAt(keyRamp, now);

  g.cancelScheduledValues(Math.max(0, now - KEYING_CANCEL_EPS));
  if (keyRamp.shape === "curve") {
    // Хвост сегментной криной мог быть срезан отменой ровно в этот момент
    // (точка кривой попадает в now, когда переключение приходит на середине
    // фронта - при скоростной передаче это обычное дело). Без этой строки
    // параметр стоял бы на последнем уцелевшем отсчёте кривой до now, а потом
    // прыгал на v: ступенька величиной в один сегмент (для 16 точек и фронта
    // 10 мс это ~0.07 громкости мгновенно - тонкий цок). Линейный довод до v
    // на последнем сегменте вместо ступеньки; отклонение от зеркала тут
    // порядка кривизны Хэннинга (~0.001) и на щелчок не влияет.
    g.linearRampToValueAtTime(v, now);
  }
  g.setValueAtTime(v, now);

  if (shape === "linear") {
    g.setValueAtTime(v, t0);                 // T0 рампы = t0, иначе старт от now
    g.linearRampToValueAtTime(target, t0 + rampSec);
    keyRamp = newRamp("linear", v, target, t0, rampSec, 0);
  } else if (shape === "hann") {
    // Мягкий фронт: 15 линейных сегментов по таблице Хэннинга, от v к target.
    g.setValueAtTime(v, t0);
    for (var i = 1; i < HANN_POINTS; i++) {
      var f = i / (HANN_POINTS - 1);
      g.linearRampToValueAtTime(v + (target - v) * HANN_UP[i], t0 + rampSec * f);
    }
    keyRamp = newRamp("curve", v, target, t0, rampSec, 0, HANN_UP);
  } else {
    var tau = rampSec / 3.0;
    // setTargetAtTime сам берёт V0 из таймлайна на t0 (там якорь v) - тут
    // модель и ядро совпадают.
    g.setTargetAtTime(target, t0, tau);
    keyRamp = newRamp("exp", v, target, t0, 0, tau);
  }
}

function toneOn(source) {
  source = source || "TX";
  if (!initAudio()) return;
  var led = document.getElementById("rxTxLed");
  if (led) led.className = "led on";
  setTapeSignal(1, source);
  try {
    setKeyingLevel(1.0);
  } catch (e) {}
}

function toneOff(source) {
  source = source || "TX";
  var led = document.getElementById("rxTxLed");
  if (led) led.className = "led";
  setTapeSignal(0, source);
  if (!audioCtx || !keyingGain) return;
  try {
    setKeyingLevel(0.0);
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


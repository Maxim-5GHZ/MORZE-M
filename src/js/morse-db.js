/* ==========================================================================
   МОДУЛЬ: БАЗА МОРЗЕ (ТАБЛИЦА ЗНАКОВ, НАПЕВЫ, СПРАВОЧНИК)
   - MORSE_DB: коды и мнемонические напевы для всех знаков;
   - MORSE_MAP / REVERSE_MORSE: прямой и обратный словари;
   - cleanMorseChars(), ensureCharInCharset();
   - авто-подгонка высоты текстовых полей (autoGrow).
   ========================================================================== */
var MORSE_DB = [
  { ch: "А", code: ".-", mn: "ай-даа" }, { ch: "Б", code: "-...", mn: "баа-ки-те-кут" },
  { ch: "В", code: ".--", mn: "ви-даа-лаа" }, { ch: "Г", code: "--.", mn: "гаа-раа-жи" },
  { ch: "Д", code: "-..", mn: "доо-ми-ки" }, { ch: "Е", code: ".", mn: "есть" },
  { ch: "Ж", code: "...-", mn: "же-ле-зис-тооо" }, { ch: "З", code: "--..", mn: "заа-каа-ти-ки" },
  { ch: "И", code: "..", mn: "и-ди" }, { ch: "Й", code: ".---", mn: "йот-у-доо-бно" },
  { ch: "К", code: "-.-", mn: "каак-же-таак" }, { ch: "Л", code: ".-..", mn: "лу-наа-ти-ки" },
  { ch: "М", code: "--", mn: "маа-маа" }, { ch: "Н", code: "-.", mn: "ноо-мер" },
  { ch: "О", code: "---", mn: "оо-коо-лоо" }, { ch: "П", code: ".--.", mn: "пи-лаа-поо-ёт" },
  { ch: "Р", code: ".-.", mn: "ре-шаа-ет" }, { ch: "С", code: "...", mn: "си-ни-е" },
  { ch: "Т", code: "-", mn: "таак" }, { ch: "У", code: "..-", mn: "у-нес-лоо" },
  { ch: "Ф", code: "..-.", mn: "фи-ли-моон-чик" }, { ch: "Х", code: "....", mn: "хи-ми-чи-те" },
  { ch: "Ц", code: "-.-.", mn: "цаа-пли-наа-ши" }, { ch: "Ч", code: "---.", mn: "чаа-шаа-то-нет" },
  { ch: "Ш", code: "----", mn: "шаа-роо-ваа-ры" }, { ch: "Щ", code: "--.-", mn: "щаа-вам-не-шаа" },
  { ch: "Ъ", code: "-..-", mn: "тоо-твёрдый-знаак" }, { ch: "Ы", code: "-.--", mn: "ыы-ВАМ-НЕ-И" },
  { ch: "Ь", code: "-..-", mn: "тоо-мягкий-знаак" }, { ch: "Э", code: "..-..", mn: "э-ле-ктроо-ник" },
  { ch: "Ю", code: "..--", mn: "ю-ли-аа-на" }, { ch: "Я", code: ".-.-", mn: "я-маал-я-маал" },
  { ch: "1", code: ".----", mn: "и-толь-ко-оо-дииин" }, { ch: "2", code: "..---", mn: "два-на-гоо-реек" },
  { ch: "3", code: "...--", mn: "три-те-бе-маа-лоо" }, { ch: "4", code: "....-", mn: "че-тве-ри-тоо-го" },
  { ch: "5", code: ".....", mn: "пя-ти-паа-ль-чи-ки" }, { ch: "6", code: "-....", mn: "поо-шес-ти-бе-ри" },
  { ch: "7", code: "--...", mn: "даа-даа-се-ме-ри" }, { ch: "8", code: "---..", mn: "воо-сьмоо-го-по-ра" },
  { ch: "9", code: "----.", mn: "дее-вяя-тоо-го-нет" }, 
  { ch: "0", code: "-----", mn: "нооль-тоо-оо-коо-лоо" }, { ch: "Ø", code: "-", mn: "нооль" },
  { ch: "=", code: "-...-", mn: "же-ле-зо-де-лай" }, { ch: "/", code: "-..-.", mn: "дрообь-здесь-од-наа" },
  { ch: "?", code: "..--..", mn: "вы-не-ска-же-тее" }, { ch: ",", code: "--..--", mn: "знаак-заа-пяя-тоо-го" },
  { ch: ".", code: ".-.-.-", mn: "точ-ка-точ-ка-точ-ка" }
];

var MORSE_MAP = {};
var REVERSE_MORSE = {};
for (var i = 0; i < MORSE_DB.length; i++) {
  MORSE_MAP[MORSE_DB[i].ch] = MORSE_DB[i].code;
  if (!REVERSE_MORSE[MORSE_DB[i].code]) REVERSE_MORSE[MORSE_DB[i].code] = MORSE_DB[i].ch;
}

function cleanMorseChars(str) {
  if (!str) return "";
  var s = ("" + str).toUpperCase().replace(/Ё/g, "Е");
  s = latinToCyrMorse(s);
  // СТРОГО КИРИЛЛИЦА: буквы только А-Я, латиница A-Z уже переведена
  // транслитом по коду Морзе выше. Цифры и служ. знаки трогаем.
  return s.replace(/[^А-Я0-9Ø=\/?,\.]/g, "");
}

// Тот же набор, но с пробелами/переносами: для живых полей «Набор знаков»
// и «Журнал оператора», где пробел - разделитель.
function cleanMorseCharsSpaced(str) {
  if (!str) return "";
  var s = ("" + str).toUpperCase().replace(/Ё/g, "Е");
  s = s.replace(/0-|-0/g, "Ø");
  s = latinToCyrMorse(s);
  return s.replace(/[^А-Я0-9Ø=\/?,\.\s]/g, "");
}

// Морзе-транслит латиницы в кириллицу ПО КОДУ (CQ -> ЦЩ, V -> Ж и т.д.).
// Единая таблица (раньше жила только в blank-import.js как IMPORT_LAT2CYR).
var LAT2CYR_MORSE = {
  A: "А", B: "Б", C: "Ц", D: "Д", E: "Е", F: "Ф", G: "Г", H: "Х",
  I: "И", J: "Й", K: "К", L: "Л", M: "М", N: "Н", O: "О", P: "П",
  Q: "Щ", R: "Р", S: "С", T: "Т", U: "У", V: "Ж", W: "В", X: "Ъ",
  Y: "Ы", Z: "З"
};

function latinToCyrMorse(s) {
  if (!s) return "";
  var table = LAT2CYR_MORSE;
  try {
    if (typeof IMPORT_LAT2CYR !== "undefined" && IMPORT_LAT2CYR) table = IMPORT_LAT2CYR;
  } catch (e) {}
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    out += table[ch] || ch;
  }
  return out;
}

// Живая нормализация поля ввода: верхний регистр, Ё->Е, 0-/-0->Ø,
// латиница->кириллица, вырезание мусора. Каретка сохраняется.
// allowSpaces: true - для набора знаков и журнала (пробел-разделитель).
function normalizeMorseField(el, allowSpaces) {
  if (!el || typeof el.value !== "string") return;
  var raw = el.value;
  var val = ("" + raw).toUpperCase().replace(/Ё/g, "Е");
  val = val.replace(/0-|-0/g, "Ø");
  val = latinToCyrMorse(val);
  val = allowSpaces
    ? val.replace(/[^А-Я0-9Ø=\/?,\.\s]/g, "")
    : val.replace(/[^А-Я0-9Ø=\/?,\.]/g, "");
  if (raw !== val) {
    var s = null, e = null;
    try { s = el.selectionStart; e = el.selectionEnd; } catch (ex) { s = null; }
    el.value = val;
    if (typeof s === "number" && typeof e === "number") {
      try {
        var diff = raw.length - val.length;
        var ns = s - diff, ne = e - diff;
        if (ns < 0) ns = 0;
        if (ne < 0) ne = 0;
        if (ns > val.length) ns = val.length;
        if (ne > val.length) ne = val.length;
        el.setSelectionRange(ns, ne);
      } catch (ex2) {}
    }
  }
}

// Добавить все знаки текста в «Набор знаков», которых там ещё нет.
function syncTextToCharset(text) {
  var clean = cleanMorseChars(text);
  if (!clean) return;
  for (var i = 0; i < clean.length; i++) {
    ensureCharInCharset(clean.charAt(i));
  }
}

function autoGrow(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = (el.scrollHeight + 4) + "px";
}

function refreshAllAutoGrows() {
  var list = document.querySelectorAll(".teacher-auto-expand");
  for (var i = 0; i < list.length; i++) autoGrow(list[i]);
}

function ensureCharInCharset(ch) {
  ch = cleanMorseChars(ch);
  if (!ch) return;
  var customField = document.getElementById("customCharset");
  var cur = cleanMorseChars(customField.value);
  if (cur.indexOf(ch) === -1) {
    customField.value = (customField.value.trim() + " " + ch).trim();
    autoGrow(customField);
  }
}


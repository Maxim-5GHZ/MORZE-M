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
  return ("" + str).toUpperCase().replace(/Ё/g, "Е").replace(/[^A-ZА-Я0-9Ø=\/?,\.]/gi, "");
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


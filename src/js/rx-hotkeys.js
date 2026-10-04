/* ==========================================================================
   МОДУЛЬ: ГОРЯЧИЕ КЛАВИШИ ПРИЁМА (RX-ХОТКЕИ)
   - S: ПУСК ПРИЁМА / СБРОС (та же кнопка btnRxStart);
   - T: СТОП / ПРОДОЛЖИТЬ (кнопка btnRxStop);
   - Ctrl+Enter в журнале: КОНТРОЛЬ (кнопка btnRxCheck).
   Действуют только на вкладке «1. Приём на слух» и вне полей ввода, чтобы не
   конфликтовать с TX-ключом (Пробел/Z/X) и вводом текста. Раскладка не важна:
   сравнение идёт по keyCode (S и С, T и Т - одна физическая клавиша).
   Совместимость: только ES5 (Gecko 38), общий скоуп единого <script>.
   ========================================================================== */
var __rxHotkeysBound = false;

function __rxHotkeysTabActive() {
  var tab = document.getElementById("tab-rx");
  if (!tab) return true;
  return hasClass(tab, "active");
}

function __rxHotkeysClick(id) {
  var btn = document.getElementById(id);
  if (!btn || btn.disabled) return;
  if (typeof btn.click === "function") btn.click();
  else if (typeof btn.onclick === "function") btn.onclick();
}

function initRxHotkeys() {
  if (__rxHotkeysBound) return;
  __rxHotkeysBound = true;
  document.addEventListener("keydown", function (e) {
    if (!e) return;
    var kc = e.keyCode || e.which;
    var target = e.target || {};
    var tag = target.tagName || "";
    var inField = (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT");

    // Ctrl+Enter в журнале приёма - КОНТРОЛЬ (поле журнала - исключение из гарда).
    if (kc === 13 && (e.ctrlKey || e.metaKey) && target.id === "txtUserInput") {
      if (e.preventDefault) e.preventDefault();
      __rxHotkeysClick("btnRxCheck");
      return;
    }
    if (inField) return;
    if (!__rxHotkeysTabActive()) return;

    if (kc === 83) {           // S / Ы - ПУСК (на паузе - СБРОС)
      __rxHotkeysClick("btnRxStart");
    } else if (kc === 84) {    // T / Е - СТОП / ПРОДОЛЖИТЬ
      __rxHotkeysClick("btnRxStop");
    }
  }, false);
}

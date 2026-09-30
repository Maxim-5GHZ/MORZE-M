/* ==========================================================================
   МОДУЛЬ: ПЕРЕТАСКИВАНИЕ ГРУПП БЛАНКА (DRAG & DROP БЕЗ ЗАВИСИМОСТЕЙ)
   - захват ячейки мышью за любую часть, кроме поля ввода знаков;
   - маркер места вставки янтарной полосой (слева/справа от ячейки);
   - автоскролл бланка, когда курсор у верхней или нижней кромки;
   - клавиатурный дубль: CTRL+стрелки влево/вправо двигают группу;
   - перестановка меняет порядок передачи радиограммы (порядок бланка).
   Требования: только ES5 (var, function), без classList и dataset.
   Совместимость Gecko 43: mouse-события, getBoundingClientRect, insertBefore.
   ========================================================================== */
var GRID_DND_MIN_DX = 5;   // мин. смещение мыши для старта перетаскивания, px
var GRID_DND_EDGE = 26;     // зона автоскролла у кромки бланка, px
var GRID_DND_STEP = 14;     // шаг автоскролла, px
var GRID_DND_TICK = 50;     // период автоскролла, мс

function getGroupsContainer() {
  return document.getElementById("groupsContainer");
}

function getGroupCells() {
  return document.querySelectorAll("#groupsContainer .group-cell:not(.group-cell-add)");
}

function isAddGroupCell(cell) {
  return !!(cell && (" " + cell.className + " ").indexOf(" group-cell-add ") !== -1);
}

// Точное совпадение класса "group-cell": findAncestel ищет по подстроке
// и поймал бы вложенный элемент с классом "group-cell-idx" (номерок ячейки).
function findGroupCell(el) {
  while (el && el !== document) {
    if (el.className && (" " + el.className + " ").indexOf(" group-cell ") !== -1) return el;
    el = el.parentNode;
  }
  return null;
}

function cellIndexInList(cells, cell) {
  for (var i = 0; i < cells.length; i++) {
    if (cells[i] === cell) return i;
  }
  return -1;
}

// Индекс вставки 0..cells.length по позиции курсора.
// Чистая функция: работает только с getBoundingClientRect ячеек (тестируется в Node).
function computeDropIndex(cells, x, y) {
  if (cells.length === 0) return 0;
  var i, r;
  // 1) курсор внутри ячейки: левая половина — вставка перед, правая — после
  for (i = 0; i < cells.length; i++) {
    r = cells[i].getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return (x < r.left + r.width / 2) ? i : i + 1;
    }
  }
  // 2) курсор в зазоре между ячейками того же ряда — ближайшая граница
  var best = cells.length, bestDist = -1;
  for (i = 0; i < cells.length; i++) {
    r = cells[i].getBoundingClientRect();
    if (y < r.top || y > r.bottom) continue;
    var dLeft = Math.abs(x - r.left);
    if (bestDist === -1 || dLeft < bestDist) { bestDist = dLeft; best = i; }
    var dRight = Math.abs(x - r.right);
    if (dRight < bestDist) { bestDist = dRight; best = i + 1; }
  }
  if (bestDist !== -1) return best;
  // 3) курсор выше всех ячеек или ниже всех ячеек
  var first = cells[0].getBoundingClientRect();
  return (y < first.top) ? 0 : cells.length;
}

// Перенос группы на позицию targetIndex (0..длина-1). Поправка сдвига
// при переносе вниз. Возвращает новый индекс ячейки или -1 при отказе.
function moveGroupToIndex(cell, targetIndex) {
  if (rxActive) return -1;
  if (!cell || isAddGroupCell(cell)) return -1;
  var container = getGroupsContainer();
  if (!container || !cell.parentNode) return -1;

  var cells = getGroupCells();
  var from = cellIndexInList(cells, cell);
  if (from === -1) return -1;

  var max = cells.length - 1;
  var to = targetIndex;
  if (to < 0) to = 0;
  if (to > max) to = max;
  if (to === from) return from;

  container.removeChild(cell);
  var remaining = getGroupCells();
  // refNode — узел, ПЕРЕД которым встанет группа; null = в самый конец
  var refNode = (to < remaining.length) ? remaining[to] : document.getElementById("cellAddGroup");
  container.insertBefore(cell, refNode || null);

  reindexCells();
  validateInputs();
  return cellIndexInList(getGroupCells(), cell);
}

// Перенос на шаг delta (-1 выше, +1 ниже) для клавиатурного дубля
function moveGroupByStep(cell, delta) {
  var cells = getGroupCells();
  var from = cellIndexInList(cells, cell);
  if (from === -1) return false;
  var to = from + delta;
  if (to < 0 || to > cells.length - 1) return false;

  var inp = cell.querySelector(".group-input-val");
  var focused = (inp && document.activeElement === inp) ? inp : null;

  if (moveGroupToIndex(cell, to) === -1) return false;

  if (focused) {
    focused.focus();
    if (focused.select) focused.select();
  }
  return true;
}

/* -------------------------- ПЕРЕТАСКИВАНИЕ МЫШЬЮ --------------------------- */
var dnd = {
  active: false,    // перетаскивание началось
  armed: false,     // mousedown зафиксирован, ждём первого смещения
  cell: null,
  fromIndex: -1,
  startX: 0,
  startY: 0,
  dropIndex: -1,
  scrollTimer: null,
  edgeDir: 0,
  onMove: null,
  onUp: null,
  onBlur: null
};

function dndClass(cell, name, on) {
  if (!cell) return;
  var re = new RegExp("(^|\\s)" + name + "(\\s|$)", "g");
  if (on) {
    if (!re.test(cell.className)) {
      cell.className = (cell.className + " " + name).replace(/^\s+/, "").replace(/\s+$/, "");
    }
  } else {
    cell.className = cell.className.replace(re, " ").replace(/^\s+|\s+$/g, "");
  }
}

function clearDropMarkers() {
  var cells = getGroupCells();
  for (var i = 0; i < cells.length; i++) {
    dndClass(cells[i], "drop-before", false);
    dndClass(cells[i], "drop-after", false);
  }
}

function showDropMarker(index) {
  clearDropMarkers();
  var cells = getGroupCells();
  if (cells.length === 0) return;
  if (index >= cells.length) {
    dndClass(cells[cells.length - 1], "drop-after", true);
  } else {
    dndClass(cells[index], "drop-before", true);
  }
}

function applyAutoScroll(dir) {
  dnd.edgeDir = dir;
  if (dir === 0) { stopAutoScroll(); return; }
  if (dnd.scrollTimer !== null) return;

  var container = getGroupsContainer();
  dnd.scrollTimer = setInterval(function () {
    if (!dnd.active) { stopAutoScroll(); return; }
    if (container) container.scrollTop += GRID_DND_STEP * dnd.edgeDir;
  }, GRID_DND_TICK);
}

function stopAutoScroll() {
  if (dnd.scrollTimer !== null) {
    clearInterval(dnd.scrollTimer);
    dnd.scrollTimer = null;
  }
  dnd.edgeDir = 0;
}

function dndEdgeDir(clientY) {
  var container = getGroupsContainer();
  if (!container) return 0;
  var r = container.getBoundingClientRect();
  if (r.height <= 0) return 0;
  if (clientY < r.top + GRID_DND_EDGE) return -1;
  if (clientY > r.bottom - GRID_DND_EDGE) return 1;
  return 0;
}

// Завершение перетаскивания: commit = true — применить перестановку
function dndEnd(commit) {
  stopAutoScroll();
  clearDropMarkers();
  dndClass(dnd.cell, "drag-source", false);
  dndClass(getGroupsContainer(), "dnd-active", false);

  if (commit && dnd.active && dnd.dropIndex !== -1 && dnd.dropIndex !== dnd.fromIndex) {
    moveGroupToIndex(dnd.cell, dnd.dropIndex);
  }

  if (dnd.onMove) document.removeEventListener("mousemove", dnd.onMove, false);
  if (dnd.onUp) document.removeEventListener("mouseup", dnd.onUp, false);
  if (dnd.onBlur) window.removeEventListener("blur", dnd.onBlur, false);

  dnd.active = false;
  dnd.armed = false;
  dnd.cell = null;
  dnd.fromIndex = -1;
  dnd.dropIndex = -1;
  dnd.onMove = null;
  dnd.onUp = null;
  dnd.onBlur = null;
}

function initGroupsDragAndDrop() {
  var container = getGroupsContainer();
  if (!container) return;

  container.addEventListener("mousedown", function (e) {
    if (rxActive) return;                                // во время приёма бланк заблокирован
    if (e.button !== 0) return;                          // только ЛКМ
    var cell = findGroupCell(e.target);
    if (!cell || isAddGroupCell(cell)) return;
    if (e.target && e.target.tagName === "INPUT") return; // поле ввода знаков не таскаем

    dnd.armed = true;
    dnd.active = false;
    dnd.cell = cell;
    dnd.fromIndex = cellIndexInList(getGroupCells(), cell);
    dnd.startX = e.clientX;
    dnd.startY = e.clientY;
    dnd.dropIndex = dnd.fromIndex;

    dnd.onMove = function (ev) {
      if (!dnd.armed) return;
      // Кнопка отжата вне окна браузера — событие mouseup в страницу не придёт,
      // поэтому отменяем перетаскивание сами (MouseEvent.buttons есть с Gecko 32).
      if (typeof ev.buttons === "number" && !(ev.buttons & 1)) { dndEnd(false); return; }
      if (!dnd.active) {
        var dx = Math.abs(ev.clientX - dnd.startX);
        var dy = Math.abs(ev.clientY - dnd.startY);
        if (dx < GRID_DND_MIN_DX && dy < GRID_DND_MIN_DX) return;
        dnd.active = true;
        dndClass(dnd.cell, "drag-source", true);
        dndClass(getGroupsContainer(), "dnd-active", true);
      }
      if (ev.preventDefault) ev.preventDefault();

      dnd.dropIndex = computeDropIndex(getGroupCells(), ev.clientX, ev.clientY);
      // Исходную позицию не подсвечиваем: возврат на место = отмена переноса
      if (dnd.dropIndex === dnd.fromIndex) clearDropMarkers();
      else showDropMarker(dnd.dropIndex);

      applyAutoScroll(dndEdgeDir(ev.clientY));
    };

    dnd.onUp = function () { dndEnd(true); };
    dnd.onBlur = function () { dndEnd(false); };

    document.addEventListener("mousemove", dnd.onMove, false);
    document.addEventListener("mouseup", dnd.onUp, false);
    window.addEventListener("blur", dnd.onBlur, false);
  }, false);

  // Клавиатурный дубль: CTRL+вправо — ниже по списку, CTRL+влево — выше
  container.addEventListener("keydown", function (e) {
    if (rxActive) return;
    if (!e.ctrlKey) return;
    var kc = e.keyCode || e.which;
    if (kc !== 37 && kc !== 39) return;
    var cell = findGroupCell(e.target);
    if (!cell || isAddGroupCell(cell)) return;
    if (e.preventDefault) e.preventDefault();
    moveGroupByStep(cell, kc === 37 ? -1 : 1);
  }, false);
}

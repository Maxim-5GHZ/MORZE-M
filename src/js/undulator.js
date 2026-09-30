/* ==========================================================================
   МОДУЛЬ: САМОПИСЕЦ ЛЕНТЫ (UNDULATOR, CANVAS 2D)
   Отрисовка бегущей ленты в реальном времени, масштаб px/s, селектор
   каналов (TX / RX / сквозной), очистка ленты, пересчёт при resize.
   ========================================================================== */
var canvas = document.getElementById("undulatorCanvas");
var ctx = canvas.getContext("2d");
var tapeState = 0, tapePoints = [], lastUndulatorTime = window.performance && performance.now ? performance.now() : Date.now();
var logicalCanvasWidth = 800, logicalCanvasHeight = 65, tapeScrollOffset = 0;

function resizeCanvas() {
  if (!canvas || !canvas.parentElement) return;
  var rect = canvas.parentElement.getBoundingClientRect();
  if (rect.width <= 0) return;
  var dpr = window.devicePixelRatio || 1;
  logicalCanvasWidth = rect.width;
  logicalCanvasHeight = rect.height || 65;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(logicalCanvasHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvas);

function setTapeSignal(state, source) {
  var sel = document.getElementById("selTapeSource");
  var mode = sel ? sel.value : "ALL";
  if (mode === "TX_ONLY" && source !== "TX") return;
  if (mode === "RX_ONLY" && source !== "RX") return;
  tapeState = state ? 1 : 0;
}

function renderUndulator() {
  var now = window.performance && performance.now ? performance.now() : Date.now();
  var dt = (now - lastUndulatorTime) / 1000;
  lastUndulatorTime = now;
  if (dt > 0.08) dt = 0.08;

  var speed = parseFloat(document.getElementById("rngTapeSpeed").value) || 120;
  var dx = speed * dt;
  tapeScrollOffset = (tapeScrollOffset + dx) % 40;

  for (var i = 0; i < tapePoints.length; i++) tapePoints[i].x -= dx;
  while (tapePoints.length > 0 && tapePoints[0].x < -30) tapePoints.shift();

  var targetY = tapeState ? 18 : 48;
  tapePoints.push({ x: logicalCanvasWidth, y: targetY });

  ctx.fillStyle = "#0c1209";
  ctx.fillRect(0, 0, logicalCanvasWidth, logicalCanvasHeight);

  ctx.strokeStyle = "#1b2816";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 18); ctx.lineTo(logicalCanvasWidth, 18);
  ctx.moveTo(0, 48); ctx.lineTo(logicalCanvasWidth, 48);
  ctx.stroke();

  ctx.beginPath();
  for (var x = logicalCanvasWidth - tapeScrollOffset; x > 0; x -= 40) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, logicalCanvasHeight);
  }
  ctx.stroke();

  if (tapePoints.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = "#38ff38";
    ctx.lineWidth = 2.2;
    ctx.moveTo(tapePoints[0].x, tapePoints[0].y);
    for (var j = 1; j < tapePoints.length; j++) {
      var prev = tapePoints[j - 1], curr = tapePoints[j];
      if (prev.y !== curr.y) ctx.lineTo(curr.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
    }
    ctx.stroke();
  }

  ctx.fillStyle = tapeState ? "#ffb000" : "#517245";
  ctx.beginPath();
  ctx.arc(logicalCanvasWidth - 3, targetY, 3.5, 0, Math.PI * 2);
  ctx.fill();

  requestAnimationFrame(renderUndulator);
}

function clearTape() { tapePoints = []; }


/* ==========================================================================
   МОДУЛЬ: КОНТРОЛЬ ПРИЁМА (ПРОВЕРКА РАДИОГРАММ)
   - глобальное выравнивание Нидлмана — Вунша без лавинного сдвига;
   - кнопка КОНТРОЛЬ, карта расхождений, оценка.
   Совместимость: только ES5 (Gecko 38), общий скоуп единого <script>.
   ========================================================================== */
function alignSequences(orig, user) {
  var n = orig.length, m = user.length;
  var dp = [];
  for (var i = 0; i <= n; i++) {
    dp[i] = [];
    for (var j = 0; j <= m; j++) dp[i][j] = 0;
    dp[i][0] = i;
  }
  for (var col = 0; col <= m; col++) dp[0][col] = col;

  for (var r = 1; r <= n; r++) {
    for (var c = 1; c <= m; c++) {
      var cost = orig[r - 1] === user[c - 1] ? 0 : 1;
      dp[r][c] = Math.min(dp[r - 1][c] + 1, dp[r][c - 1] + 1, dp[r - 1][c - 1] + cost);
    }
  }

  var curR = n, curC = m;
  var alignedOrig = [], alignedUser = [];
  while (curR > 0 || curC > 0) {
    if (curR > 0 && curC > 0 && dp[curR][curC] === dp[curR - 1][curC - 1] + (orig[curR - 1] === user[curC - 1] ? 0 : 1)) {
      alignedOrig.push(orig[curR - 1]);
      alignedUser.push(user[curC - 1]);
      curR--; curC--;
    } else if (curR > 0 && dp[curR][curC] === dp[curR - 1][curC] + 1) {
      alignedOrig.push(orig[curR - 1]);
      alignedUser.push("_");
      curR--;
    } else {
      alignedOrig.push("");
      alignedUser.push(user[curC - 1]);
      curC--;
    }
  }
  return { alignedOrig: alignedOrig.reverse(), alignedUser: alignedUser.reverse() };
}

document.getElementById("btnRxCheck").onclick = function () {
  if (!targetRadiogram) {
    showToast("ПЕРЕДАЧА НЕ ВЫПОЛНЯЛАСЬ. НАЖМИТЕ «ПУСК ПРИЁМА».");
    return;
  }

  var cleanOrig = cleanMorseChars(targetRadiogram);
  var cleanUser = cleanMorseChars(document.getElementById("txtUserInput").value);
  var alignResult = alignSequences(cleanOrig, cleanUser);
  var alignedOrig = alignResult.alignedOrig;
  var alignedUser = alignResult.alignedUser;

  var diffHtml = "", errors = 0, validCharCount = 0;
  var grpLen = parseInt(document.getElementById("groupLength").value, 10) || 5;

  for (var k = 0; k < alignedOrig.length; k++) {
    var o = alignedOrig[k], u = alignedUser[k];
    if (o === u) {
      diffHtml += '<span class="char-ok">' + u + "</span>";
    } else {
      errors++;
      if (o === "") diffHtml += '<span class="char-err">' + u + "[+]</span>";
      else if (u === "_") diffHtml += '<span class="char-err">_[' + o + "]</span>";
      else diffHtml += '<span class="char-err">' + u + "[" + o + "]</span>";
    }
    if (o !== "") validCharCount++;
    if (validCharCount > 0 && validCharCount % grpLen === 0 && o !== "") diffHtml += " ";
  }

  var diffBox = document.getElementById("diffBox");
  diffBox.innerHTML = "<b>РЕЗУЛЬТАТ КОНТРОЛЬНОЙ СВЕРКИ:</b><br>" + diffHtml;
  diffBox.style.display = "block";

  var total = cleanOrig.length;
  var percent = Math.max(0, Math.round(((total - errors) / total) * 100));
  var mark = "НЕУДОВЛЕТВОРИТЕЛЬНО (2)";
  if (errors <= 1) mark = "ОТЛИЧНО (5)";
  else if (errors <= 3) mark = "ХОРОШО (4)";
  else if (errors <= 5) mark = "УДОВЛЕТВОРИТЕЛЬНО (3)";

  setUiText("examReport", "ИТОГ: ПРИНЯТО ВЕРНО " + Math.max(0, total - errors) + " ИЗ " + total + " (" + percent + "%). ОШИБОК: " + errors + ". ОЦЕНКА: " + mark);
};


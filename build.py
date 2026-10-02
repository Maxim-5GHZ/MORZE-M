#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Сборщик изделия "МОРЗЕ-М" (ASTRA EDITION).
# Раскладка: src/ + build.py -> единый файл build/Морзе-М.html.
# Запуск:  python3 build.py            (однократная сборка, комментарии удаляются)
#          python3 build.py --minify   (то же + жмутся пробелы/переводы строк,
#                                       выход - build/Морзе-М.min.html для слабых машин)
#          python3 build.py --watch    (автопересборка при изменении файлов в src/,
#                                       комментарии сохраняются)
# Зависимостей нет: только стандартная библиотека Python 3.
# F-строки намеренно НЕ используются - совместимость с Python 3.4/3.5 (Astra Linux 1.6).
import os
import re
import sys
import time


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE_DIR, "src")
TEMPLATE_PATH = os.path.join(SRC_DIR, "index.html")
BUILD_DIR = os.path.join(BASE_DIR, "build")
OUTPUT_PATH = os.path.join(BUILD_DIR, "Морзе-М.html")
OUTPUT_MIN_PATH = os.path.join(BUILD_DIR, "Морзе-М.html")

INCLUDE_REGEX = re.compile(r'/\*\s*@include\s+([^\s\*]+)\s*\*/')
# HTML-компоненты разметки: метка <!-- @include html/имя.html --> с колонки 0.
# Разворачивается там же, где JS/CSS-включения, т.е. ДО вырезания комментариев
# и минификации, поэтому strip_html_comments метки уже не видит.
HTML_INCLUDE_REGEX = re.compile(r'<!--\s*@include\s+([^\s]+)\s*-->')

def resolve_includes(content):
    def replace_match(match):
        rel_path = match.group(1).strip()
        full_path = os.path.join(SRC_DIR, rel_path)
        if os.path.exists(full_path):
            with open(full_path, "r", encoding="utf-8") as f:
                print(" [+] Внедрён модуль: {}".format(rel_path))
                return f.read()
        else:
            print(" [!] ОШИБКА: Файл не найден: {}".format(full_path))
            return match.group(0)

    def replace_html(match):
        rel_path = match.group(1).strip()
        full_path = os.path.join(SRC_DIR, rel_path)
        if os.path.exists(full_path):
            with open(full_path, "r", encoding="utf-8") as f:
                print(" [+] Внедрён компонент: {}".format(rel_path))
                # Метка стоит отдельной строкой с колонки 0 и съедается целиком,
                # а перевод строки после неё остаётся шаблону. Поэтому финальный
                # перевод строки компонента отбрасываем, иначе в сборке появится
                # пустая строка (файлы по POSIX оканчиваются на "\n").
                text = f.read()
                if text.endswith("\n"):
                    text = text[:-1]
                return text
        else:
            print(" [!] ОШИБКА: Файл не найден: {}".format(full_path))
            return match.group(0)

    content = HTML_INCLUDE_REGEX.sub(replace_html, content)
    return INCLUDE_REGEX.sub(replace_match, content)

# --- Удаление комментариев (только при обычной сборке) -----------------------
# Разбор посимвольный: строки, шаблоны и регулярные выражения в JS пропускаются,
# чтобы не вырезать код, похожий на комментарий ("//", "/*" внутри литералов).

JS_REGEX_KEYWORDS = frozenset([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "case", "do", "else", "yield", "await", "throw",
])
REGEX_PREV_CHARS = frozenset("=,([{!&|?:;+-*%~^<>")
SCRIPT_TAG_REGEX = re.compile(r"<(script|style)\b[^>]*>", re.IGNORECASE)
SCRIPT_CLOSE_REGEX = re.compile(r"</(script|style)\s*>", re.IGNORECASE)
HTML_COMMENT_REGEX = re.compile(r"<!--.*?-->", re.DOTALL)

def _keep_newlines(text):
    # На месте комментария остаются переводы строк - нумерация строк не «поехала».
    return "\n" * text.count("\n")

def _skip_literal(src, i, quote):
    n = len(src)
    j = i + 1
    while j < n:
        ch = src[j]
        if ch == "\\":
            j += 2
            continue
        if ch == quote:
            return j + 1
        j += 1
    return n

def _scan_regex(src, i):
    n = len(src)
    j = i + 1
    in_class = False
    while j < n:
        ch = src[j]
        if ch == "\\":
            j += 2
            continue
        if ch == "\n":
            return i
        if in_class:
            if ch == "]":
                in_class = False
        elif ch == "[":
            in_class = True
        elif ch == "/":
            j += 1
            while j < n and src[j].isalpha():
                j += 1
            return j
        j += 1
    return i

def strip_js_comments(src):
    out = []
    i = 0
    n = len(src)
    prev_char = ""
    last_word = ""
    while i < n:
        c = src[i]
        if c == '"' or c == "'" or c == "`":
            j = _skip_literal(src, i, c)
            out.append(src[i:j])
            i = j
            prev_char = c
            last_word = ""
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            if j < 0:
                j = n
            out.append("\n")
            i = j
            continue
        if c == "<" and src.startswith("<!--", i):
            # HTML-комментарий в JS движки считают комментарием до конца строки.
            j = src.find("\n", i)
            if j < 0:
                j = n
            out.append("\n")
            i = j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            end = n if j < 0 else j + 2
            out.append(_keep_newlines(src[i:end]))
            i = end
            continue
        if c == "/" and last_word in JS_REGEX_KEYWORDS:
            end = _scan_regex(src, i)
            if end > i:
                out.append(src[i:end])
                i = end
                prev_char = "/"
                last_word = ""
                continue
        if c == "/" and prev_char in REGEX_PREV_CHARS:
            end = _scan_regex(src, i)
            if end > i:
                out.append(src[i:end])
                i = end
                prev_char = "/"
                last_word = ""
                continue
        out.append(c)
        if not c.isspace():
            prev_char = c
            if c.isalnum() or c == "_" or c == "$":
                last_word += c
            else:
                last_word = ""
        i += 1
    return "".join(out)

def strip_css_comments(src):
    out = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c == '"' or c == "'":
            j = _skip_literal(src, i, c)
            out.append(src[i:j])
            i = j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            end = n if j < 0 else j + 2
            out.append(_keep_newlines(src[i:end]))
            i = end
            continue
        out.append(c)
        i += 1
    return "".join(out)

def strip_html_comments(src):
    return HTML_COMMENT_REGEX.sub(lambda m: _keep_newlines(m.group(0)), src)

def strip_comments(html):
    out = []
    i = 0
    n = len(html)
    while i < n:
        match = SCRIPT_TAG_REGEX.search(html, i)
        if not match:
            out.append(strip_html_comments(html[i:]))
            break
        out.append(strip_html_comments(html[i:match.end()]))
        close = SCRIPT_CLOSE_REGEX.search(html, match.end())
        if not close:
            out.append(html[match.end():])
            break
        body = html[match.end():close.start()]
        if match.group(1).lower() == "script":
            out.append(strip_js_comments(body))
        else:
            out.append(strip_css_comments(body))
        out.append(html[close.start():close.end()])
        i = close.end()
    return "".join(out)

# --- Минификация пробелов/переводов (только --minify) --------------------------
# Синтаксис НЕ меняется, только пробелы: Gecko 38 (Firefox 38) запускает файл
# так же, как неминифицированный. Перевод строки сохраняется везде, где от
# него зависит ASI (конец оператора + начало нового), строки/регулярки в JS,
# содержимое textarea/pre и значения атрибутов в HTML не трогаются вообще.

JS_MULTI_OPS = (
    ">>>=", "<<=", ">>=", "===", "!==", ">>>", "<<", ">>", "==", "!=",
    "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=",
    "&=", "|=", "^=", "=>",
)
# "}" здесь нет специально: после "}" перевод строки можно убирать всегда -
# "}" жёсткая граница токена, ASI что с переводом, что с пробелом разберёт
# одинаково ("}else{", "}while(", "}function", ...).
JS_STMT_END = frozenset([")", "]", "++", "--"])
JS_STMT_START = frozenset(["(", "[", "{", "+", "-", "!", "~", "/",
                           "++", "--"])
HTML_WS_REGEX = re.compile(r"[ \t\n\r\f\v]+")
HTML_RAW_BODY = frozenset(["textarea", "pre"])

def _js_is_ident(c):
    return c.isalnum() or c == "_" or c == "$"

def _scan_js_number(src, i):
    n = len(src)
    j = i
    if src[j] == ".":
        j += 1
        while j < n and src[j].isdigit():
            j += 1
    else:
        if j + 1 < n and src[j] == "0" and src[j + 1] in "xX":
            j += 2
            while j < n and (src[j].isdigit() or src[j] in "abcdefABCDEF"):
                j += 1
            return j
        while j < n and src[j].isdigit():
            j += 1
        if j < n and src[j] == ".":
            k = j + 1
            if k < n and src[k].isdigit():
                j += 1
                while j < n and src[j].isdigit():
                    j += 1
    if j < n and src[j] in "eE":
        k = j + 1
        if k < n and src[k] in "+-":
            k += 1
        if k < n and src[k].isdigit():
            j = k + 1
            while j < n and src[j].isdigit():
                j += 1
    return j

def _tokenize_js(src):
    # Список (kind, text, nl_before): kind - ident/number/string/regex/op.
    toks = []
    i = 0
    n = len(src)
    nl = False
    prev_kind = ""
    prev_text = ""
    while i < n:
        c = src[i]
        if c.isspace():
            if c == "\n" or c == "\r":
                nl = True
            i += 1
            continue
        if c == "<" and src.startswith("<!--", i):
            j = src.find("\n", i)
            if j < 0:
                j = n
            else:
                nl = True
            i = j
            continue
        if c == '"' or c == "'" or c == "`":
            j = _skip_literal(src, i, c)
            toks.append(("string", src[i:j], nl))
            nl = False
            prev_kind = "string"
            prev_text = c
            i = j
            continue
        if c.isdigit() or (c == "." and i + 1 < n and src[i + 1].isdigit()):
            j = _scan_js_number(src, i)
            toks.append(("number", src[i:j], nl))
            nl = False
            prev_kind = "number"
            prev_text = src[i:j]
            i = j
            continue
        if c.isalpha() or c == "_" or c == "$" or (c > "\x7f" and c.isalnum()):
            j = i + 1
            while j < n and _js_is_ident(src[j]):
                j += 1
            toks.append(("ident", src[i:j], nl))
            nl = False
            prev_kind = "ident"
            prev_text = src[i:j]
            i = j
            continue
        if c == "/":
            if i + 1 < n and src[i + 1] == "=":
                toks.append(("op", "/=", nl))
                nl = False
                prev_kind = "op"
                prev_text = "/="
                i += 2
                continue
            prev_last = prev_text[-1:] if prev_text else ""
            if (prev_text in JS_REGEX_KEYWORDS or prev_kind == ""
                    or prev_last in REGEX_PREV_CHARS):
                end = _scan_regex(src, i)
                if end > i:
                    toks.append(("regex", src[i:end], nl))
                    nl = False
                    prev_kind = "regex"
                    prev_text = src[i:end]
                    i = end
                    continue
            toks.append(("op", "/", nl))
            nl = False
            prev_kind = "op"
            prev_text = "/"
            i += 1
            continue
        matched = False
        for op in JS_MULTI_OPS:
            if src.startswith(op, i):
                toks.append(("op", op, nl))
                nl = False
                prev_kind = "op"
                prev_text = op
                i += len(op)
                matched = True
                break
        if matched:
            continue
        toks.append(("op", c, nl))
        nl = False
        prev_kind = "op"
        prev_text = c
        i += 1
    return toks

def _js_can_end(kind, text):
    if kind in ("ident", "number", "string", "regex"):
        return True
    return text in JS_STMT_END

def _js_can_start(kind, text):
    if kind in ("ident", "number", "string", "regex"):
        return True
    return text in JS_STMT_START

def _js_need_space(prev_kind, prev_text, kind, text):
    if not prev_text:
        return False
    if prev_text[-1] in "+-" and text[0] in "+-":
        return True
    if prev_text[-1] == "/" and text[0] == "/":
        return True
    if prev_text.endswith("--") and text.startswith(">"):
        return True
    if _js_is_ident(prev_text[-1]) and _js_is_ident(text[0]):
        return True
    if prev_text[-1].isdigit() and text[0] == ".":
        return True
    return False

def minify_js(src):
    toks = _tokenize_js(src)
    out = []
    prev_kind = ""
    prev_text = ""
    for kind, text, nl in toks:
        sep = ""
        if prev_text:
            if nl and _js_can_end(prev_kind, prev_text) \
                    and _js_can_start(kind, text):
                sep = "\n"
            elif _js_need_space(prev_kind, prev_text, kind, text):
                sep = " "
        if text == "}" and out and out[-1] == ";":
            out.pop()
        out.append(sep)
        out.append(text)
        prev_kind = kind
        prev_text = text
    return "".join(out)

def _css_need_space(prev, nxt):
    if prev == "" or prev in "{;:,(>+~!":
        return False
    if nxt in "{}:;,)>+~!":
        return False
    return True

def minify_css(src):
    out = []
    i = 0
    n = len(src)
    depth = 0
    paren = 0
    pend = False
    prev = ""
    while i < n:
        c = src[i]
        if c == '"' or c == "'":
            j = _skip_literal(src, i, c)
            if pend:
                if _css_need_space(prev, c):
                    out.append(" ")
                pend = False
            out.append(src[i:j])
            prev = c
            i = j
            continue
        if c.isspace():
            pend = True
            i += 1
            continue
        if c == "{":
            depth += 1
            pend = False
            out.append("{")
            prev = "{"
            i += 1
            continue
        if c == "}":
            if depth > 0:
                depth -= 1
            pend = False
            if out and out[-1] == ";":
                out.pop()
            out.append("}")
            prev = "}"
            i += 1
            continue
        if c == ":":
            if depth > 0:
                pend = False
            elif pend:
                out.append(" ")
                pend = False
            out.append(":")
            prev = ":"
            i += 1
            continue
        if c == ";" or c == ",":
            pend = False
            out.append(c)
            prev = c
            i += 1
            continue
        if c == "(":
            if pend:
                out.append(" ")
                pend = False
            out.append("(")
            prev = "("
            paren += 1
            i += 1
            continue
        if c == ")":
            pend = False
            if paren > 0:
                paren -= 1
            out.append(")")
            prev = ")"
            i += 1
            continue
        if c == "!" or ((c == ">" or c == "~") and paren == 0):
            pend = False
            out.append(c)
            prev = c
            i += 1
            continue
        if pend:
            if _css_need_space(prev, c):
                out.append(" ")
            pend = False
        out.append(c)
        prev = c
        i += 1
    return "".join(out)

def minify_tag(tag):
    out = []
    i = 0
    n = len(tag)
    quote = None
    pend = False
    while i < n:
        c = tag[i]
        if quote:
            out.append(c)
            if c == quote:
                quote = None
            i += 1
            continue
        if c == '"' or c == "'":
            quote = c
            out.append(c)
            i += 1
            continue
        if c.isspace():
            pend = True
            i += 1
            continue
        if c == "=":
            if out and out[-1] == " ":
                out.pop()
            out.append("=")
            i += 1
            while i < n and tag[i].isspace():
                i += 1
            pend = False
            continue
        if c == ">":
            if out and out[-1] == " ":
                out.pop()
            out.append(">")
            i += 1
            pend = False
            continue
        if pend:
            if out and out[-1] != "<":
                out.append(" ")
            pend = False
        out.append(c)
        i += 1
    return "".join(out)

def _tag_name(html, lt):
    n = len(html)
    j = lt + 1
    close = False
    if j < n and html[j] == "/":
        close = True
        j += 1
    k = j
    while k < n and html[k].isalnum():
        k += 1
    if j < n and html[j] == "!":
        return ("!", close)
    return (html[j:k].lower(), close)

def _find_tag_end(html, lt):
    n = len(html)
    j = lt + 1
    quote = None
    while j < n:
        c = html[j]
        if quote:
            if c == quote:
                quote = None
        elif c == '"' or c == "'":
            quote = c
        elif c == ">":
            return j + 1
        j += 1
    return n

def _find_close_tag(html, name, pos):
    cs = html.lower().find("</" + name, pos)
    if cs < 0:
        return -1, -1
    ce = html.find(">", cs)
    if ce < 0:
        return -1, -1
    return cs, ce + 1

def minify_full(html):
    out = []
    i = 0
    n = len(html)
    while i < n:
        lt = html.find("<", i)
        if lt < 0:
            out.append(HTML_WS_REGEX.sub(" ", html[i:]))
            break
        if lt > i:
            out.append(HTML_WS_REGEX.sub(" ", html[i:lt]))
        if html.startswith("<!--", lt):
            j = html.find("-->", lt + 4)
            i = n if j < 0 else j + 3
            continue
        if lt + 1 >= n or not (html[lt + 1].isalpha()
                               or html[lt + 1] in "!/"):
            out.append("<")
            i = lt + 1
            continue
        name, close = _tag_name(html, lt)
        if name in ("script", "style") and not close:
            te = _find_tag_end(html, lt)
            cs, ce = _find_close_tag(html, name, te)
            if cs < 0:
                out.append(minify_tag(html[lt:te]))
                out.append(html[te:])
                break
            body = html[te:cs]
            if name == "script":
                body = minify_js(body)
            else:
                body = minify_css(body)
            out.append(minify_tag(html[lt:te]))
            out.append(body)
            out.append(html[cs:ce])
            i = ce
            continue
        if name in HTML_RAW_BODY and not close:
            te = _find_tag_end(html, lt)
            cs, ce = _find_close_tag(html, name, te)
            if cs < 0:
                out.append(minify_tag(html[lt:te]))
                out.append(html[te:])
                break
            out.append(minify_tag(html[lt:te]))
            out.append(html[te:cs])
            out.append(html[cs:ce])
            i = ce
            continue
        te = _find_tag_end(html, lt)
        out.append(minify_tag(html[lt:te]))
        i = te
    return "".join(out).strip()

def build(minify=True, compact=False):
    print("--- СБОРКА ИЗДЕЛИЯ МОРЗЕ-М ---")
    if not os.path.exists(TEMPLATE_PATH):
        print("ОШИБКА: Не найден {}".format(TEMPLATE_PATH))
        return

    with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
        template = f.read()

    result = resolve_includes(template)

    raw_size = len(result.encode("utf-8"))
    if minify:
        result = strip_comments(result)
    nospace_size = len(result.encode("utf-8"))
    target = OUTPUT_PATH
    if compact:
        result = minify_full(result)
        target = OUTPUT_MIN_PATH

    if not os.path.exists(BUILD_DIR):
        os.makedirs(BUILD_DIR)

    with open(target, "w", encoding="utf-8") as f:
        f.write(result)

    print("\n[ГОТОВО] Сформирован единый файл: {}".format(target))
    print("Размер: {} КБ".format(os.path.getsize(target) // 1024))
    if minify:
        print("Без комментариев: {} -> {} байт (-{}%)".format(
            raw_size,
            nospace_size,
            round((1.0 - nospace_size / float(raw_size)) * 100, 1)))
    if compact:
        final_size = os.path.getsize(target)
        print("Минификация: {} -> {} байт (-{}%, итого -{}%)".format(
            nospace_size,
            final_size,
            round((1.0 - final_size / float(nospace_size)) * 100, 1),
            round((1.0 - final_size / float(raw_size)) * 100, 1)))

def watch():
    print("[РЕЖИМ НАБЛЮДЕНИЯ] Сборщик следит за изменениями в src/...")
    last_mtime = 0
    while True:
        try:
            max_mtime = 0
            for root, _, files in os.walk(SRC_DIR):
                for f in files:
                    full_path = os.path.join(root, f)
                    max_mtime = max(max_mtime, os.path.getmtime(full_path))

            if max_mtime > last_mtime:
                last_mtime = max_mtime
                build(minify=False)
            time.sleep(0.5)
        except KeyboardInterrupt:
            print("\nОстановка наблюдения.")
            break

if __name__ == "__main__":
    if "--watch" in sys.argv:
        watch()
    elif "--minify" in sys.argv or "--release" in sys.argv:
        build(minify=True, compact=True)
    else:
        build()
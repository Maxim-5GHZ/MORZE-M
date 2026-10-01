#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Сборщик изделия "МОРЗЕ-М" (ASTRA EDITION).
# Раскладка: src/ + build.py -> единый файл Морзе-М_Astra_Edition.html.
# Запуск:  python3 build.py            (однократная сборка)
#          python3 build.py --watch    (автопересборка при изменении файлов в src/)
# Зависимостей нет: только стандартная библиотека Python 3.
# F-строки намеренно НЕ используются - совместимость с Python 3.4/3.5 (Astra Linux 1.6).
import os
import re
import sys
import time


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE_DIR, "src")
TEMPLATE_PATH = os.path.join(SRC_DIR, "index.html")
OUTPUT_PATH = os.path.join(BASE_DIR, "Морзе-М.html")

INCLUDE_REGEX = re.compile(r'/\*\s*@include\s+([^\s\*]+)\s*\*/')

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

    return INCLUDE_REGEX.sub(replace_match, content)

def build():
    print("--- СБОРКА ИЗДЕЛИЯ МОРЗЕ-М ---")
    if not os.path.exists(TEMPLATE_PATH):
        print("ОШИБКА: Не найден {}".format(TEMPLATE_PATH))
        return

    with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
        template = f.read()

    result = resolve_includes(template)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(result)

    print("\n[ГОТОВО] Сформирован единый файл: {}".format(OUTPUT_PATH))
    print("Размер: {} КБ".format(os.path.getsize(OUTPUT_PATH) // 1024))

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
                build()
            time.sleep(0.5)
        except KeyboardInterrupt:
            print("\nОстановка наблюдения.")
            break

if __name__ == "__main__":
    if "--watch" in sys.argv:
        watch()
    else:
        build()
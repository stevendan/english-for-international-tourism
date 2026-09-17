# -*- coding: utf-8 -*-
"""Sinh book-data.js — bản nhúng của english-for-international-tourism.md + danh sách tệp audio.

Trang đọc thẳng english-for-international-tourism.md khi chạy qua http. Mở bằng file:// thì fetch
bị chặn, nên script.js quay về dùng window.BOOK_MD trong book-data.js.

    python build_data.py
"""
import io
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "english-for-international-tourism.md")
AUDIO_DIR = os.path.join(HERE, "audio")
TARGET = os.path.join(HERE, "book-data.js")

TRACK_RE = re.compile(r"^Track(\d+)_(\d+)\.mp3$", re.IGNORECASE)

HEADER = (
    "// Tệp này được sinh tự động — đừng sửa tay.\n"
    "// Sinh lại: python build_data.py  "
    "(hoặc chạy trang qua http để đọc thẳng english-for-international-tourism.md)\n"
)


def audio_files():
    names = os.listdir(AUDIO_DIR) if os.path.isdir(AUDIO_DIR) else []
    tracks = []
    for name in names:
        m = TRACK_RE.match(name)
        if m:
            tracks.append({
                "name": name,
                "src": "audio/" + name,
                "unit": int(m.group(1)),
                "index": int(m.group(2)),
            })
    tracks.sort(key=lambda t: (t["unit"], t["index"]))
    return tracks


def main():
    with io.open(SOURCE, encoding="utf-8") as f:
        markdown = f.read()
    tracks = audio_files()

    out = [
        HEADER,
        "window.BOOK_MD = " + json.dumps(markdown, ensure_ascii=False) + ";\n",
        "window.AUDIO_FILES = " + json.dumps(tracks, ensure_ascii=False, indent=1) + ";\n",
    ]
    with io.open(TARGET, "w", encoding="utf-8", newline="\n") as f:
        f.write("".join(out))

    print("book-data.js: %d ký tự markdown, %d tệp audio." % (len(markdown), len(tracks)))


if __name__ == "__main__":
    main()

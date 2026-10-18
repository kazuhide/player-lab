#!/usr/bin/env python3
"""Convert a SubRip (.srt) file to WebVTT (.vtt), shifting all cues so the first
one starts at ~1 s.

The Sintel movie subtitles begin at 00:01:47, past our short (10-52 s) test
clips, so without the shift nothing displays in-clip. SubRip and WebVTT differ
only in the header and the `,`/`.` millisecond separator, plus we re-base the
timeline.

Usage: srt-to-vtt.py <input.srt> <output.vtt>
"""
import re
import sys


def to_ms(ts: str) -> int:
    h, m, rest = ts.split(":")
    s, ms = rest.split(",")
    return ((int(h) * 60 + int(m)) * 60 + int(s)) * 1000 + int(ms)


def to_vtt(ms: int) -> str:
    ms = max(0, ms)
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def main(src_path: str, dst_path: str) -> int:
    src = open(src_path, encoding="utf-8-sig").read()
    cues = []
    first = None
    for block in re.split(r"\n\s*\n", src.strip()):
        lines = block.strip().split("\n")
        time_line = next((l for l in lines if "-->" in l), None)
        if not time_line:
            continue
        a, b = (x.strip() for x in time_line.split("-->"))
        start, end = to_ms(a), to_ms(b)
        if first is None:
            first = start
        text = [l for l in lines if "-->" not in l and not l.strip().isdigit()]
        cues.append((start, end, text))

    if not cues:
        print("no cues found", file=sys.stderr)
        return 1

    shift = first - 1000  # first cue -> ~1.0s
    out = ["WEBVTT", ""]
    for start, end, text in cues:
        out.append(f"{to_vtt(start - shift)} --> {to_vtt(end - shift)}")
        out += text + [""]
    open(dst_path, "w", encoding="utf-8").write("\n".join(out))
    print(f"wrote {dst_path}: {len(cues)} cues, shifted -{shift}ms")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1], sys.argv[2]))

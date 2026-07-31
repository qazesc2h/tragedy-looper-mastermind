#!/usr/bin/env python3
"""PostToolUse — src/impl 편집 후 프로젝트 규약 위반을 탐지해 경고한다.
차단하지 않고 알리기만 한다(exit 0 + stderr).
"""
import json, sys, re, pathlib

try:
    payload = json.loads(sys.stdin.read() or "{}")
except Exception:
    sys.exit(0)

inp = payload.get("tool_input", {}) or {}
path = str(inp.get("file_path") or inp.get("path") or "").replace("\\", "/")
if "/src/" not in path or not path.endswith(".ts"):
    sys.exit(0)

try:
    text = pathlib.Path(path).read_text(encoding="utf-8")
except Exception:
    sys.exit(0)

warn = []
if re.search(r"scenario\.cast\s*\[", text):
    warn.append("scenario.cast[...] 직접 참조 발견 → effectiveRole(state, char) 로 교체할 것. "
                "망상 확대 바이러스의 역할 변이를 놓친다.")
if "unimplemented" in text and "TODO(구현)" not in text:
    warn.append("throw new Error('unimplemented') 가 남아 있는데 TODO 주석이 지워졌다. "
                "구현 누락 지점을 추적할 수 없게 된다.")
if re.search(r"//\s*TODO\(구현\)", text) and "when: (_s" not in text:
    pass

if warn:
    print("규약 점검:\n- " + "\n- ".join(warn), file=sys.stderr)
sys.exit(0)

#!/usr/bin/env python3
"""PreToolUse 가드 — 프로젝트를 망가뜨리는 동작을 차단한다.

exit 0 : 통과
exit 2 : 차단. stderr 가 클로드에게 전달된다.
"""
import json, sys

try:
    payload = json.loads(sys.stdin.read() or "{}")
except Exception:
    sys.exit(0)          # 파싱 실패 시 통과 — 가드가 작업을 막지 않도록

tool = str(payload.get("tool_name", ""))
inp = payload.get("tool_input", {}) or {}
blob = json.dumps(inp, ensure_ascii=False)

def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(2)

# ── gen.py 실행 차단 ────────────────────────────────────────────
if tool == "Bash" and "gen.py" in blob:
    die("차단: gen.py 는 스캐폴딩 생성기다. 실행하면 src/impl/*.ts 의 "
        "when/effect 구현이 전부 빈 스텁으로 되돌아간다. "
        "CLAUDE.md 절대 규칙 2번. 우회하지 말고 사용자에게 알려라.")

# ── 픽스처 수정 차단 ───────────────────────────────────────────
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
path = str(inp.get("file_path") or inp.get("path") or "")

if tool in WRITE_TOOLS and "test/fixtures/" in path.replace("\\", "/"):
    die("차단: test/fixtures/ 는 한국어판 공식 설명서의 진행 예시를 "
        "그대로 옮긴 것이다. 이것이 정답이다. "
        "테스트가 실패하면 픽스처가 아니라 구현을 고쳐라. "
        "픽스처가 정말 틀렸다고 판단되면 수정하지 말고 사용자에게 근거를 제시해라.")

if tool == "Bash":
    low = blob.lower()
    if "test/fixtures" in low and any(k in low for k in (">", "sed -i", "tee ", "rm ", "mv ")):
        die("차단: 셸로 test/fixtures/ 를 수정하려 했다. 위와 동일한 이유로 금지.")

# ── data/ 생성물 수정 경고 ─────────────────────────────────────
if tool in WRITE_TOOLS and "/data/" in path.replace("\\", "/") and path.endswith(".json"):
    die("차단: data/*.json 은 gen.py 가 만든 생성물이다. 직접 수정하지 마라. "
        "값이 틀렸다면 사용자에게 알려라.")

sys.exit(0)

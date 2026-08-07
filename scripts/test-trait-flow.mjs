import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 4176;
const origin = `http://127.0.0.1:${port}`;
const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => existsSync(candidate));

if (!chrome) {
  throw new Error(
    "Chrome/Chromium을 찾지 못했습니다. CHROME_BIN에 실행 파일 경로를 지정하세요.",
  );
}

const vite = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let viteOutput = "";
vite.stdout.on("data", (chunk) => {
  viteOutput += chunk.toString();
});
vite.stderr.on("data", (chunk) => {
  viteOutput += chunk.toString();
});

const profile = mkdtempSync(join(tmpdir(), "tragedy-looper-trait-flow-"));

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) {
      throw new Error(`Vite가 일찍 종료되었습니다.\n${viteOutput}`);
    }
    try {
      const response = await fetch(`${origin}/test/trait-flow.html`);
      if (response.ok) return;
    } catch {
      // 서버가 소켓을 열 때까지 다시 확인한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite 시작 대기 시간이 초과되었습니다.\n${viteOutput}`);
}

try {
  await waitForServer();
  const browser = spawnSync(
    chrome,
    [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-service-autorun",
      `--user-data-dir=${profile}`,
      "--virtual-time-budget=20000",
      "--dump-dom",
      `${origin}/test/trait-flow.html`,
    ],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
  );

  const output = `${browser.stdout ?? ""}\n${browser.stderr ?? ""}`;
  const flowPassed = browser.stdout?.includes('data-trait-flow-result="pass"') &&
    browser.stdout.includes("PASS");
  const timedOutAfterResult = browser.error &&
    "code" in browser.error && browser.error.code === "ETIMEDOUT" &&
    flowPassed;
  if (
    !flowPassed ||
    (browser.error && !timedOutAfterResult) ||
    (browser.status !== 0 && browser.status !== null)
  ) {
    throw new Error(
      `캐릭터 특성 실제 UI 검사가 실패했습니다.\n${output}`,
      browser.error ? { cause: browser.error } : undefined,
    );
  }
  process.stdout.write(
    timedOutAfterResult
      ? "캐릭터 특성 실제 UI 검사 통과 (결과 출력 후 Chrome 강제 종료)\n"
      : "캐릭터 특성 실제 UI 검사 통과\n",
  );
} finally {
  vite.kill("SIGTERM");
  rmSync(profile, { recursive: true, force: true });
}

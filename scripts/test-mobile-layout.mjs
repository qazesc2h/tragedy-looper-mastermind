import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 4174;
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

const profile = mkdtempSync(join(tmpdir(), "tragedy-looper-layout-"));

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) {
      throw new Error(`Vite가 일찍 종료되었습니다.\n${viteOutput}`);
    }
    try {
      const response = await fetch(`${origin}/test/mobile-layout.html`);
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
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "--window-size=1280,1000",
      "--virtual-time-budget=20000",
      "--dump-dom",
      `${origin}/test/mobile-layout.html`,
    ],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
  );

  const output = `${browser.stdout ?? ""}\n${browser.stderr ?? ""}`;
  if (
    browser.error || browser.status !== 0 ||
    !browser.stdout?.includes('data-layout-result="pass"') ||
    !browser.stdout.includes("PASS")
  ) {
    throw new Error(
      `390px 모바일 레이아웃 검사가 실패했습니다.\n${output}`,
      browser.error ? { cause: browser.error } : undefined,
    );
  }
  process.stdout.write("390px 실제 브라우저 레이아웃 검사 통과\n");
} finally {
  vite.kill("SIGTERM");
  rmSync(profile, { recursive: true, force: true });
}

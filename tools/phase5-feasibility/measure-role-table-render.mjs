import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 4175;
const origin = `http://127.0.0.1:${port}`;
const chrome = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean).find((candidate) => existsSync(candidate));
if (!chrome) throw new Error("Chrome/Chromium을 찾지 못했습니다.");

const vite = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js",
  "--host",
  "127.0.0.1",
  "--port",
  String(port),
  "--strictPort",
], { stdio: ["ignore", "pipe", "pipe"] });
let viteOutput = "";
vite.stdout.on("data", (chunk) => { viteOutput += chunk.toString(); });
vite.stderr.on("data", (chunk) => { viteOutput += chunk.toString(); });
const profile = mkdtempSync(join(tmpdir(), "tragedy-role-render-"));
const marks = new Map();
const samples = new Map();
let finishMeasurement;
const measurementDone = new Promise((resolve) => {
  finishMeasurement = resolve;
});
const timingServer = createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4176");
  const key = url.searchParams.get("key");
  if (key !== null) marks.set(key, process.hrtime.bigint());
  const timingKey = url.searchParams.get("timingKey");
  if (url.pathname === "/sample" && timingKey !== null) {
    samples.set(timingKey, {
      timingKey,
      observations: Number(url.searchParams.get("observations")),
      elements: Number(url.searchParams.get("elements")),
      htmlBytes: Number(url.searchParams.get("htmlBytes")),
      overlayPresent: url.searchParams.get("overlayPresent") === "true",
    });
  }
  if (url.pathname === "/done") {
    finishMeasurement(url.searchParams.get("error"));
  }
  response.end("ok");
});

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `${origin}/tools/phase5-feasibility/role-table-render.html`,
      );
      if (response.ok) return;
    } catch {
      // Vite가 소켓을 열 때까지 재시도한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite 시작 실패\n${viteOutput}`);
}

try {
  await new Promise((resolve, reject) => {
    timingServer.once("error", reject);
    timingServer.listen(4176, "127.0.0.1", resolve);
  });
  await waitForServer();
  const browser = spawn(chrome, [
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
    "--window-size=390,844",
    "--virtual-time-budget=30000",
    "--dump-dom",
    `${origin}/tools/phase5-feasibility/role-table-render.html`,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  browser.stdout.resume();
  browser.stderr.resume();
  let measurementTimeout;
  const failure = await Promise.race([
    measurementDone,
    new Promise((_, reject) => {
      measurementTimeout = setTimeout(
        () => reject(new Error("Chrome 역할표 측정 시간 초과")),
        45_000,
      );
    }),
  ]);
  clearTimeout(measurementTimeout);
  browser.kill("SIGTERM");
  browser.stdout.destroy();
  browser.stderr.destroy();
  browser.unref();
  if (failure !== null) throw new Error(`브라우저 측정 실패: ${failure}`);
  const report = {
    rows: [3, 4, 5].map((loopCount) => ({
      loopCount,
      samples: [0, 1, 2].map((sample) => {
        const measured = samples.get(`${loopCount}-${sample}`);
        if (measured === undefined) {
          throw new Error(`측정 표본 누락: ${loopCount}-${sample}`);
        }
        return measured;
      }),
    })),
  };
  for (const row of report.rows) {
    for (const sample of row.samples) {
      const start = marks.get(`${sample.timingKey}-render-start`);
      const end = marks.get(`${sample.timingKey}-render-end`);
      const baselineStart = marks.get(`${sample.timingKey}-baseline-start`);
      const baselineEnd = marks.get(`${sample.timingKey}-baseline-end`);
      if (
        start === undefined || end === undefined ||
        baselineStart === undefined || baselineEnd === undefined
      ) throw new Error(`측정 마커 누락: ${sample.timingKey}`);
      sample.milliseconds = Math.max(
        0,
        Number(end - start - (baselineEnd - baselineStart)) / 1_000_000,
      );
    }
    row.samples.sort((left, right) => left.milliseconds - right.milliseconds);
    row.median = row.samples[1];
  }
  for (const { loopCount, median } of report.rows) {
    process.stdout.write(
      `${loopCount}루프 ${median.observations}관측: ` +
        `${median.milliseconds.toFixed(1)}ms, DOM ${median.elements}, ` +
        `HTML ${median.htmlBytes} bytes, overlay=${median.overlayPresent}\n`,
    );
  }
} finally {
  vite.kill("SIGTERM");
  vite.stdout.destroy();
  vite.stderr.destroy();
  vite.unref();
  timingServer.close();
  timingServer.closeAllConnections?.();
  try {
    rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // Chrome 보조 프로세스가 프로필 파일을 잠시 갱신할 수 있다.
  }
}

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve(process.cwd(), "../docs/screenshots");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const shots = [
  { name: "desktop-today", path: "/today", viewport: { width: 1440, height: 1000 } },
  { name: "desktop-client", path: "/people/morgan-reed", viewport: { width: 1440, height: 1000 } },
  { name: "desktop-pipeline", path: "/pipeline", viewport: { width: 1440, height: 1000 } },
  { name: "desktop-executive", path: "/executive", viewport: { width: 1440, height: 1000 } },
  { name: "tablet-today", path: "/today", viewport: { width: 820, height: 1180 } },
  { name: "mobile-today", path: "/today", viewport: { width: 390, height: 844 } },
  { name: "mobile-client", path: "/people/morgan-reed", viewport: { width: 390, height: 844 } },
];
for (const shot of shots) {
  const context = await browser.newContext({ viewport: shot.viewport, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:3000${shot.path}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: resolve(output, `${shot.name}.png`), fullPage: true });
  await context.close();
}
await browser.close();

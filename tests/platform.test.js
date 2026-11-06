import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPlatform } from "../public/src/platform.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

test("an iPhone in Safari must install first", () => {
  const p = detectPlatform({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5 });
  assert.deepEqual([p.ios, p.standalone, p.needsInstallFirst], [true, false, true]);
});

test("an iPhone with the app on the Home Screen may start", () => {
  assert.equal(detectPlatform({ userAgent: IPHONE, navigatorStandalone: true }).needsInstallFirst, false);
  assert.equal(detectPlatform({ userAgent: IPHONE, standaloneMedia: true }).needsInstallFirst, false);
});

test("an iPad that reports itself as a Mac counts as iOS", () => {
  const p = detectPlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 });
  assert.equal(p.needsInstallFirst, true);
  const mac = detectPlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 });
  assert.equal(mac.needsInstallFirst, false);
});

test("Android in a browser tab may start and can offer Install", () => {
  const p = detectPlatform({ userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5 });
  assert.deepEqual([p.android, p.ios, p.needsInstallFirst], [true, false, false]);
});

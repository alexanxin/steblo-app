// Which phone is this, and is the app installed? Pure, so it can be tested: the caller passes the facts in.
// On iOS the browser and the Home Screen app keep separate storage, so first start there must wait for the install.

/** facts: { userAgent, platform, maxTouchPoints, standaloneMedia, navigatorStandalone } */
export function detectPlatform(facts = {}) {
  const ua = String(facts.userAgent || "");
  const iPadOnMac = facts.platform === "MacIntel" && (facts.maxTouchPoints || 0) > 1; // iPadOS says it is a Mac
  const ios = /iphone|ipad|ipod/i.test(ua) || iPadOnMac;
  const android = /android/i.test(ua);
  const standalone = !!(facts.standaloneMedia || facts.navigatorStandalone);
  return { ios, android, standalone, needsInstallFirst: ios && !standalone };
}

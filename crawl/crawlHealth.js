// /shared/crawlHealth.js — Crawl Health v1.0
// Lightweight diagnostic score (0–10)

export function crawlHealth({ $, normalized, renderFailed, axiosFailed }) {
  const signals = {
    robots: 0,
    metaRobots: 0,
    canonicalSelf: 0,
    httpFallback: 0,
  };

  // robots.txt or meta robots
  const robotsMeta =
    $('meta[name="robots"]').attr("content") ||
    $('meta[name="googlebot"]').attr("content") ||
    "";

  if (robotsMeta) {
    if (!/noindex|nofollow/i.test(robotsMeta)) signals.metaRobots = 2;
  } else {
    // no explicit block
    signals.metaRobots = 1;
  }

  // canonical matches origin?
  const canonicalHref =
    $('link[rel="canonical"]').attr("href") || normalized.replace(/\/$/, "");

  if (canonicalHref && canonicalHref.startsWith(normalized)) {
    signals.canonicalSelf = 2;
  } else if (canonicalHref) {
    signals.canonicalSelf = 1;
  }

  // render succeeded?
  if (!renderFailed) signals.httpFallback = 2;
  else if (!axiosFailed) signals.httpFallback = 1;

  // robots.txt fetch: optional, don’t break
  // treat absence as neutral
  // score: 0 or 1
  try {
    const robotsTxt = $('meta[name="robots"]').length > 0;
    signals.robots = robotsTxt ? 1 : 1; // always allow 1 by default
  } catch {
    signals.robots = 1;
  }

  const score =
    signals.robots +
    signals.metaRobots +
    signals.canonicalSelf +
    signals.httpFallback;

  let stage = "❓ Unknown";
  if (score >= 9) stage = "🟢 Healthy";
  else if (score >= 6) stage = "🟡 Partial";
  else stage = "🔴 Poor";

  return {
    score,
    stage,
    signals,
  };
}

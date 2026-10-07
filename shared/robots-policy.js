export const PROVIDER_PURPOSES = [
  { provider: "OpenAI", purpose: "training", token: "GPTBot" },
  { provider: "OpenAI", purpose: "search", token: "OAI-SearchBot" },
  { provider: "OpenAI", purpose: "user_request", token: "ChatGPT-User" },
  { provider: "Anthropic", purpose: "training", token: "ClaudeBot" },
  { provider: "Anthropic", purpose: "search", token: "Claude-SearchBot" },
  { provider: "Anthropic", purpose: "user_request", token: "Claude-User" },
  { provider: "Google", purpose: "search", token: "Googlebot" },
  { provider: "Google", purpose: "ai_use", token: "Google-Extended" },
  { provider: "Perplexity", purpose: "search", token: "PerplexityBot" },
  { provider: "Perplexity", purpose: "user_request", token: "Perplexity-User" }
];

export function parseRobots(text) {
  const groups = [];
  let agents = [];
  let rules = [];

  const flush = () => {
    if (agents.length) groups.push({ agents: [...new Set(agents)], rules: [...rules] });
    agents = [];
    rules = [];
  };

  for (const original of String(text || "").split(/\r?\n/)) {
    const line = original.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (rules.length) flush();
      if (value) agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && agents.length) {
      if (field === "disallow" && value === "") continue;
      rules.push({ directive: field, pattern: value });
    }
  }
  flush();
  return groups;
}

function matchingGroups(groups, token) {
  const normalized = token.toLowerCase();
  const exact = groups.filter(group => group.agents.includes(normalized));
  return exact.length ? exact : groups.filter(group => group.agents.includes("*"));
}

function ruleRegex(pattern) {
  const anchored = pattern.endsWith("$");
  const source = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`);
}

export function evaluateRobots(groups, token, pathname = "/") {
  const selected = matchingGroups(groups, token);
  if (!selected.length) return { decision: "allowed", matched: false, reason: "no_matching_group", rule: null };

  const candidates = selected.flatMap(group => group.rules).filter(rule => {
    try { return ruleRegex(rule.pattern).test(pathname); }
    catch { return false; }
  }).map(rule => ({ ...rule, specificity: rule.pattern.replace(/[\*$]/g, "").length }));

  if (!candidates.length) return { decision: "allowed", matched: true, reason: "no_matching_rule", rule: null };
  candidates.sort((a, b) => b.specificity - a.specificity || (a.directive === "allow" ? -1 : 1));
  const winner = candidates[0];
  return {
    decision: winner.directive === "disallow" ? "disallowed" : "allowed",
    matched: true,
    reason: "matched_rule",
    rule: { directive: winner.directive, pattern: winner.pattern }
  };
}

export function providerPolicyMatrix({ robotsText, robotsStatus, targetUrl }) {
  const path = (() => {
    try { const url = new URL(targetUrl); return `${url.pathname || "/"}${url.search || ""}`; }
    catch { return "/"; }
  })();

  if (robotsStatus === "unreachable" || robotsStatus === "fetch_error") {
    return PROVIDER_PURPOSES.map(item => ({ ...item, decision: "unknown", reason: robotsStatus, rule: null }));
  }

  const groups = robotsStatus === "available" ? parseRobots(robotsText) : [];
  return PROVIDER_PURPOSES.map(item => ({ ...item, ...evaluateRobots(groups, item.token, path) }));
}

export function declaredAccessPosture(matrix) {
  const decisions = matrix.map(item => item.decision).filter(value => value !== "unknown");
  if (!decisions.length) return "unknown";
  const allowed = decisions.filter(value => value === "allowed").length;
  const disallowed = decisions.filter(value => value === "disallowed").length;
  if (allowed && disallowed) return "selective";
  if (disallowed) return "restrictive";
  return "permissive";
}

export function directiveTokens(value) {
  return [...new Set(String(value || "").toLowerCase().split(/[\s,]+/).map(token => token.trim()).filter(Boolean))];
}

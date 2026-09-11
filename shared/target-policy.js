import axios from "axios";
import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOST_SUFFIXES = [
  ".localhost", ".local", ".internal", ".test", ".invalid", ".example"
];

const NON_PUBLIC_V4 = new net.BlockList();
const NON_PUBLIC_V6 = new net.BlockList();
for (const [base, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4]
]) NON_PUBLIC_V4.addSubnet(base, prefix, "ipv4");
for (const [base, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96],
  ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32],
  ["2001:2::", 48], ["2001:db8::", 32], ["2001:10::", 28],
  ["2001:20::", 28], ["2002::", 16], ["fc00::", 7],
  ["fe80::", 10], ["ff00::", 8]
]) NON_PUBLIC_V6.addSubnet(base, prefix, "ipv6");

export function isPublicAddress(address) {
  const value = String(address || "").trim().toLowerCase();
  const family = net.isIP(value);
  if (family === 4) return !NON_PUBLIC_V4.check(value, "ipv4");
  if (family === 6) {
    const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    return !NON_PUBLIC_V6.check(value, "ipv6");
  }
  return false;
}

export function validateTarget(raw, { allowBareHost = true } = {}) {
  let value = String(raw || "").trim();
  if (!value) return { ok: false, status: 400, error: "Missing URL." };
  if (value.length > 2048) return { ok: false, status: 414, error: "URL is too long." };
  if (allowBareHost && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;

  let parsed;
  try { parsed = new URL(value); }
  catch { return { ok: false, status: 400, error: "URL must be a valid public HTTPS URL." }; }

  if (parsed.protocol !== "https:") return { ok: false, status: 400, error: "URL must use HTTPS." };
  if (parsed.username || parsed.password) return { ok: false, status: 400, error: "URL must not contain credentials." };
  if (parsed.port && parsed.port !== "443") return { ok: false, status: 400, error: "URL must use the standard HTTPS port." };

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))) {
    return { ok: false, status: 400, error: "URL host is not allowed." };
  }
  if (net.isIP(host) || host.startsWith("[") || host.includes(":")) {
    return { ok: false, status: 400, error: "IP-literal hosts are not allowed." };
  }
  parsed.hostname = host;
  parsed.hash = "";
  return { ok: true, url: parsed.toString(), host };
}

export async function resolvePublicHost(hostname, resolver = dns.lookup) {
  const addresses = await resolver(hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0) throw Object.assign(new Error("Host did not resolve."), { code: "ENOTFOUND" });
  if (addresses.some(item => !isPublicAddress(item.address))) {
    throw Object.assign(new Error("Host resolves to a non-public address."), { code: "ERR_NON_PUBLIC_ADDRESS" });
  }
  return addresses;
}

function makeSecureLookup(resolver) {
  return (hostname, options, callback) => {
    const normalizedOptions = typeof options === "number" ? { family: options } : (options || {});
    resolvePublicHost(hostname, resolver).then(addresses => {
      const requestedFamily = Number(normalizedOptions.family || 0);
      const eligible = requestedFamily ? addresses.filter(item => item.family === requestedFamily) : addresses;
      if (!eligible.length) return callback(Object.assign(new Error("No address for requested family."), { code: "ENOTFOUND" }));
      if (normalizedOptions.all) return callback(null, eligible);
      callback(null, eligible[0].address, eligible[0].family);
    }).catch(callback);
  };
}

export async function fetchPublicUrl(raw, options = {}) {
  const {
    timeoutMs = 10_000,
    maxRedirects = 5,
    maxBytes = 2_000_000,
    accept = "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5",
    userAgent = "Mozilla/5.0 (compatible; exmxc-evidence-collector/2.0; +https://exmxc.ai)",
    httpGet = axios.get,
    resolver = dns.lookup
  } = options;

  let current = validateTarget(raw);
  if (!current.ok) throw Object.assign(new Error(current.error), { code: "ERR_INVALID_TARGET", status: current.status });
  const redirects = [];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await httpGet(current.url, {
      timeout: timeoutMs,
      maxRedirects: 0,
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      responseType: "text",
      validateStatus: () => true,
      lookup: makeSecureLookup(resolver),
      headers: { "User-Agent": userAgent, Accept: accept }
    });

    const status = Number(response.status || 0);
    const location = response.headers?.location;
    if (status >= 300 && status < 400 && location) {
      if (hop === maxRedirects) throw Object.assign(new Error("Redirect limit exceeded."), { code: "ERR_REDIRECT_LIMIT" });
      const candidate = new URL(location, current.url).toString();
      const validated = validateTarget(candidate, { allowBareHost: false });
      if (!validated.ok) throw Object.assign(new Error(`Redirect rejected: ${validated.error}`), { code: "ERR_INVALID_REDIRECT" });
      redirects.push({ from: current.url, to: validated.url, status });
      current = validated;
      continue;
    }

    return {
      requestedUrl: validateTarget(raw).url,
      finalUrl: current.url,
      status,
      headers: response.headers || {},
      body: typeof response.data === "string" ? response.data : "",
      redirects
    };
  }
  throw Object.assign(new Error("Redirect limit exceeded."), { code: "ERR_REDIRECT_LIMIT" });
}

export function networkErrorStatus(error) {
  const code = String(error?.code || "").toUpperCase();
  if (code === "ERR_INVALID_TARGET" || code === "ERR_INVALID_REDIRECT" || code === "ERR_NON_PUBLIC_ADDRESS") return "rejected";
  if (code === "ECONNABORTED" || code === "ETIMEDOUT" || error?.name === "AbortError") return "timeout";
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "dns_error";
  if (code.startsWith("ERR_TLS") || code.includes("CERT")) return "tls_error";
  if (code === "ERR_REDIRECT_LIMIT") return "redirect_error";
  if (code === "ERR_FR_MAX_BODY_LENGTH_EXCEEDED" || code === "ERR_BAD_RESPONSE") return "response_error";
  return "network_error";
}

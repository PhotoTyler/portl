// Shared helpers for the server listing pages. Limits here must match /firestore.rules.

export const PACKAGE = "com.portl.link";
// Share links always use the real domain (the app only accepts portl.click links), even when
// the site is being tested on localhost.
export const SHARE_ORIGIN = "https://portl.click";

export const LIMITS = { name: 48, host: 253, description: 300, tags: 5, reportDetails: 300 };

// Fixed tag list: keeps Discover filters tidy and stops free-text tags being misused.
export const TAGS = [
  "survival", "creative", "smp", "pvp", "minigames", "skyblock", "parkour", "roleplay",
  "building", "economy", "factions", "hardcore", "vanilla", "addons", "family-friendly",
];

export const REPORT_REASONS = {
  broken: "Address doesn't work",
  inappropriate: "Not suitable for kids",
  spam: "Spam or scam",
  impersonation: "Pretending to be another server",
  other: "Something else",
};

// Same colours/labels as the app (Online green, Asleep orange, Offline red, Unknown grey).
export const STATES = {
  online: { label: "Online", rank: 3 },
  asleep: { label: "Asleep", rank: 2 },
  unknown: { label: "Unknown", rank: 1 },
  offline: { label: "Offline", rank: 0 },
};

// meta/status is keyed by a hash of the server ID so private server IDs aren't exposed.
// Keep in sync with statusKey() in .github/report-checker/check-status.mjs.
export async function statusKey(id) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
}

// Status from meta/status for one server; "unknown" until the checker has seen it.
export function statusOf(statusDoc, key) {
  const s = statusDoc && statusDoc.servers && statusDoc.servers[key];
  return s && STATES[s.s] ? s : { s: "unknown" };
}

export function playersText(st) {
  if (st.s !== "online" || st.p == null) return "- players";
  return st.m ? `${st.p} / ${st.m} players` : `${st.p} players`;
}

export function statusBadge(st) {
  return el("span", { class: `status ${st.s}` }, el("i", { "aria-hidden": "true" }), STATES[st.s].label);
}

export function checkedAgo(statusDoc) {
  const t = statusDoc && statusDoc.checkedAt && statusDoc.checkedAt.toMillis ? statusDoc.checkedAt.toMillis() : 0;
  if (!t) return "";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  return min < 1 ? "Checked just now" : `Checked ${min} min ago`;
}

// ---- Recently viewed (this browser only) ----
const RECENT_KEY = "portl-recent";
const RECENT_MAX = 20;

export function recentServers() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function rememberViewed(id, s) {
  try {
    const list = recentServers().filter((r) => r.id !== id);
    list.unshift({ id, name: s.name, host: s.host, port: s.port, viewedAt: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // Storage blocked: nothing to remember.
  }
}

export function clearRecent() {
  try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function cleanLine(s) {
  return String(s || "").replace(CONTROL_CHARS, "").trim();
}

// Descriptions may have line breaks, but no other control characters.
export function cleanText(s) {
  return String(s || "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function isValidHost(host) {
  return host.length > 0 && host.length <= LIMITS.host && /^[A-Za-z0-9.\-]+$/.test(host);
}

export function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// Returns an error message, or null if the server data is OK to save.
export function validateServer(s) {
  if (!s.name) return "Give your server a name.";
  if (s.name.length > LIMITS.name) return `Name can be up to ${LIMITS.name} characters.`;
  if (!isValidHost(s.host)) return "Address can only use letters, numbers, dots and dashes.";
  if (!isValidPort(s.port)) return "Port must be a number from 1 to 65535.";
  if (s.description.length > LIMITS.description) return `Description can be up to ${LIMITS.description} characters.`;
  if (s.tags.length > LIMITS.tags) return `Pick up to ${LIMITS.tags} tags.`;
  if (s.tags.some((t) => !TAGS.includes(t))) return "Unknown tag.";
  if (s.visibility !== "public" && s.visibility !== "private") return "Choose Public or Private.";
  return null;
}

// Same format as the app's ShareLink.kt and /add.html.
function shareQuery(s) {
  const enc = encodeURIComponent;
  return `name=${enc(s.name)}&host=${enc(s.host)}&port=${s.port}`;
}

export function shareLink(s) {
  return `${SHARE_ORIGIN}/add?${shareQuery(s)}`;
}

export function appLink(s) {
  return `portl://add?${shareQuery(s)}`;
}

export function playStoreLink(s) {
  const base = `https://play.google.com/store/apps/details?id=${PACKAGE}`;
  return s ? `${base}&referrer=${encodeURIComponent(shareLink(s))}` : base;
}

export function serverPageLink(id) {
  return `${location.origin}/server/?id=${encodeURIComponent(id)}`;
}

// Small DOM helper. Text is always set with textContent, never innerHTML.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c != null) node.append(c);
  }
  return node;
}

export function tagChip(tag, extra = {}) {
  return el("span", { class: "tag", text: tag, ...extra });
}

// Draws a crisp, blocky QR code onto a canvas (qrcode-generator must be loaded globally).
export function drawQr(canvas, text, scale = 8) {
  const qr = window.qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  const size = (count + quiet * 2) * scale;
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, size, size);
  g.fillStyle = "#000";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
  }
}

export function friendlyError(e) {
  const code = e && e.code;
  if (code === "permission-denied") return "You don't have permission to do that.";
  if (code === "unavailable") return "Can't reach the server list right now. Check your connection.";
  if (code === "auth/unauthorized-domain") return "Sign-in isn't set up for this website yet.";
  return "Something went wrong. Please try again.";
}

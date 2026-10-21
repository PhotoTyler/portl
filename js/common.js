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

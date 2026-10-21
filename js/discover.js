import { collection, getDocs, limit, query, where } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { TAGS, el, tagChip, friendlyError } from "./common.js";

const search = document.getElementById("search");
const tagBox = document.getElementById("tag-filters");
const cards = document.getElementById("cards");
const status = document.getElementById("status");

const selected = new Set();
let servers = null; // null until loaded

for (const tag of TAGS) {
  const chip = el("button", { type: "button", class: "tag", "aria-pressed": "false", text: tag });
  chip.addEventListener("click", () => {
    if (selected.has(tag)) selected.delete(tag); else selected.add(tag);
    chip.setAttribute("aria-pressed", String(selected.has(tag)));
    render();
  });
  tagBox.append(chip);
}
search.addEventListener("input", render);

function matches(s, words) {
  if (![...selected].every((t) => s.tags.includes(t))) return false;
  const hay = `${s.name} ${s.host} ${s.description} ${s.tags.join(" ")}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function render() {
  if (!servers) return;
  const text = search.value.trim().toLowerCase();
  // "/time set ..." is handled by sky.js as an Easter egg, so don't filter on it.
  const words = text.startsWith("/") ? [] : text.split(/\s+/).filter(Boolean);
  const shown = servers.filter((s) => matches(s, words));
  cards.replaceChildren(...shown.map(card));
  if (!servers.length) status.textContent = "No public servers yet. Be the first to list yours!";
  else if (!shown.length) status.textContent = "No servers match that search.";
  else status.textContent = `${shown.length} server${shown.length === 1 ? "" : "s"}`;
}

function card(s) {
  return el("a", { class: "card", href: `/server/?id=${encodeURIComponent(s.id)}` },
    el("h3", { text: s.name }),
    el("div", { class: "addr", text: `${s.host}:${s.port}` }),
    s.description ? el("p", { class: "desc", text: s.description.length > 140 ? s.description.slice(0, 140) + "…" : s.description }) : null,
    s.tags.length ? el("div", { class: "tags" }, s.tags.map((t) => tagChip(t))) : null,
  );
}

async function load() {
  try {
    // Only an equality filter, so no composite index is needed. Sorted here instead.
    const snap = await getDocs(query(collection(db, "servers"), where("visibility", "==", "public"), limit(500)));
    servers = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .map((s) => ({ ...s, tags: Array.isArray(s.tags) ? s.tags : [], description: s.description || "" }))
      .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
    render();
  } catch (e) {
    console.error(e);
    status.textContent = friendlyError(e);
    status.className = "error";
  }
}

load();

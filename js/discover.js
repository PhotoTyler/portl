import { collection, doc, getDoc, getDocs, limit, query, where } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { db } from "./firebase.js?v=9";
import {
  STATES, TAGS, checkedAgo, el, friendlyError, playersText, statusBadge, statusKey, statusOf, tagChip,
} from "./common.js?v=9";

const search = document.getElementById("search");
const tagBox = document.getElementById("tag-filters");
const sortBox = document.getElementById("sort");
const cards = document.getElementById("cards");
const status = document.getElementById("status");

const selected = new Set();
let servers = null; // null until loaded
let statusDoc = null;

// ---- Sorting: several keys at once, in the order picked, each up or down ----
const SORTS = {
  online: { label: "Online", value: (s) => STATES[s.st.s].rank },
  players: { label: "Players", value: (s) => (s.st.s === "online" && s.st.p != null ? s.st.p : -1) },
  likes: { label: "Likes", value: (s) => s.likeCount || 0 },
  adds: { label: "Adds", value: (s) => s.addCount || 0 },
  added: { label: "Date added", value: (s) => s.createdAt?.toMillis?.() || 0 },
};
const SORT_KEY = "portl-discover-sort";
const DEFAULT_SORT = [{ key: "online", dir: "desc" }, { key: "players", dir: "desc" }];
let sort = loadSort();

function loadSort() {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY));
    if (Array.isArray(saved) && saved.every((k) => SORTS[k.key] && (k.dir === "asc" || k.dir === "desc"))) return saved;
  } catch { /* ignore */ }
  return DEFAULT_SORT.map((k) => ({ ...k }));
}

function saveSort() {
  try { localStorage.setItem(SORT_KEY, JSON.stringify(sort)); } catch { /* ignore */ }
}

// Tap: add (high to low) -> flip (low to high) -> remove.
function cycleSort(key) {
  const i = sort.findIndex((k) => k.key === key);
  if (i < 0) sort.push({ key, dir: "desc" });
  else if (sort[i].dir === "desc") sort[i].dir = "asc";
  else sort.splice(i, 1);
  saveSort();
  renderSortBar();
  render();
}

function renderSortBar() {
  const chips = Object.entries(SORTS).map(([key, { label }]) => {
    const i = sort.findIndex((k) => k.key === key);
    const on = i >= 0;
    const chip = el("button", { type: "button", class: "tag", "aria-pressed": String(on), onclick: () => cycleSort(key) },
      on && sort.length > 1 ? `${i + 1}. ${label}` : label,
      on ? el("b", { text: sort[i].dir === "desc" ? "↓" : "↑" }) : null);
    chip.title = on ? (sort[i].dir === "desc" ? "High to low (tap to flip)" : "Low to high (tap to remove)") : "Tap to sort by this";
    return chip;
  });
  sortBox.replaceChildren(...chips);
}

function compare(a, b) {
  for (const { key, dir } of sort) {
    const d = SORTS[key].value(a) - SORTS[key].value(b);
    if (d) return dir === "desc" ? -d : d;
  }
  return a.name.localeCompare(b.name);
}

// ---- Filters ----
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
  const shown = servers.filter((s) => matches(s, words)).sort(compare);
  cards.replaceChildren(...shown.map(card));
  const ago = statusDoc ? ` - ${checkedAgo(statusDoc).toLowerCase()}` : "";
  if (!servers.length) status.textContent = "No public servers yet. Be the first to list yours!";
  else if (!shown.length) status.textContent = "No servers match that search.";
  else status.textContent = `${shown.length} server${shown.length === 1 ? "" : "s"}${ago}`;
}

function card(s) {
  return el("a", { class: "card", href: `/server/?id=${encodeURIComponent(s.id)}` },
    el("div", { class: "top" }, el("h3", { text: s.name }), statusBadge(s.st)),
    el("div", { class: "addr", text: `${s.host}:${s.port}` }),
    s.description ? el("p", { class: "desc", text: s.description.length > 140 ? s.description.slice(0, 140) + "…" : s.description }) : null,
    s.tags.length ? el("div", { class: "tags" }, s.tags.map((t) => tagChip(t))) : null,
    el("div", { class: "stats" },
      el("span", { text: playersText(s.st) }),
      el("span", { text: `♥ ${s.likeCount || 0}` }),
      el("span", { text: `${s.addCount || 0} adds` })),
  );
}

async function load() {
  try {
    // Only an equality filter, so no composite index is needed. Sorted here instead.
    const [snap, statusSnap] = await Promise.all([
      getDocs(query(collection(db, "servers"), where("visibility", "==", "public"), limit(500))),
      getDoc(doc(db, "meta", "status")).catch(() => null),
    ]);
    statusDoc = statusSnap && statusSnap.exists() ? statusSnap.data() : null;
    servers = await Promise.all(snap.docs.map(async (d) => {
      const s = d.data();
      return {
        ...s,
        id: d.id,
        tags: Array.isArray(s.tags) ? s.tags : [],
        description: s.description || "",
        st: statusOf(statusDoc, await statusKey(d.id)),
      };
    }));
    render();
  } catch (e) {
    console.error(e);
    status.textContent = friendlyError(e);
    status.className = "error";
  }
}

renderSortBar();
load();

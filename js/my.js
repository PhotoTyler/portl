import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { db, onUser, signIn, signOutUser } from "./firebase.js?v=6";
import {
  LIMITS, REPORT_REASONS, TAGS, cleanLine, cleanText, clearRecent, el, friendlyError, playersText,
  recentServers, statusBadge, statusKey, statusOf, tagChip, validateServer,
} from "./common.js?v=6";

const $ = (id) => document.getElementById(id);
let user = null;
let servers = [];
let statusDoc = null;
let editing = null; // id of the server being edited, or null when adding
let deleting = null;

// ---- Tabs: My servers / Favourites (need sign-in) and Recent (this browser) ----
const TABS = ["mine", "favourites", "recent"];
const SIGNED_OUT_TEXT = {
  mine: "Own a Minecraft Bedrock server? Sign in to give it a page with an Open in PortL button and a QR code, and list it in Discover.",
  favourites: "Sign in to see the servers you've favourited. Tap ★ Favourite on any server page to add it here.",
};
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "mine";

for (const b of document.querySelectorAll(".tabs button")) {
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    history.replaceState(null, "", tab === "mine" ? location.pathname : `#${tab}`);
    renderView();
  });
}

function renderView() {
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  const needsSignIn = !user && tab !== "recent";
  $("signed-out").classList.toggle("hidden", !needsSignIn);
  $("signed-out-text").textContent = SIGNED_OUT_TEXT[tab] || "";
  for (const t of TABS) $(`tab-${t}`).classList.toggle("hidden", needsSignIn || t !== tab);
  $("sign-out").classList.toggle("hidden", !user);
  $("who").classList.toggle("hidden", !user);
  if (tab === "favourites" && user) loadFavourites();
  if (tab === "recent") renderRecent();
}

// meta/status, written every 15 min by the status checker. Loaded once per page view.
let statusPromise = null;
function loadStatus() {
  statusPromise ??= getDoc(doc(db, "meta", "status"))
    .then((snap) => { statusDoc = snap.exists() ? snap.data() : null; })
    .catch(() => { statusDoc = null; });
  return statusPromise;
}

// A read-only server card (favourites, recent) with status and counts.
async function viewCard(id, s, ...actions) {
  const st = statusOf(statusDoc, await statusKey(id));
  return el("div", { class: "card" },
    el("div", { class: "top" }, el("h3", { text: s.name }), statusBadge(st)),
    el("div", { class: "addr", text: `${s.host}:${s.port}` }),
    el("div", { class: "stats" },
      el("span", { text: playersText(st) }),
      s.likeCount != null ? el("span", { text: `♥ ${s.likeCount}` }) : null,
      s.addCount != null ? el("span", { text: `${s.addCount} adds` }) : null),
    el("div", { class: "actions" },
      el("a", { class: "button small green", href: `/server/?id=${encodeURIComponent(id)}`, text: "View page" }),
      ...actions));
}

async function loadFavourites() {
  $("fav-status").textContent = "Loading favourites…";
  try {
    await loadStatus();
    const favs = await getDocs(collection(db, "users", user.uid, "favorites"));
    const ids = favs.docs
      .sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0))
      .map((d) => d.id);
    // Deleted servers are skipped (getDoc of a missing server just says it doesn't exist).
    const found = (await Promise.all(ids.map(async (id) => {
      const snap = await getDoc(doc(db, "servers", id)).catch(() => null);
      return snap && snap.exists() ? { id, ...snap.data() } : null;
    }))).filter(Boolean);
    const cards = await Promise.all(found.map((s) => viewCard(s.id, s,
      el("button", { class: "button small", type: "button", text: "Unfavourite", onclick: async () => {
        await deleteDoc(doc(db, "users", user.uid, "favorites", s.id)).catch((e) => console.error(e));
        loadFavourites();
      } }))));
    $("fav-cards").replaceChildren(...cards);
    $("fav-status").textContent = found.length ? "" : "No favourites yet. Tap ★ Favourite on a server page to add one.";
  } catch (e) {
    console.error(e);
    $("fav-status").textContent = friendlyError(e);
  }
}

async function renderRecent() {
  const list = recentServers();
  $("recent-status").textContent = list.length
    ? "Servers you've opened on this device."
    : "Servers you open will show up here.";
  $("clear-recent").classList.toggle("hidden", !list.length);
  await loadStatus();
  $("recent-cards").replaceChildren(...await Promise.all(list.map((r) => viewCard(r.id, r))));
}
$("clear-recent").addEventListener("click", () => { clearRecent(); renderRecent(); });

// ---- Sign in / out ----
$("sign-in").addEventListener("click", async () => {
  $("sign-in-error").classList.add("hidden");
  try {
    await signIn();
  } catch (e) {
    console.error(e);
    $("sign-in-error").textContent = friendlyError(e);
    $("sign-in-error").classList.remove("hidden");
  }
});
$("sign-out").addEventListener("click", () => signOutUser());

onUser((u) => {
  user = u;
  servers = [];
  $("loading").classList.add("hidden");
  $("page").classList.remove("hidden");
  if (user) {
    $("who").textContent = `Signed in as ${user.email || user.displayName || "Google user"} (only you see this).`;
    loadServers();
  }
  renderView();
});

// ---- My servers ----
async function loadServers() {
  $("list-status").textContent = "Loading your servers…";
  try {
    const [snap] = await Promise.all([
      getDocs(query(collection(db, "servers"), where("ownerUid", "==", user.uid))),
      loadStatus(),
    ]);
    servers = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name));
    await renderList();
  } catch (e) {
    console.error(e);
    $("list-status").textContent = friendlyError(e);
  }
}

// Set by the report checker (GitHub Action) when it makes a server private after reports.
// The notice stays until the owner makes the server public again.
const hiddenByReports = (s) => s.visibility === "private" && s.moderation && s.moderation.hidden;

function reportNotice(s) {
  const reason = REPORT_REASONS[s.moderation.reason] || "a problem";
  return el("div", { class: "notice" },
    el("b", { text: "Made Private after reports" }),
    el("p", { text: `This server was reported ${s.moderation.count || 3} times for "${reason}", so it was taken out of Discover. ` +
      "Please fix the problem, then edit it and set it back to Public." }));
}

async function renderList() {
  $("list-status").textContent = servers.length ? "" : "You haven't added any servers yet.";
  const flagged = servers.filter(hiddenByReports).length;
  $("flagged").classList.toggle("hidden", !flagged);
  $("flagged").textContent = flagged === 1
    ? "One of your servers was made Private after being reported. See below."
    : `${flagged} of your servers were made Private after being reported. See below.`;
  const keys = await Promise.all(servers.map((s) => statusKey(s.id)));
  $("cards").replaceChildren(...servers.map((s, i) => el("div", { class: "card" },
    el("div", { class: "row", style: "justify-content:space-between" },
      el("h3", { text: s.name }),
      el("span", { class: `badge ${s.visibility}`, text: s.visibility === "public" ? "Public" : "Private" })),
    hiddenByReports(s) ? reportNotice(s) : null,
    el("div", { class: "addr", text: `${s.host}:${s.port}` }),
    s.description ? el("p", { class: "desc", text: s.description }) : null,
    s.tags?.length ? el("div", { class: "tags" }, s.tags.map((t) => tagChip(t))) : null,
    el("div", { class: "stats" },
      statusBadge(statusOf(statusDoc, keys[i])),
      el("span", { text: playersText(statusOf(statusDoc, keys[i])) }),
      el("span", { text: `♥ ${s.likeCount || 0}` }),
      el("span", { text: `${s.addCount || 0} adds` })),
    el("div", { class: "actions" },
      el("a", { class: "button small green", href: `/server/?id=${encodeURIComponent(s.id)}`, text: "View page" }),
      el("button", { class: "button small", type: "button", text: "Edit", onclick: () => openEditor(s) }),
      el("button", { class: "button small red", type: "button", text: "Delete", onclick: () => confirmDelete(s) })),
  )));
}

// ---- Add / edit ----
const tagButtons = TAGS.map((tag) => {
  const b = el("button", { type: "button", class: "tag", "aria-pressed": "false", text: tag, "data-tag": tag });
  b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    if (on && selectedTags().length >= LIMITS.tags) return;
    b.setAttribute("aria-pressed", String(on));
  });
  return b;
});
$("f-tags").append(...tagButtons);

const selectedTags = () => tagButtons.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.tag);
const visButtons = [...$("f-visibility").querySelectorAll("button")];
const visibility = () => visButtons.find((b) => b.getAttribute("aria-pressed") === "true").dataset.value;

function setVisibility(v) {
  for (const b of visButtons) b.setAttribute("aria-pressed", String(b.dataset.value === v));
  const flagged = editing && servers.some((s) => s.id === editing && hiddenByReports(s));
  $("vis-hint").textContent = v === "public"
    ? "Public: anyone can find it in Discover." + (flagged ? " Only do this once you've fixed what it was reported for." : "")
    : "Private: only people with the link or QR code can see it.";
}
for (const b of visButtons) b.addEventListener("click", () => setVisibility(b.dataset.value));

const updateCount = () => { $("desc-count").textContent = `${$("f-desc").value.length} / ${LIMITS.description}`; };
$("f-desc").addEventListener("input", updateCount);

function openEditor(s) {
  editing = s ? s.id : null;
  $("edit-title").textContent = s ? "Edit server" : "Add server";
  $("f-name").value = s ? s.name : "";
  $("f-host").value = s ? s.host : "";
  $("f-port").value = s ? s.port : 19132;
  $("f-desc").value = s ? s.description || "" : "";
  for (const b of tagButtons) b.setAttribute("aria-pressed", String(!!s && (s.tags || []).includes(b.dataset.tag)));
  setVisibility(s ? s.visibility : "private");
  updateCount();
  $("edit-error").classList.add("hidden");
  $("edit-save").disabled = false;
  $("edit-dialog").showModal();
}
$("add").addEventListener("click", () => openEditor(null));
$("edit-cancel").addEventListener("click", () => $("edit-dialog").close());

$("edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    name: cleanLine($("f-name").value),
    host: cleanLine($("f-host").value).toLowerCase(),
    port: Number($("f-port").value),
    description: cleanText($("f-desc").value),
    tags: selectedTags(),
    visibility: visibility(),
  };
  const problem = validateServer(data);
  const err = $("edit-error");
  if (problem) {
    err.textContent = problem;
    err.classList.remove("hidden");
    return;
  }
  $("edit-save").disabled = true;
  try {
    if (editing) {
      await updateDoc(doc(db, "servers", editing), { ...data, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, "servers"), {
        ...data, ownerUid: user.uid, likeCount: 0, addCount: 0,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    }
    $("edit-dialog").close();
    loadServers();
  } catch (ex) {
    console.error(ex);
    err.textContent = friendlyError(ex);
    err.classList.remove("hidden");
    $("edit-save").disabled = false;
  }
});

// ---- Delete ----
function confirmDelete(s) {
  deleting = s.id;
  $("delete-name").textContent = s.name;
  $("delete-error").classList.add("hidden");
  $("delete-dialog").showModal();
}
$("delete-cancel").addEventListener("click", () => $("delete-dialog").close());
$("delete-confirm").addEventListener("click", async () => {
  try {
    await deleteDoc(doc(db, "servers", deleting));
    $("delete-dialog").close();
    loadServers();
  } catch (e) {
    console.error(e);
    $("delete-error").textContent = friendlyError(e);
    $("delete-error").classList.remove("hidden");
  }
});

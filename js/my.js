import {
  addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { auth, db, onUser, signIn, signOutUser } from "./firebase.js";
import {
  LIMITS, REPORT_REASONS, TAGS, cleanLine, cleanText, el, friendlyError, tagChip, validateServer,
} from "./common.js";

const $ = (id) => document.getElementById(id);
let servers = [];
let editing = null; // id of the server being edited, or null when adding
let deleting = null;

function show(section) {
  for (const s of ["loading", "signed-out", "signed-in"]) $(s).classList.toggle("hidden", s !== section);
}

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

onUser((user) => {
  if (!user) {
    servers = [];
    show("signed-out");
    return;
  }
  $("who").textContent = `Signed in as ${user.email || user.displayName || "Google user"} (only you see this).`;
  show("signed-in");
  loadServers();
});

// ---- List ----
async function loadServers() {
  $("list-status").textContent = "Loading your servers…";
  try {
    const snap = await getDocs(query(collection(db, "servers"), where("ownerUid", "==", auth.currentUser.uid)));
    servers = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name));
    renderList();
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

function renderList() {
  $("list-status").textContent = servers.length ? "" : "You haven't added any servers yet.";
  const flagged = servers.filter(hiddenByReports).length;
  $("flagged").classList.toggle("hidden", !flagged);
  $("flagged").textContent = flagged === 1
    ? "One of your servers was made Private after being reported. See below."
    : `${flagged} of your servers were made Private after being reported. See below.`;
  $("cards").replaceChildren(...servers.map((s) => el("div", { class: "card" },
    el("div", { class: "row", style: "justify-content:space-between" },
      el("h3", { text: s.name }),
      el("span", { class: `badge ${s.visibility}`, text: s.visibility === "public" ? "Public" : "Private" })),
    hiddenByReports(s) ? reportNotice(s) : null,
    el("div", { class: "addr", text: `${s.host}:${s.port}` }),
    s.description ? el("p", { class: "desc", text: s.description }) : null,
    s.tags?.length ? el("div", { class: "tags" }, s.tags.map((t) => tagChip(t))) : null,
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
        ...data, ownerUid: auth.currentUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
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

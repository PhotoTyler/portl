import {
  deleteDoc, doc, getDoc, increment, serverTimestamp, setDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { anyUid, db, googleUser, onUser, signIn } from "./firebase.js?v=10";
import {
  LIMITS, REPORT_REASONS, appLink, checkedAgo, cleanText, drawQr, el, friendlyError, playStoreLink, playersText,
  rememberViewed, serverPageLink, shareLink, statusBadge, statusKey, statusOf, tagChip,
} from "./common.js?v=10";

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id") || "";
let server = null;
let liked = false;
let favourite = false;

function show(section) {
  for (const s of ["loading", "server", "missing"]) $(s).classList.toggle("hidden", s !== section);
}

async function load() {
  // Firestore IDs from addDoc are 20 letters/digits; reject anything else before asking.
  if (!/^[A-Za-z0-9]{1,40}$/.test(id)) return show("missing");
  try {
    const snap = await getDoc(doc(db, "servers", id));
    if (!snap.exists()) return show("missing");
    server = snap.data();
    render();
    rememberViewed(id, server);
    loadStatus();
    refreshMine();
  } catch (e) {
    console.error(e);
    show("missing");
    $("missing").querySelector("p").textContent = friendlyError(e);
  }
}

function render() {
  const s = server;
  const tags = Array.isArray(s.tags) ? s.tags : [];
  document.title = `${s.name} - PortL`;
  $("name").textContent = s.name;
  $("address").textContent = `${s.host}:${s.port}`;
  $("tags").replaceChildren(...tags.map((t) => tagChip(t)));
  $("description").textContent = s.description || "";
  $("open").href = appLink(s);
  $("play").href = playStoreLink(s);
  renderCounts();

  // The QR holds the normal share link, which PortL's scanner and Android App Links both understand.
  const qr = $("qr");
  drawQr(qr, shareLink(s));
  $("save-qr").href = qr.toDataURL("image/png");
  $("save-qr").download = `portl-${s.name.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 30) || "server"}.png`;

  $("copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(serverPageLink(id));
      $("copy").textContent = "Copied!";
    } catch {
      prompt("Copy this link:", serverPageLink(id));
    }
  };
  show("server");
}

function renderCounts() {
  const adds = server.addCount || 0;
  $("like-count").textContent = server.likeCount || 0;
  $("like").setAttribute("aria-pressed", String(liked));
  $("fav").setAttribute("aria-pressed", String(favourite));
  $("fav").textContent = favourite ? "★ Favourited" : "★ Favourite";
  $("counts").textContent = `Added to PortL ${adds} time${adds === 1 ? "" : "s"}`;
}

// ---- Status (checked every 15 minutes by the GitHub Action, see check-status.mjs) ----
async function loadStatus() {
  let statusDoc = null;
  try {
    const snap = await getDoc(doc(db, "meta", "status"));
    statusDoc = snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error(e);
  }
  const st = statusOf(statusDoc, await statusKey(id));
  $("status").replaceChildren(statusBadge(st));
  $("players").textContent = playersText(st);
  $("checked").textContent = statusDoc ? checkedAgo(statusDoc) : "Status not checked yet";
}

// ---- Like / favourite (Google account) ----
function actionError(text) {
  $("action-error").textContent = text;
  $("action-error").classList.toggle("hidden", !text);
}

async function refreshMine() {
  const user = googleUser();
  liked = false;
  favourite = false;
  if (user && server) {
    try {
      const [l, f] = await Promise.all([
        getDoc(doc(db, "servers", id, "likes", user.uid)),
        getDoc(doc(db, "users", user.uid, "favorites", id)),
      ]);
      liked = l.exists();
      favourite = f.exists();
    } catch (e) {
      console.error(e);
    }
  }
  if (server) renderCounts();
}
onUser(() => refreshMine());

// Signs in first if needed. Returns the Google user, or null if they backed out.
async function needUser() {
  if (googleUser()) return googleUser();
  await signIn();
  await refreshMine();
  return googleUser();
}

$("like").addEventListener("click", async () => {
  actionError("");
  const btn = $("like");
  btn.disabled = true;
  try {
    const user = await needUser();
    if (!user) return;
    const likeRef = doc(db, "servers", id, "likes", user.uid);
    const batch = writeBatch(db);
    if (liked) batch.delete(likeRef);
    else batch.set(likeRef, { createdAt: serverTimestamp() });
    batch.update(doc(db, "servers", id), { likeCount: increment(liked ? -1 : 1) });
    await batch.commit();
    server.likeCount = (server.likeCount || 0) + (liked ? -1 : 1);
    liked = !liked;
    renderCounts();
  } catch (e) {
    console.error(e);
    actionError(friendlyError(e));
  } finally {
    btn.disabled = false;
  }
});

$("fav").addEventListener("click", async () => {
  actionError("");
  const btn = $("fav");
  btn.disabled = true;
  try {
    const user = await needUser();
    if (!user) return;
    const favRef = doc(db, "users", user.uid, "favorites", id);
    if (favourite) await deleteDoc(favRef);
    else await setDoc(favRef, { createdAt: serverTimestamp() });
    favourite = !favourite;
    renderCounts();
  } catch (e) {
    console.error(e);
    actionError(friendlyError(e));
  } finally {
    btn.disabled = false;
  }
});

// ---- "Open in PortL" count: once per browser/account, never blocks opening the app ----
$("open").addEventListener("click", () => {
  countAdd().catch((e) => console.warn("Add count not saved", e));
});

async function countAdd() {
  const flag = `portl-added-${id}`;
  try { if (localStorage.getItem(flag)) return; } catch { /* storage blocked */ }
  const uid = await anyUid();
  const addRef = doc(db, "servers", id, "adds", uid);
  if ((await getDoc(addRef)).exists()) return;
  const batch = writeBatch(db);
  batch.set(addRef, { createdAt: serverTimestamp() });
  batch.update(doc(db, "servers", id), { addCount: increment(1) });
  await batch.commit();
  server.addCount = (server.addCount || 0) + 1;
  renderCounts();
  try { localStorage.setItem(flag, "1"); } catch { /* ignore */ }
}

// ---- Report ----
const dialog = $("report-dialog");
const reason = $("reason");
for (const [value, label] of Object.entries(REPORT_REASONS)) reason.append(el("option", { value, text: label }));

function reportError(text) {
  $("report-error").textContent = text;
  $("report-error").classList.toggle("hidden", !text);
}

// Reporting needs a Google account, so one person can only report a server once.
function updateReportDialog() {
  const user = googleUser();
  const own = !!user && !!server && user.uid === server.ownerUid;
  $("report-signin").classList.toggle("hidden", !!user);
  $("report-fields").classList.toggle("hidden", !user || own);
  $("report-send").classList.toggle("hidden", !user || own);
  if (own) reportError("This is your server, so you can't report it.");
}
onUser(updateReportDialog);

$("report").addEventListener("click", () => {
  reportError("");
  $("report-send").disabled = false;
  updateReportDialog();
  dialog.showModal();
});
$("report-cancel").addEventListener("click", () => dialog.close());
$("report-sign-in").addEventListener("click", async () => {
  try {
    await signIn();
  } catch (err) {
    console.error(err);
    reportError(friendlyError(err));
  }
});

$("report-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = googleUser();
  if (!user || user.uid === server.ownerUid) return;
  const send = $("report-send");
  send.disabled = true;
  try {
    await setDoc(doc(db, "reports", `${id}_${user.uid}`), {
      serverId: id,
      reason: reason.value,
      details: cleanText($("details").value).slice(0, LIMITS.reportDetails),
      reporterUid: user.uid,
      status: "open",
      createdAt: serverTimestamp(),
    });
    dialog.close();
    $("details").value = "";
    $("report").textContent = "Reported - thanks!";
    $("report").disabled = true;
  } catch (err) {
    console.error(err);
    // Reports can't be read or overwritten, so a second report from the same account is refused.
    reportError(err.code === "permission-denied" ? "You've already reported this server. Thanks!" : friendlyError(err));
    send.disabled = false;
  }
});

load();

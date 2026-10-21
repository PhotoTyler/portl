import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { auth, db, onUser, signIn } from "./firebase.js";
import {
  LIMITS, REPORT_REASONS, appLink, cleanText, drawQr, el, friendlyError, playStoreLink, serverPageLink,
  shareLink, tagChip,
} from "./common.js";

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id") || "";
let ownerUid = null;

function show(section) {
  for (const s of ["loading", "server", "missing"]) $(s).classList.toggle("hidden", s !== section);
}

async function load() {
  // Firestore IDs from addDoc are 20 letters/digits; reject anything else before asking.
  if (!/^[A-Za-z0-9]{1,40}$/.test(id)) return show("missing");
  try {
    const snap = await getDoc(doc(db, "servers", id));
    if (!snap.exists()) return show("missing");
    render(snap.data());
  } catch (e) {
    console.error(e);
    show("missing");
    $("missing").querySelector("p").textContent = friendlyError(e);
  }
}

function render(s) {
  const tags = Array.isArray(s.tags) ? s.tags : [];
  ownerUid = s.ownerUid;
  document.title = `${s.name} - PortL`;
  $("name").textContent = s.name;
  $("address").textContent = `${s.host}:${s.port}`;
  $("tags").replaceChildren(...tags.map((t) => tagChip(t)));
  $("description").textContent = s.description || "";
  $("open").href = appLink(s);
  $("play").href = playStoreLink(s);

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
  const user = auth.currentUser;
  const own = !!user && user.uid === ownerUid;
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
  const user = auth.currentUser;
  if (!user || user.uid === ownerUid) return;
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

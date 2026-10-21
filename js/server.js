import { addDoc, collection, doc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import {
  LIMITS, REPORT_REASONS, appLink, cleanText, drawQr, el, friendlyError, playStoreLink, serverPageLink,
  shareLink, tagChip,
} from "./common.js";

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id") || "";

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

$("report").addEventListener("click", () => {
  $("report-error").classList.add("hidden");
  $("report-send").disabled = false;
  dialog.showModal();
});
$("report-cancel").addEventListener("click", () => dialog.close());

$("report-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const send = $("report-send");
  send.disabled = true;
  try {
    await addDoc(collection(db, "reports"), {
      serverId: id,
      reason: reason.value,
      details: cleanText($("details").value).slice(0, LIMITS.reportDetails),
      reporterUid: auth.currentUser ? auth.currentUser.uid : null,
      createdAt: serverTimestamp(),
    });
    dialog.close();
    $("details").value = "";
    $("report").textContent = "Reported - thanks!";
    $("report").disabled = true;
  } catch (err) {
    console.error(err);
    $("report-error").textContent = friendlyError(err);
    $("report-error").classList.remove("hidden");
    send.disabled = false;
  }
});

load();

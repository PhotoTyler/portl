// Report checker, run by .github/workflows/check-reports.yml every 15 minutes.
//
// If a Public server has THRESHOLD or more open reports for the same reason, it is made Private,
// a notice is stored on it (shown to the owner on My Servers), the owner is emailed, and those
// reports are marked "actioned" so they aren't counted again. Reports against a server that is
// already Private stay open and still count if the owner makes it Public again.
//
// Secrets (repo Settings > Secrets and variables > Actions):
//   FIREBASE_SERVICE_ACCOUNT  JSON key of a Firebase service account (required)
//   RESEND_API_KEY            Resend API key (optional; no emails without it)
//   MAIL_FROM                 e.g. "PortL <noreply@portl.click>" (domain verified in Resend)
//   ADMIN_EMAIL               optional; gets a copy of every "server hidden" email

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const THRESHOLD = 3;
// Keep in sync with REPORT_REASONS in js/common.js.
const REASONS = {
  broken: "Address doesn't work",
  inappropriate: "Not suitable for kids",
  spam: "Spam or scam",
  impersonation: "Pretending to be another server",
  other: "Something else",
};

const { FIREBASE_SERVICE_ACCOUNT, RESEND_API_KEY, MAIL_FROM, ADMIN_EMAIL } = process.env;
if (!FIREBASE_SERVICE_ACCOUNT) {
  // Not set up yet: exit quietly instead of failing (and emailing) every 15 minutes.
  console.warn("FIREBASE_SERVICE_ACCOUNT secret is missing, nothing checked");
  process.exit(0);
}

initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const auth = getAuth();

let failures = 0;

const open = await db.collection("reports").where("status", "==", "open").get();
console.log(`${open.size} open report(s)`);

// serverId -> reason -> report snapshots
const byServer = new Map();
for (const r of open.docs) {
  const { serverId, reason } = r.data();
  if (!byServer.has(serverId)) byServer.set(serverId, new Map());
  const reasons = byServer.get(serverId);
  if (!reasons.has(reason)) reasons.set(reason, []);
  reasons.get(reason).push(r);
}

for (const [serverId, reasons] of byServer) {
  const serverRef = db.collection("servers").doc(serverId);
  const snap = await serverRef.get();

  if (!snap.exists) {
    // Server was deleted: nothing to do, close its reports.
    const batch = db.batch();
    for (const list of reasons.values()) {
      for (const r of list) batch.update(r.ref, { status: "server-deleted" });
    }
    await batch.commit();
    continue;
  }

  const server = snap.data();
  if (server.visibility !== "public") continue;

  // Most-reported reason first, so the notice shows the main problem.
  const [reason, list] = [...reasons].sort((a, b) => b[1].length - a[1].length)[0];
  if (list.length < THRESHOLD) continue;

  const batch = db.batch();
  batch.update(serverRef, {
    visibility: "private",
    moderation: { hidden: true, reason, count: list.length, hiddenAt: FieldValue.serverTimestamp() },
  });
  for (const r of list) batch.update(r.ref, { status: "actioned", actionedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  console.log(`Hid server ${serverId} (${list.length} x ${reason})`);

  try {
    await notifyOwner(serverId, server, reason, list.length);
  } catch (e) {
    failures++;
    console.error(`Email for ${serverId} failed:`, e.message);
  }
}

if (failures) {
  // Fails the run so GitHub emails the repo owner; the servers were still hidden.
  process.exitCode = 1;
}

async function notifyOwner(serverId, server, reason, count) {
  if (!RESEND_API_KEY || !MAIL_FROM) {
    console.log("No RESEND_API_KEY / MAIL_FROM, skipping email");
    return;
  }
  const owner = await auth.getUser(server.ownerUid);
  const to = owner.email ? [owner.email] : [];
  if (!to.length && !ADMIN_EMAIL) return;

  const label = REASONS[reason] || "a problem";
  const text = [
    "Hi,",
    "",
    `Your server "${server.name}" (${server.host}:${server.port}) was reported ${count} times on PortL for "${label}".`,
    "To keep things safe, we've made it Private, so it no longer shows in Discover.",
    "Its link and QR code still work.",
    "",
    "Please fix the problem, then go to https://portl.click/my/, edit the server and set it back to Public.",
    "",
    "Thanks,",
    "PortL",
    "",
    "PortL is not affiliated with Mojang or Microsoft.",
  ].join("\n");
  const html = text.split("\n").map((line) => escapeHtml(line) || "&nbsp;").map((l) => `<p style="margin:0">${l}</p>`).join("");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: to.length ? to : [ADMIN_EMAIL],
      bcc: to.length && ADMIN_EMAIL ? [ADMIN_EMAIL] : undefined,
      subject: `Your PortL server "${server.name}" was made Private`,
      text,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  console.log(`Emailed owner of ${serverId}`);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

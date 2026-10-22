import {
  collection, deleteDoc, doc, getDoc, getDocs, increment, limit, query, where, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import {
  deleteUser, GoogleAuthProvider, reauthenticateWithPopup,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { db, googleUser, onUser, signIn, signOutUser } from "./firebase.js?v=10";
import { friendlyError } from "./common.js?v=10";

const $ = (id) => document.getElementById(id);

function show(ids) {
  for (const id of ["sign-in", "delete", "confirm"]) $(id).classList.toggle("hidden", !ids.includes(id));
}
function status(text) { $("status").textContent = text; }
function error(text) {
  $("error").textContent = text || "";
  $("error").classList.toggle("hidden", !text);
}

let busy = false;
onUser((user) => {
  if (busy) return;
  if (user) {
    status(`Signed in as ${user.email || user.displayName || "Google user"}.`);
    show(["delete"]);
  } else {
    status("Sign in to delete your account.");
    show(["sign-in"]);
  }
});

$("sign-in").addEventListener("click", () => signIn().catch((e) => error(friendlyError(e))));
$("delete").addEventListener("click", () => { error(""); show(["confirm"]); });
$("no").addEventListener("click", () => show(["delete"]));
$("yes").addEventListener("click", async () => {
  const user = googleUser();
  if (!user) return;
  busy = true;
  error("");
  show([]);
  try {
    await deleteEverything(user.uid);
    status("Deleting your sign-in account…");
    await deleteAccount(user);
    clearBrowser();
    status("Your PortL account and all its data have been deleted.");
  } catch (e) {
    console.error(e);
    error(`Something went wrong: ${friendlyError(e)} Nothing more was deleted. Try again, or email us.`);
    show(["delete"]);
  } finally {
    busy = false;
  }
});

/** Deletes in small groups so a big list doesn't fire hundreds of requests at once. */
async function inGroups(items, fn, size = 20) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

async function deleteEverything(uid) {
  status("Finding your data…");
  const [owned, favs, saved, publics] = await Promise.all([
    getDocs(query(collection(db, "servers"), where("ownerUid", "==", uid))),
    getDocs(collection(db, "users", uid, "favorites")),
    getDocs(collection(db, "users", uid, "saved")),
    getDocs(query(collection(db, "servers"), where("visibility", "==", "public"), limit(500))),
  ]);
  const ownedIds = new Set(owned.docs.map((d) => d.id));

  // Likes: on public servers, and on any (private) server you favourited.
  status("Removing your likes…");
  const candidates = [...new Set([...publics.docs.map((d) => d.id), ...favs.docs.map((d) => d.id)])]
    .filter((id) => !ownedIds.has(id));
  await inGroups(candidates, async (id) => {
    const likeRef = doc(db, "servers", id, "likes", uid);
    const like = await getDoc(likeRef).catch(() => null);
    if (!like?.exists()) return;
    const batch = writeBatch(db);
    batch.delete(likeRef);
    batch.update(doc(db, "servers", id), { likeCount: increment(-1) });
    await batch.commit();
  });

  status("Deleting your favourites and saved servers…");
  await inGroups(favs.docs, (d) => deleteDoc(d.ref));
  await inGroups(saved.docs, (d) => deleteDoc(d.ref));

  status("Deleting the servers you listed…");
  await inGroups(owned.docs, (d) => deleteDoc(d.ref));
}

async function deleteAccount(user) {
  try {
    await deleteUser(user);
  } catch (e) {
    if (e.code !== "auth/requires-recent-login") throw e;
    // Google asks you to confirm it's you if you signed in a while ago.
    status("Please confirm your Google account once more…");
    await reauthenticateWithPopup(user, new GoogleAuthProvider());
    await deleteUser(user);
  }
  await signOutUser().catch(() => {});
}

/** Recently viewed servers, sort order, sky style and "added" flags: everything PortL keeps in this browser. */
function clearBrowser() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("portl")) localStorage.removeItem(key);
  } catch { /* storage blocked */ }
}

// Firebase (Spark plan, client SDK only). This config is public by design: access is controlled
// by the Firestore security rules in /firestore.rules, not by hiding these values.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInAnonymously, signInWithPopup, signInWithRedirect,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const app = initializeApp({
  apiKey: "AIzaSyBLl4uDpUl8aKhSMlOxSZMH4ROeS-jxPKI",
  authDomain: "portal-servers.firebaseapp.com",
  projectId: "portal-servers",
  storageBucket: "portal-servers.firebasestorage.app",
  messagingSenderId: "231397023559",
  appId: "1:231397023559:web:dd444eb00298e42c6ab662",
});

export const auth = getAuth(app);
export const db = getFirestore(app);

// Anonymous sign-in is only used behind the scenes (to count "Open in PortL" once per browser),
// so pages treat an anonymous user as signed out.
export function googleUser() {
  const u = auth.currentUser;
  return u && !u.isAnonymous ? u : null;
}

export function onUser(callback) {
  return onAuthStateChanged(auth, (u) => callback(u && !u.isAnonymous ? u : null));
}

// Any user ID: the Google account if signed in, otherwise an anonymous one.
export async function anyUid() {
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser.uid;
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // Popups are often blocked on phones; fall back to a full-page redirect.
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      throw e;
    }
  }
}

export function signOutUser() {
  return signOut(auth);
}

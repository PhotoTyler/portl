// Reads the FIREBASE_SERVICE_ACCOUNT secret. Accepts the whole key file, the file with its outer
// { } missed off when copying, or the file base64-encoded. Returns null if it isn't set.
export function serviceAccount() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  if (!raw) return null;
  const attempts = [
    raw,
    `${raw.startsWith("{") ? "" : "{"}${raw.replace(/^,|,$/g, "")}${raw.endsWith("}") ? "" : "}"}`,
    (() => { try { return Buffer.from(raw, "base64").toString("utf8"); } catch { return ""; } })(),
  ];
  for (const text of attempts) {
    try {
      const json = JSON.parse(text);
      if (json && json.type === "service_account" && json.private_key && json.client_email) return json;
    } catch { /* try the next form */ }
  }
  throw new Error(
    "FIREBASE_SERVICE_ACCOUNT isn't a valid service account key. Open the .json file from Firebase " +
    "(Project settings > Service accounts > Generate new private key), copy ALL of it from the first { " +
    "to the last } and paste that as the secret.",
  );
}

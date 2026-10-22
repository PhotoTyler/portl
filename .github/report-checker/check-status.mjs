// Server status checker, run by .github/workflows/check-reports.yml every 15 minutes.
//
// Pings every listed server the same way the app does (ServerProbe.kt):
//   - MineKeep (".minekeep." in the address): Java status ping of the address without the
//     ".bedrock" label, port 25565. The proxy answers while the server sleeps, so the MOTD decides:
//     "offline" / "will be started" = asleep, otherwise online. No answer = unknown.
//   - Everything else: Bedrock unconnected ping. Answer = online, no answer = offline.
//
// Results go into ONE document, meta/status, so the site reads one doc and this job writes one
// doc per run (Spark quota friendly). It is keyed by a hash of the server ID, not the ID itself,
// because private servers must stay unlisted (knowing an ID = being able to open the page).
// Keep statusKey() in sync with js/common.js.

import { createHash, randomBytes } from "node:crypto";
import dgram from "node:dgram";
import net from "node:net";
import { cert, initializeApp } from "firebase-admin/app";
import { serviceAccount } from "./service-account.mjs";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const { FIREBASE_SERVICE_ACCOUNT } = process.env;
if (!FIREBASE_SERVICE_ACCOUNT) {
  console.warn("FIREBASE_SERVICE_ACCOUNT secret is missing, nothing checked");
  process.exit(0);
}
initializeApp({ credential: cert(serviceAccount()) });
const db = getFirestore();

const ASLEEP_TEXT = /offline|will be started/i;
const RAKNET_MAGIC = Buffer.from("00ffff00fefefefefdfdfdfd12345678", "hex");

function statusKey(id) {
  return createHash("sha256").update(id).digest("hex").slice(0, 20);
}

const snap = await db.collection("servers").select("host", "port").get();
console.log(`Checking ${snap.size} server(s)`);

const results = {};
await mapLimit(snap.docs, 20, async (d) => {
  const { host, port } = d.data();
  let status;
  try {
    status = await probe(String(host), Number(port));
  } catch {
    status = { s: "unknown" };
  }
  results[statusKey(d.id)] = status;
});

await db.collection("meta").doc("status").set({ servers: results, checkedAt: FieldValue.serverTimestamp() });
const online = Object.values(results).filter((r) => r.s === "online").length;
console.log(`Done: ${online} online`);

async function probe(host, port) {
  if (host.toLowerCase().includes(".minekeep.")) {
    const javaHost = host.split(".").filter((p) => p.toLowerCase() !== "bedrock").join(".");
    const java = await javaPing(javaHost, 25565).catch(() => null);
    if (!java) return { s: "unknown" };
    if (ASLEEP_TEXT.test(java.motd)) return { s: "asleep" };
    return { s: "online", p: java.online, m: java.max };
  }
  const pong = await bedrockPing(host, port);
  if (!pong) return { s: "offline" };
  return { s: "online", p: pong.players, m: pong.max };
}

// ---- Bedrock (RakNet unconnected ping), same packet as pingBedrock() in BedrockRelay.kt ----
function bedrockPing(host, port, attempts = 2, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let tries = 0;
    let timer;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    const send = () => {
      if (tries++ >= attempts) return finish(null);
      const ping = Buffer.alloc(33);
      ping[0] = 0x01;
      ping.writeBigInt64BE(BigInt(Date.now()), 1);
      RAKNET_MAGIC.copy(ping, 9);
      randomBytes(8).copy(ping, 25);
      socket.send(ping, port, host, (err) => { if (err) finish(null); });
      timer = setTimeout(send, timeoutMs);
    };
    socket.on("error", () => finish(null));
    socket.on("message", (buf) => {
      // 0x1c | time(8) | serverGuid(8) | magic(16) | strLen(2) | "MCPE;motd;protocol;version;players;max;..."
      if (buf.length < 35 || buf[0] !== 0x1c) return;
      const len = Math.min(buf.readUInt16BE(33), buf.length - 35);
      const parts = buf.toString("utf8", 35, 35 + len).split(";");
      finish({ players: toCount(parts[4]), max: toCount(parts[5]) });
    });
    send();
  });
}

// ---- Java Server List Ping, same as JavaPing.kt ----
function javaPing(host, port, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let data = Buffer.alloc(0);
    socket.setTimeout(timeoutMs, () => { socket.destroy(); reject(new Error("timeout")); });
    socket.on("error", reject);
    socket.on("connect", () => {
      const hostBytes = Buffer.from(host, "utf8");
      const portBytes = Buffer.from([(port >> 8) & 0xff, port & 0xff]);
      const handshake = Buffer.concat([
        varInt(0x00), varInt(-1), varInt(hostBytes.length), hostBytes, portBytes, varInt(1),
      ]);
      socket.write(Buffer.concat([varInt(handshake.length), handshake, varInt(1), Buffer.from([0x00])]));
    });
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      try {
        const [length, a] = readVarInt(data, 0);
        if (data.length < a + length) return; // wait for the rest
        const [id, b] = readVarInt(data, a);
        if (id !== 0x00) throw new Error("unexpected packet");
        const [strLen, c] = readVarInt(data, b);
        const json = JSON.parse(data.toString("utf8", c, c + strLen));
        socket.destroy();
        resolve({
          motd: flatten(json.description),
          online: json.players ? toCount(json.players.online) : null,
          max: json.players ? toCount(json.players.max) : null,
        });
      } catch (e) {
        if (e instanceof RangeError) return; // varint not complete yet
        socket.destroy();
        reject(e);
      }
    });
  });
}

function flatten(c) {
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(flatten).join("");
  if (typeof c === "object") return (c.text || "") + (Array.isArray(c.extra) ? c.extra.map(flatten).join("") : "");
  return String(c);
}

function varInt(value) {
  const out = [];
  let v = value >>> 0;
  while (true) {
    if ((v & ~0x7f) === 0) { out.push(v); return Buffer.from(out); }
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
}

function readVarInt(buf, offset) {
  let result = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) throw new RangeError("incomplete");
    const b = buf[offset + i];
    result |= (b & 0x7f) << (7 * i);
    if ((b & 0x80) === 0) return [result, offset + i + 1];
  }
  throw new Error("VarInt too long");
}

function toCount(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

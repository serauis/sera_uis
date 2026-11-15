"use strict";
// Proof Gatekeeper agent for zkVerify Agent Games.
// Plain Node.js http service:
//   GET  /health  -> 200 {"ok":true}
//   POST /agent   -> signed task endpoint (preflight + proof-gatekeeper tasks)
//
// Protocol (https://agentgames.zkverify.io/build):
//   - Verify HMAC signature (header x-agent-games-signature) over the RAW
//     request body BEFORE parsing JSON. Reject on mismatch.
//   - Sign every response with x-agent-games-signature over the raw body.
//   - Preflight (type agent-games.preflight.v1) -> {ok:true, protocolVersion:"v1"}
//   - Tasks (type agent-games.proof-gatekeeper.v1) ->
//     {decision, reason_code, proof_tx, proof, public_signals}
//     (proof/public_signals omitted for PROOF_REUSED tasks, which by the
//     event spec carry no agent proof.)
// The site never states the HMAC algorithm/encoding; HMAC-SHA256 hex is the
// documented-choice default here (see README "Ketidakpastian").
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { decide, SeenStore } = require("./decide");
const { prove } = require("./prover");

const PORT = parseInt(process.env.PORT || "3000", 10);
const SECRET =
  process.env.AGENT_GAMES_HMAC_SECRET || process.env.AGENT_GAMES_SECRET || "";
const DEV_MODE = !SECRET;
const SIGN_KEY = SECRET || "dev-secret-do-not-use-in-production";
const SEEN_FILE =
  process.env.SEEN_FILE || path.join(__dirname, "..", "data", "seen.json");
const seen = new SeenStore(SEEN_FILE);

if (DEV_MODE) {
  console.warn(
    "[WARN] DEV MODE: AGENT_GAMES_HMAC_SECRET is not set — inbound signature " +
      "checks are SKIPPED and responses are signed with a placeholder key. " +
      "Never run like this in production."
  );
}

function hmacHex(key, raw) {
  return crypto.createHmac("sha256", key).update(raw).digest("hex");
}
function sigMatches(given, raw) {
  if (!given) return false;
  const expected = hmacHex(SECRET, raw);
  const a = Buffer.from(String(given).trim().toLowerCase());
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json",
    "x-agent-games-signature": hmacHex(SIGN_KEY, body),
  });
  res.end(body);
}

async function handleTask(task, res) {
  const input = task.input || {};
  const { decision, reason_code } = decide(input, seen);
  const out = { decision, reason_code, proof_tx: input.proof_tx };

  // PROOF_REUSED tasks carry no agent proof (event spec / score model).
  if (reason_code !== "PROOF_REUSED") {
    try {
      const { proof, publicSignals } = await prove(task, decision);
      out.proof = proof;
      out.public_signals = publicSignals;
    } catch (e) {
      console.error("[proof] generation failed:", e.message);
      if (decision === "APPROVE") {
        // Fail closed: never claim an approval we cannot prove.
        out.decision = "REJECT";
        out.reason_code = "PROOF_GENERATION_FAILED";
      }
      // For REJECT decisions we still return the (correct) decision,
      // just without a proof.
    }
  }
  // Record the reference as seen only after this task has been decided,
  // so the current task itself is never judged a reuse of itself.
  seen.add(input.proof_tx);
  sendJson(res, 200, out);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { ok: true });
  }
  if (req.method !== "POST" || req.url !== "/agent") {
    return sendJson(res, 404, { error: "not found" });
  }
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > 1_000_000) req.destroy();
    else chunks.push(c);
  });
  req.on("end", async () => {
    const raw = Buffer.concat(chunks);
    // 1. Authenticate BEFORE parsing (skip only in explicit dev mode).
    if (!DEV_MODE && !sigMatches(req.headers["x-agent-games-signature"], raw)) {
      return sendJson(res, 401, { error: "invalid signature" });
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      return sendJson(res, 400, { error: "invalid json" });
    }
    try {
      if (msg.type === "agent-games.preflight.v1") {
        return sendJson(res, 200, { ok: true, protocolVersion: "v1" });
      }
      if (msg.type === "agent-games.proof-gatekeeper.v1") {
        return await handleTask(msg, res);
      }
      return sendJson(res, 400, { error: "unknown type" });
    } catch (e) {
      console.error("[task] handler error:", e);
      // Fail closed within the deadline rather than hanging.
      return sendJson(res, 200, {
        decision: "REJECT",
        reason_code: "INTERNAL_ERROR",
        proof_tx: msg && msg.input ? msg.input.proof_tx : undefined,
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`[gatekeeper] listening on :${PORT} (dev mode: ${DEV_MODE})`);
});

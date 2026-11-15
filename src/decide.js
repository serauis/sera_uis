"use strict";
// Deterministic decision engine for Proof Gatekeeper tasks.
// Check precedence (each competition task carries exactly one trap, so this
// order only matters for malformed/multi-trap inputs):
//   1. VK_SUBSTITUTION     proof_vk != registered_vk
//   2. PROOF_REUSED        proof_tx already seen in a previous task
//   3. EXPIRED_CONDITION   current_block > expiry_block
//   4. THRESHOLD_MISMATCH  public_balance < minimum
//   5. RECIPIENT_MISMATCH  recipient != condition_recipient
//   6. AMOUNT_OVERFLOW     amount > max_transfer
//   otherwise APPROVE / VALID_CONDITION
const fs = require("fs");
const path = require("path");

function normHex(x) {
  return String(x == null ? "" : x).trim().toLowerCase();
}
function toBig(x) {
  // Amounts/blocks arrive as decimal strings or numbers.
  return BigInt(String(x));
}

class SeenStore {
  constructor(file) {
    this.file = file || null;
    this.set = new Set();
    if (this.file && fs.existsSync(this.file)) {
      try {
        for (const v of JSON.parse(fs.readFileSync(this.file, "utf8"))) this.set.add(v);
      } catch (e) {
        console.error("[seen] failed to load seen-file, starting empty:", e.message);
      }
    }
  }
  has(tx) {
    return this.set.has(normHex(tx));
  }
  add(tx) {
    const k = normHex(tx);
    if (!k || this.set.has(k)) return;
    this.set.add(k);
    if (this.file) {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify([...this.set], null, 1));
      } catch (e) {
        console.error("[seen] failed to persist seen-file:", e.message);
      }
    }
  }
}

function decide(input, seen) {
  const reject = (reason_code) => ({ decision: "REJECT", reason_code });
  if (normHex(input.proof_vk) !== normHex(input.registered_vk))
    return reject("VK_SUBSTITUTION");
  if (seen.has(input.proof_tx)) return reject("PROOF_REUSED");
  if (toBig(input.current_block) > toBig(input.expiry_block))
    return reject("EXPIRED_CONDITION");
  if (toBig(input.public_balance) < toBig(input.minimum))
    return reject("THRESHOLD_MISMATCH");
  if (normHex(input.recipient) !== normHex(input.condition_recipient))
    return reject("RECIPIENT_MISMATCH");
  if (toBig(input.amount) > toBig(input.max_transfer))
    return reject("AMOUNT_OVERFLOW");
  return { decision: "APPROVE", reason_code: "VALID_CONDITION" };
}

module.exports = { decide, SeenStore, normHex };

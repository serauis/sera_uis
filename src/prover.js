"use strict";
// Groth16 proof generation for the gatekeeper circuit (snarkjs, BN254).
//
// Circuit input signals (reverse-engineered from the compiled wasm by a
// fellow participant and confirmed locally against gatekeeper_final.zkey):
//   public inputs (in public-signals order, after one circuit output at [0]):
//     registeredVkHash, proofVkHash, minimum, publicBalance, expiryBlock,
//     currentBlock, recipient, conditionRecipient, amount, maxTransfer,
//     decision, taskId
//   private input: salt
// The circuit enforces decision == 1 (APPROVE) iff every check passes, so a
// proof can only be produced for the *correct* decision.
const crypto = require("crypto");
const path = require("path");
const snarkjs = require("snarkjs");

// BN254 scalar field prime.
const P = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

function fieldFromHexOrDec(x) {
  const s = String(x).trim();
  const v = s.startsWith("0x") || s.startsWith("0X") ? BigInt(s) : BigInt(s);
  return (v % P).toString();
}
function fieldFromDec(x) {
  return (BigInt(String(x)) % P).toString();
}
// The platform never documents how the string task_id maps to the circuit's
// numeric taskId input. Deterministic choice: sha256(task_id) as a field
// element. See README "Ketidakpastian" section.
function taskIdField(taskId) {
  const h = crypto.createHash("sha256").update(String(taskId)).digest("hex");
  return (BigInt("0x" + h) % P).toString();
}
function randomSalt() {
  return (BigInt("0x" + crypto.randomBytes(31).toString("hex")) % P).toString();
}

function buildInput(task, decision /* "APPROVE" | "REJECT" */) {
  const i = task.input;
  return {
    registeredVkHash: fieldFromHexOrDec(i.registered_vk),
    proofVkHash: fieldFromHexOrDec(i.proof_vk),
    minimum: fieldFromDec(i.minimum),
    publicBalance: fieldFromDec(i.public_balance),
    expiryBlock: fieldFromDec(i.expiry_block),
    currentBlock: fieldFromDec(i.current_block),
    recipient: fieldFromHexOrDec(i.recipient),
    conditionRecipient: fieldFromHexOrDec(i.condition_recipient),
    amount: fieldFromDec(i.amount),
    maxTransfer: fieldFromDec(i.max_transfer),
    decision: decision === "APPROVE" ? "1" : "0",
    taskId: taskIdField(task.task_id),
    salt: randomSalt(),
  };
}

const CIRCUITS_DIR = process.env.CIRCUITS_DIR || path.join(__dirname, "..", "circuits");
const WASM = path.join(CIRCUITS_DIR, "gatekeeper.wasm");
const ZKEY = path.join(CIRCUITS_DIR, "gatekeeper_final.zkey");

async function prove(task, decision) {
  const input = buildInput(task, decision);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  return { proof, publicSignals };
}

module.exports = { prove, buildInput, taskIdField, P };

# Catatan Tes Lokal (aktual, 15 Nov 2026)

Semua tes dijalankan lokal di mesin ini (Node v24.22.1, snarkjs 0.7.6).
Tidak ada secret asli yang dipakai — secret tes: `test-secret-key`.

## 1. Probe circuit — `node test/probe.js`

Skenario valid dari artikel peserta (saldo 1460 ≥ minimum 1000, amount 500 ≤
maks 1000, recipient cocok, expiry 8430000 > current 8420000, VK hash =
vk_hash resmi gatekeeper, decision=1):

```
PUBLIC SIGNALS (13):
  0 2605592500276354743780826694533027635210438891450501309784270864564275432920   <- output circuit
  1 4836144126773920907502496244340012141761656471453348073975163706578152814510   <- registeredVkHash (mod p)
  2 4836144126773920907502496244340012141761656471453348073975163706578152814510   <- proofVkHash (mod p)
  3 1000        minimum
  4 1460        publicBalance
  5 8430000     expiryBlock
  6 8420000     currentBlock
  7 4956573306962759156149363440908036784777568001   recipient
  8 4956573306962759156149363440908036784777568001   conditionRecipient
  9 500         amount
  10 1000       maxTransfer
  11 1          decision
  12 123456789  taskId
VERIFY: OK
```

Kunci verifikasi di `circuits/verification_key.json` dibandingkan dengan hasil
`snarkjs zkey export verificationkey` dari `gatekeeper_final.zkey`:
**identik** (nPublic 13, alpha & IC sama).

## 2. End-to-end — `npm test` (node test/e2e.js)

Server dinyalakan dengan `AGENT_GAMES_HMAC_SECRET=test-secret-key`, lalu
envelope bertanda tangan dikirim seperti yang platform lakukan:

```
PASS  GET /health -> 200
PASS  preflight ok
PASS  preflight response signed
PASS  valid task -> APPROVE/VALID_CONDITION — {"decision":"APPROVE","reason_code":"VALID_CONDITION"}
PASS  valid task echoes proof_tx
PASS  valid task proof verifies (snarkjs) — public_signals: 13
PASS  proof_vk != registered_vk -> REJECT/VK_SUBSTITUTION
PASS  VK_SUBSTITUTION proof (decision=0) verifies
PASS  balance < minimum -> REJECT/THRESHOLD_MISMATCH
PASS  unsigned request -> 401
PASS  badly signed request -> 401
PASS  reused proof_tx -> REJECT/PROOF_REUSED
PASS  PROOF_REUSED carries no proof

ALL TESTS PASSED
```

Satu putaran pembuatan proof memakan ±1,5 detik di mesin ini — jauh di dalam
batas 60 detik.

## 3. Unit decision engine (varian jebakan lain)

```
PASS EXPIRED_CONDITION -> REJECT/EXPIRED_CONDITION
PASS RECIPIENT_MISMATCH -> REJECT/RECIPIENT_MISMATCH
PASS AMOUNT_OVERFLOW -> REJECT/AMOUNT_OVERFLOW
PASS VALID_CONDITION -> APPROVE/VALID_CONDITION
```

## 4. Mode dev (tanpa secret)

Server tanpa `AGENT_GAMES_HMAC_SECRET` mencetak peringatan
`DEV MODE: ... inbound signature checks are SKIPPED ...` dan tetap menjawab
preflight tak bertanda tangan dengan `{"ok":true,"protocolVersion":"v1"}`
lengkap dengan header `x-agent-games-signature`. Mode ini hanya untuk tes
lokal — jangan dipakai produksi.

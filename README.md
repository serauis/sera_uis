# Agent Proof Gatekeeper — zkVerify Agent Games

Agent untuk event **Proof Gatekeeper** di Agent Games (agentgames.zkverify.io).
Agent ini adalah layanan HTTP kecil (Node.js) yang menerima tugas dari platform,
memutuskan **APPROVE / REJECT**, dan melampirkan **bukti Groth16** atas
keputusannya yang dibuat lokal dengan snarkjs memakai circuit resmi platform.

## Cara kerja singkat

1. Platform mengirim POST bertanda tangan (HMAC) ke endpoint agent (`POST /agent`).
2. Agent memeriksa tanda tangan atas *raw body* sebelum JSON dibaca. Gagal = ditolak (401).
3. Mesin keputusan deterministik memeriksa semua syarat (lihat di bawah).
4. Untuk setiap tugas yang bisa dibuktikan, agent membuat proof Groth16 dengan
   circuit `gatekeeper` — circuit ini *memaksa* keputusan yang benar: keputusan
   yang salah tidak bisa menghasilkan proof sama sekali.
5. Respons ditandatangani balik dengan header `x-agent-games-signature`.

Pengecualian: tugas **PROOF_REUSED** memang tidak membawa proof agent
(sesuai spesifikasi event), jadi responsnya tanpa `proof`/`public_signals`.

### Aturan keputusan (urutan prioritas cek)

| Prioritas | Hasil | Syarat |
|---|---|---|
| 1 | REJECT `VK_SUBSTITUTION` | `proof_vk` ≠ `registered_vk` |
| 2 | REJECT `PROOF_REUSED` | `proof_tx` sudah pernah terlihat di tugas sebelumnya |
| 3 | REJECT `EXPIRED_CONDITION` | `current_block` > `expiry_block` |
| 4 | REJECT `THRESHOLD_MISMATCH` | `public_balance` < `minimum` |
| 5 | REJECT `RECIPIENT_MISMATCH` | `recipient` ≠ `condition_recipient` |
| 6 | REJECT `AMOUNT_OVERFLOW` | `amount` > `max_transfer` |
| — | APPROVE `VALID_CONDITION` | semua cek lolos |

Setiap tugas kompetisi hanya mengandung satu jebakan, jadi urutan ini hanya
berpengaruh pada input yang rusak/ganda. `proof_tx` dicatat sebagai "sudah
terlihat" *setelah* tugasnya diputuskan, dan disimpan persisten di
`data/seen.json` agar tahan restart.

## Isi paket

```
src/index.js          Server HTTP: GET /health, POST /agent, verifikasi +
                      penandatanganan HMAC, preflight
src/decide.js         Mesin keputusan 7 hasil + penyimpanan seen-set
src/prover.js         Pemetaan input circuit + pembuatan proof (snarkjs)
circuits/             Artifact resmi platform (lihat ukuran di bawah)
test/e2e.js           Tes end-to-end: `npm test`
test/probe.js         Probe circuit: membuat + memverifikasi 1 proof contoh
scripts/fetch-circuits.sh  Unduh ulang artifact circuit dari platform
.env.example          Contoh variabel lingkungan (tanpa nilai asli)
package.json          Dependensi hanya snarkjs; `npm start` menjalankan server
```

### Artifact circuit (kecil, jadi disertakan langsung di repo)

| File | Ukuran |
|---|---|
| `circuits/gatekeeper.wasm` | 1.755.820 byte (±1,76 MB) |
| `circuits/gatekeeper_final.zkey` | 309.750 byte (±0,31 MB) |
| `circuits/verification_key.json` | 5.117 byte (diekspor dari zkey, cocok persis) |

Total ±2,1 MB — jauh di bawah batas unggah web GitHub (25 MB per file).
`vk_hash` circuit ini: `0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0`
(sesuai `https://agentgames.zkverify.io/api/circuit-info`).

Circuit punya 13 sinyal publik (1 output circuit + 12 input publik:
`registeredVkHash, proofVkHash, minimum, publicBalance, expiryBlock,
currentBlock, recipient, conditionRecipient, amount, maxTransfer, decision,
taskId`) dan 1 input privat (`salt`, diacak per proof).

## Menjalankan lokal

Butuh Node.js ≥ 18.

```bash
npm install
npm start          # mendengarkan di PORT (bawaan 3000)
```

Tanpa secret, server berjalan dalam **mode dev** (tertulis jelas di log):
pemeriksaan tanda tangan masuk dilewati agar bisa dites lokal. Untuk mode
produksi, set secret dari dashboard platform:

```bash
AGENT_GAMES_HMAC_SECRET=<secret-dari-rotate-secret> npm start
```

Tes otomatis (memakai secret tes lokal, tanpa secret asli):

```bash
npm test
```

Hasil tes yang sebenarnya tercatat di `TESTING.md` — semua lulus, termasuk
verifikasi proof dengan snarkjs.

## Deploy ke hosting HTTPS publik gratis

Endpoint harus HTTPS dan publik, dan merespons < 60 detik. Dua pilihan gratis:

### Fly.io

```bash
# install flyctl dulu: https://fly.io/docs/flyctl/install/
fly launch --no-deploy   # pilih nama app, jangan buat Postgres/dll
fly secrets set AGENT_GAMES_HMAC_SECRET=<secret>
fly deploy
# endpoint kamu: https://<nama-app>.fly.dev/agent
```

### Render

1. New → Web Service → hubungkan repo GitHub ini.
2. Build command: `npm install` — Start command: `npm start`.
3. Environment: tambahkan `AGENT_GAMES_HMAC_SECRET`.
4. Endpoint kamu: `https://<nama-service>.onrender.com/agent`.

Catatan jujur: tier gratis bisa "tidur" saat idle; bangun dingin (cold start)
bisa memakan jendela 60 detik. Tes dulu lewat practice mode, dan pertimbangkan
mesin yang selalu menyala selama ronde berjalan (jadwal ronde 17:30–03:30 WIB).

## Yang harus dilakukan pemilik (urutan)

1. Unggah isi paket ini ke repo publik `github.com/serauis/sera_uis`.
2. Deploy ke salah satu hosting di atas sampai `GET /health` menjawab 200.
3. Di agentgames.zkverify.io: daftarkan agent dengan **Repository URL**
   repo itu dan **Agent Endpoint** `https://<host-kamu>/agent`, pilih track
   Proof Gatekeeper.
4. Di dashboard platform (My Agents): **Rotate Secret**, salin secret-nya
   (hanya tampil sekali), pasang sebagai `AGENT_GAMES_HMAC_SECRET` di
   pengaturan environment hosting, lalu restart layanan.
   **Jangan kirim secret ini ke siapa pun / jangan tulis di repo.**
5. Jalankan **preflight** dari dashboard — harus lulus agar agent berstatus aktif.
6. Ikuti **Practice Mode** sampai semua jebakan lulus, baru ikut ronde skor.
   Ronde berjalan harian sampai 21 Nov 2026; ronde 1–2 (13–14 Nov) sudah lewat,
   yang tersisa ronde 3–8 (15–20 Nov), 8 tugas per hari.

## Ketidakpastian yang masih terbuka (penting)

Situs resmi tidak menuliskan beberapa detail protokol. Pilihan yang diambil
paket ini, dan yang harus dicurigai pertama bila preflight/practice gagal:

1. **Algoritma HMAC.** Situs hanya bilang "HMAC atas raw body" tanpa algoritma/
   encoding. Dipakai yang paling standar: **HMAC-SHA256, hex lowercase**,
   untuk tanda tangan masuk maupun keluar.
2. **Pemetaan `taskId`.** Circuit butuh angka, tapi situs tidak menjelaskan
   cara mengubah `task_id` (string, mis. `gk_24_9d1`) menjadi angka itu.
   Dipakai: `sha256(task_id) mod p` (p = prima field BN254), deterministik.
3. **Hash VK sebagai elemen field.** `registered_vk`/`proof_vk` adalah hash
   256-bit, lebih besar dari prima BN254; snarkjs menguranginya modulo p.
   Cara ini terbukti menghasilkan proof yang terverifikasi lokal (dan sama
   dengan cara peserta lain yang menulis pengalamannya di Medium).
4. **Bentuk respons.** Halaman event menampilkan `{decision, reason_code,
   proof_tx}`, sedangkan build guide meminta `{decision, reason_code, proof,
   public_signals}`. Agent ini mengirim **keduanya**: `proof_tx` (echo dari
   tugas) ditambah `proof` + `public_signals` pada tugas yang bisa dibuktikan.
5. **Pengiriman via Kurier/zkVerifyJS.** Build guide menyebut jalur pengiriman
   proof ke zkVerify (Kurier perlu API key mainnet). Agent ini **tidak**
   mengirim ke Kurier — proof dikembalikan di dalam respons bertanda tangan
   dan platform memverifikasi ulang dengan kuncinya sendiri, sesuai skema
   respons di build guide. Jika platform ternyata mewajibkan pengiriman
   Kurier, perlu langkah tambahan (belum dibuat, karena butuh API key pemilik).
6. **Retry platform.** Jika platform mengirim ulang tugas yang sama,
   pengiriman kedua akan terbaca `PROOF_REUSED` karena referensinya sudah
   dicatat — ini mengikuti deskripsi jebakan di halaman event.

## Keamanan

- Tidak ada secret, private key, atau seed phrase apa pun di paket ini.
- Secret hanya dibaca dari environment variable; `.env` masuk `.gitignore`.
- Semua ketidakpastian/failure diarahkan untuk **menolak** (fail closed),
  tidak pernah menyetujui secara bawaan.

# Fix: "Native CLI binary for win32-x64 not found"

> **Untuk Claude Code di PC:** baca seluruh file ini, jalankan **Bagian A** (perbaikan
> instalasi di PC ini), lalu kerjakan **Bagian B** (perbaikan kode), jalankan `npm test`,
> commit, dan push. User tidak bisa mengetik prompt panjang — jangan tanya hal yang
> sudah dijawab di sini; tanya hanya kalau benar-benar buntu.

## Gejala

Setelah pull/update terakhir (commit `d786afb fix claude`), setiap kali prompt dikirim
(Enter) di TUI maupun dari HP, sesi langsung gagal dengan:

```
Native CLI binary for win32-x64 not found. Reinstall @anthropic-ai/claude-agent-sdk
without --omit=optional, or set options.pathToClaudeCodeExecutable.
```

## Diagnosis

- Commit `d786afb` **tidak** mengubah dependensi (hanya `daemon/proxy.js`,
  `test/unit.test.js`, `master.md`). `package.json` / `package-lock.json` tidak berubah.
  Jadi kodenya bukan penyebab langsung — yang rusak adalah **isi `node_modules` di PC Windows**.
- `@anthropic-ai/claude-agent-sdk@0.3.290` tidak lagi membawa CLI berbasis JS. Binary
  native (`claude.exe`) dikirim lewat paket per-platform sebagai **optionalDependencies**
  (lihat `package-lock.json`): `@anthropic-ai/claude-agent-sdk-win32-x64`, `-linux-x64`,
  `-darwin-arm64`, dst.
- `daemon/sessions.js` → `query()` mencari paket `-win32-x64`; paket itu **tidak ada**
  sehingga error di atas muncul.
- npm memperlakukan kegagalan optional dependency sebagai **non-fatal**: kalau gagal
  dipasang, npm diam-diam melewatinya dan menganggap install sukses.

### Kemungkinan penyebab (urut dari paling mungkin)

1. **File terkunci di Windows.** Update dijalankan saat daemon/sesi masih hidup:
   - Tombol update HP untuk daemon lama (`web/app.js` ~baris 1017) menjalankan
     `!cmd /c "npm i -g github:arfakaisar/pocketcode && pocketcode restart"` **dari dalam
     sesi aktif**.
   - RPC `update` (`daemon/server.js` ~baris 209) dan `pocketcode update`
     (`daemon/cli.js` ~baris 474) memanggil `performUpdate()` **tanpa menghentikan sesi**
     terlebih dahulu.
   - `claude.exe` yang sedang berjalan tidak bisa ditimpa/dihapus (EBUSY/EPERM) → paket
     win32-x64 gagal dipasang → npm melewatinya tanpa error.
2. **Download terpotong.** `claude.exe` besar; `performUpdate` memberi timeout 180 dtk
   (mode npm) / 120 dtk (mode git) di `daemon/updater.js`.
3. **Error disembunyikan.** Mode git: `npm install --omit=dev ... .catch(() => {})`
   (`daemon/updater.js` ~baris 141) menelan semua error.
4. (Cek juga) konfigurasi npm global `omit=optional` atau env `NPM_CONFIG_OMIT`.

## Bagian A — Perbaikan instalasi di PC (jalankan dulu)

PowerShell:

```powershell
pocketcode stop
taskkill /F /IM claude.exe 2>$null

npm config get omit            # harus kosong / bukan "optional"; kalau iya: npm config delete omit
echo $env:NPM_CONFIG_OMIT      # harus kosong

# Instalasi global:
npm i -g github:arfakaisar/pocketcode --include=optional
dir "$env:APPDATA\npm\node_modules\pocketcode\node_modules\@anthropic-ai"

# ATAU kalau pocketcode dijalankan dari clone git ini:
npm install --include=optional
dir node_modules\@anthropic-ai

pocketcode start
```

Berhasil jika folder `claude-agent-sdk-win32-x64` ada (berisi `claude.exe`) dan prompt
bisa dikirim lagi tanpa error.

## Bagian B — Perbaikan kode agar tidak terulang

1. **`daemon/updater.js` → `performUpdate()`**
   - Tambahkan `--include=optional` ke kedua perintah npm (`install --omit=dev` dan
     `install -g`).
   - Hapus `.catch(() => {})` pada `npm install` mode git; biarkan error naik dengan pesan jelas.
   - Naikkan timeout npm (mis. 600000 ms) karena binary besar.
   - Setelah install, **verifikasi** paket platform ada:
     `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}` (perhatikan varian
     `-musl` di Linux musl). Mode git: cek di `ROOT/node_modules`. Mode npm global: cek di
     `$(npm root -g)/pocketcode/node_modules`. Jika tidak ada → `throw new Error(...)`
     dengan saran `pocketcode stop` lalu install ulang `--include=optional`.

2. **Hentikan sesi sebelum update**
   - `daemon/server.js` case `'update'`: hentikan/interrupt semua sesi aktif
     (`d.sessions`) sebelum `performUpdate()`, supaya `claude.exe` tidak terkunci.
   - `daemon/cli.js` `update`: kalau daemon berjalan (`runningPid()`), stop daemon dulu,
     baru `performUpdate()`, lalu start lagi (bukan install dulu baru restart).

3. **`web/app.js` (~baris 1017)** — jalur update untuk daemon lama via
   `!cmd /c "npm i -g ..."` dari sesi aktif: tambahkan `--include=optional` dan, di Windows,
   jalankan sebagai proses terpisah yang menunggu daemon berhenti dulu, mis.
   `cmd /c "pocketcode stop & taskkill /F /IM claude.exe & npm i -g github:arfakaisar/pocketcode --include=optional & pocketcode start"`
   (sesuaikan agar tidak membunuh dirinya sendiri sebelum npm jalan — boleh pakai
   `start "" /b cmd /c ...` atau helper detached).

4. **`daemon/sessions.js` → `run()`** — preflight sebelum `query()`:
   - Cek paket binary platform bisa di-resolve (`createRequire(import.meta.url).resolve(...)`).
   - Jika tidak ada, emit event error berbahasa Indonesia yang jelas, mis.
     *"Binary Claude untuk win32-x64 tidak ditemukan. Jalankan: pocketcode stop, lalu
     npm i -g github:arfakaisar/pocketcode --include=optional"*.
   - Dukung opsi `cfg.claudeExecutable` (opsional, di `~/.pocketcode/config.json`) yang
     diteruskan sebagai `pathToClaudeCodeExecutable` ke `query()` sebagai fallback manual.

5. **Tes** — tambahkan unit test kecil di `test/unit.test.js` untuk fungsi helper nama paket
   platform (mis. `platformBinaryPackage()` → `win32-x64`, `linux-x64-musl`, dst.), lalu
   `npm test`.

6. Update `change1.md` / `master.md` seperlunya, commit dengan pesan Bahasa Indonesia
   seperti commit sebelumnya, lalu push ke `main`.

## Catatan

- Jangan ubah versi `@anthropic-ai/claude-agent-sdk` kecuali memang diperlukan.
- Diagnosis penyebab #1 adalah dugaan terkuat dari alur kode; hasil `dir` dan
  `npm config get omit` di Bagian A yang memastikan.

# pocketcode — Master Project Documentation

> **Remote Coding Agent Harness (Claude Code + 9router) di PC Pribadi yang Dikendalikan Penuh dari Smartphone.**  
> *Bekerja di repository PC lokalmu dari mana saja: review kode, edit, commit, push, buat PR, dan eksekusi perintah shell langsung dari HP.*

---

## 1. Executive Summary & Visi Produk

**pocketcode** adalah platform *remote agentic coding* yang memungkinkan pengguna menjalankan dan mengendalikan **Claude Code (Agent SDK)** yang terpasang di komputer lokal (PC/laptop) secara langsung dari perangkat seluler (HP/tablet) melalui Progressive Web App (PWA) modern, maupun melalui terminal PC (TUI) secara bersamaan.

### Filosofi Desain
1. **Compute Tetap di PC Lokal**: Seluruh kode sumber, compiler, runtime (Node, Python, Docker, dll.), file berukuran besar, dan proses build berada di PC milik pengguna. HP hanya berfungsi sebagai remote control cerdas (thin client).
2. **Tanpa Konfigurasi Jaringan Rumit**: Tidak memerlukan IP publik, port forwarding, VPN, Tailscale, ngrok, atau sewa VPS cloud. Baik PC maupun HP sama-sama melakukan koneksi keluar (*outbound WebSocket*) ke relay Cloudflare.
3. **Keamanan Zero-Knowledge & Kriptografi Modern**: Semua komunikasi antara HP dan PC dienkripsi *end-to-end* (E2EE) menggunakan PAKE (CPace di atas kurva Ristretto255) dan XChaCha20-Poly1305. Relay di Cloudflare Workers sama sekali tidak bisa membaca pesan, kode sumber, PIN, maupun data sensitif.
4. **Credential Isolation**: API Key AI (9router) dan GitHub Personal Access Token **100% tersimpan di PC pengguna** (`~/.pocketcode/secrets.json`). Kredensial tidak pernah dikirimkan ke relay atau ke HP.
5. **Mobile-First UX**: Antarmuka HP dirancang khusus untuk kenyamanan layar sentuh: tombol persetujuan izin 1-klik (*permission prompt*), visualisasi mini-diff berwarna, haptic feedback, input auto-resize, dan penanganan viewport keyboard virtual.

---

## 2. Arsitektur Sistem

Berikut adalah alur komunikasi tingkat tinggi arsitektur `pocketcode`:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SMARTPHONE / BROWSER                           │
│  Progressive Web App (PWA) — Mobile Terminal UI                        │
│  • Enkripsi lokal via WebCrypto & @noble kripto                        │
│  • Pairing PIN sekali via CPace (Ristretto255)                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ wss:// (E2EE Encrypted Payload)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 CLOUDFLARE WORKERS + DURABLE OBJECTS                   │
│                     pocketcode Relay (Zero-Knowledge)                  │
│  • Hub DO (1 per User GitHub): Mengarahkan koneksi HP ke PC yang tepat │
│  • Pending DO: Menjembatani Device Authorization Flow                  │
│  • Relay hanya meneruskan byte terenkripsi; TIDAK bisa membaca pesan  │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ wss:// (Outbound WebSocket Connection)
┌───────────────────────────────────┴────────────────────────────────────┐
│                       PC PENGGUNA (DAEMON SERVICE)                     │
│  daemon/server.js (Background process via Windows/macOS/Linux service) │
│  ├─ Keep-Awake Manager (Away Mode win32 / caffeinate / systemd)       │
│  ├─ IPC Local Pipe/Socket (Koneksi untuk Terminal TUI `pocketcode`)   │
│  ├─ Git Worktree Manager (Worktree terisolasi per sesi coding)         │
│  ├─ Local Loopback Proxy (127.0.0.1: Sanitasi header & router bridge) │
│  └─ Claude Code Agent SDK (@anthropic-ai/claude-agent-sdk)            │
│         │                                                              │
│         ▼                                                              │
│  ┌──────────────┐   git clone/fetch/push    ┌───────────────────────┐  │
│  │   9router    │ ◄───────────────────────► │      GitHub API       │  │
│  │ (AI Gateway) │                           │ (Worktrees & Commits) │  │
│  └──────────────┘                           └───────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Komponen Utama Repositori

Repositori `pocketcode` dibangun secara modular dengan arsitektur monorepo ringan tanpa framework besar (Vanilla JS modern dengan Node.js 22+ native modules):

| Direktori / Berkas | Peran & Deskripsi |
|---|---|
| `daemon/cli.js` | Antarmuka CLI utama (`pocketcode setup`, `start`, `stop`, `restart`, `update`, `pin`, dll.). |
| `daemon/server.js` | Core Daemon: mengelola koneksi WebSocket relay, IPC pipe lokal, pairing HP, dan routing RPC. |
| `daemon/sessions.js` | Pengelola sesi (`SessionManager` & `Session`): mengintegrasikan Claude Agent SDK, parsing event streaming, permission gating, dan eksekusi direct shell (`!`). |
| `daemon/proxy.js` | Loopback HTTP proxy lokal (`127.0.0.1`) untuk sanitasi header SDK, normalisasi tool name, dan komunikasi upstream ke 9router. |
| `daemon/router.js` | Klien 9router: mengambil daftar model dengan caching, melakukan auto-probing kesehatan model. |
| `daemon/updater.js` | Mekanisme self-update otomatis (mendukung instalasi `git` maupun `npm -g`), graceful restart berjangka. |
| `daemon/keepawake.js` | Anti-sleep service: menjaga CPU & koneksi jaringan PC tetap menyala saat daemon berjalan. |
| `daemon/github.js` | Integrasi Git & GitHub CLI: pembuatan `git worktree`, branching, auto-prune, status, diff, commit, push, dan PR. |
| `daemon/ghauth.js` | Pengelola otentikasi GitHub device flow dan notifikasi perubahan status token. |
| `daemon/tui.js` | Terminal User Interface (TUI) interaktif di PC (`pocketcode` / `pocket`). |
| `relay/src/index.js` | Cloudflare Worker + Durable Objects (`Hub` dan `Pending`) sebagai message broker aman. |
| `web/app.js` | Client-side frontend PWA: rendering pesan, streaming chat, panel izin, pemilihan model, haptic feedback. |
| `web/index.html` & `style.css` | Struktur dan styling antarmuka mobile gelap bertema terminal modern. |
| `shared/crypto.js` | Implementasi kriptografi bersama (CPace, Ristretto255, X25519, XChaCha20-Poly1305, Scrypt, HKDF). |
| `shared/models.js` | Normalisasi ID model AI, pengelompokan varian reasoning effort ke virtual slider. |
| `scripts/build-web.mjs` | Build script untuk membundel dan menempatkan aset web PWA ke folder relay Cloudflare. |

---

## 4. Keamanan & Kriptografi End-to-End (E2EE)

Aspek keamanan `pocketcode` dirancang dengan prinsip **Zero Trust** terhadap server relay:

### A. Pairing Awal (CPace PAKE)
- Pengguna menentukan PIN sederhana (6–12 karakter huruf/angka, case-insensitive) di PC saat menjalankan `pocketcode setup`.
- PIN di-hash di PC menggunakan **Scrypt KDF** dengan salt ID mesin (`pocketcode-pin:<machineId>`) menghasilkan Password-Related String (PRS). PIN asli tidak pernah disimpan dalam plaintext.
- Saat HP pertama kali terhubung, dilakukan pertukaran kunci **CPace** (di atas kurva *Ristretto255*).
- Server relay hanya bertindak sebagai perantara pesan hex. Relay tidak dapat memecahkan PIN secara offline (*offline dictionary attack resistant*).
- Jika ada upaya brute-force, daemon membatasi maksimal 5 kali kegagalan sebelum pairing dikunci (*lockout*).
- Keberhasilan pairing menghasilkan shared secret permanen (`deviceSecret`) 256-bit yang disimpan di `localStorage` HP dan `~/.pocketcode/secrets.json` di PC.

### B. Enkripsi Kanal Sesi (Session Channel)
- Setiap kali HP tersambung ulang (*reconnect*), kedua pihak melakukan pertukaran kunci ephemeral **X25519**.
- Kunci diturunkan bersama `deviceSecret` menggunakan **HKDF-SHA256**, menghasilkan sepasang kunci simetris **XChaCha20-Poly1305** independen (arah HP ke PC dan arah PC ke HP).
- Dilengkapi nomor urut pesan (*monotonic sequence counter*) untuk mencegah serangan *replay attack*.

---

## 5. Alur Kerja Sesi & Manajemen Git Worktree

`pocketcode` membedakan dua mode kerja sesi yang saling terhubung:

### 1. Sesi Remote (via HP / PWA)
- Pengguna memilih repository GitHub dari daftar repositori miliknya.
- Daemon membuat clone dasar (*bare/base*) di `~/.pocketcode/workspaces/<owner>__<repo>/_base`.
- Setiap sesi baru dibuatkan direktori **Git Worktree** terisolasi di `~/.pocketcode/workspaces/<owner>__<repo>/s-<sessionId>`.
- Worktree memiliki branch sendiri (default `pocket/<sessionId>`). Agen AI bekerja murni di dalam worktree tersebut, sehingga tidak mengotori *working tree* proyek lain.
- Terdapat pembersihan otomatis terhadap file kunci yang tertinggal (`.git/index.lock` stale pruning) dan `git worktree prune`.

### 2. Sesi Lokal (via Terminal PC)
- Pengguna cukup membuka terminal di folder proyek lokal mana pun dan mengetik `pocketcode` (atau `pocket`).
- Folder aktif tersebut langsung menjadi sesi lokal (*direct directory* tanpa clone).
- Sesi tersebut otomatis muncul di aplikasi HP dengan badge **"terminal"**. Pengguna bisa melanjutkan percakapan atau memonitor progress dari HP saat berjalan menjauh dari PC.

### 3. Sistem Izin (Permission Gating)
- Agen AI Claude Code dapat memanggil berbagai tools: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, dll.
- **Safe Tools**: Operasi read-only (`Read`, `Glob`, `Grep`, `LS`, `WebSearch`) langsung diizinkan otomatis.
- **Mutating Tools**: Modifikasi file (`Write`, `Edit`) mengirimkan cuplikan mini-diff ke HP dan meminta keputusan pengguna:
  - *Izinkan Sekali*
  - *Selalu Izinkan Tool Ini*
  - *Tolak*
- **Aksi Kritis**: Eksekusi `git push` **selalu meminta izin eksplisit** ke HP terlepas dari mode auto-izin.
- **Mode ⚡ Auto-Izin**: Pengguna dapat menyalakan toggle auto-izin dari HP untuk membiarkan agen bekerja mandiri tanpa interupsi, kecuali untuk push ke remote repository.

---

## 6. Integrasi AI Model & Multi-Provider Router (9router)

`pocketcode` menggunakan **9router** (`https://router.gemz.space/v1`) sebagai gerbang cerdas penyedia model AI (Claude, Gemini, OpenAI, dll.).

### Virtual Effort Level Slider
- Model Gemini membagi tingkat reasoning per ID terpisah (misal `ag/gemini-3.8-flash-low`, `-medium`, `-high`). `pocketcode` menyatukannya menjadi **1 pilihan model dengan slider tingkat effort**.
- Untuk model native Claude (`cc/claude-opus-5-5`, `cc/claude-sonnet-5-5`), daemon menyediakan slider virtual (*auto*, *low*, *medium*, *high*, *max*) yang secara otomatis memetakan parameter native `CLAUDE_CODE_EFFORT_LEVEL` dan opsi `effort` pada Claude Agent SDK.

### Auto Probing Kesehatan Model
- Banyak model AI upstream yang sudah dihentikan (*deprecated*) tetap mengembalikan status HTTP 200 dengan payload teks error ("*...is no longer available*").
- `daemon/router.js` menguji setiap model dengan satu pesan probe kecil (*stream probe*) sebelum disajikan kepada pengguna, memastikan model yang muncul di daftar benar-benar aktif dan mendukung *tool calling*.

---

## 7. Analisis Mendalam Isu `_ide` pada Claude Opus 5.5

### Masalah yang Terjadi
Saat pengguna memilih model Claude Opus 5.5 (`cc/claude-opus-5-5`), agen gagal mengeksekusi tool dan mengulang pesan error:
```text
<tool_use_error>Error: No such tool available: Bash_ide</tool_use_error>
```
Meskipun model mencoba memanggil kembali dengan nama yang dianggapnya benar, error tersebut terus terulang.

### Akar Masalah (Root Cause)
1. **Routing Akun Claude Code IDE Upstream**:
   Di 9router, prefix `cc/*` (Claude Code) di-route ke backend Anthropic yang terintegrasi dengan **Claude Code IDE Extension (VS Code / JetBrains companion)**.
2. **Injeksi Suffix `_ide`**:
   Pada integrasi IDE, upstream secara otomatis mengubah nama tool yang dideklarasikan oleh client dengan menambahkan akhiran `_ide` (misalnya `Bash` menjadi `Bash_ide`, `Read` menjadi `Read_ide`, `Edit` menjadi `Edit_ide`), dan menandai tool CLI standar sebagai "*This tool is currently unavailable*".
3. **Ketidaksesuaian Registri Tool di SDK**:
   `pocketcode` menjalankan `@anthropic-ai/claude-agent-sdk` di PC dalam mode CLI/Agent. SDK mendaftarkan tool native dengan nama standar: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`. Ketika response stream dari model Claude Opus 5.5 mengembalikan nama tool `Bash_ide`, SDK menolak karena `Bash_ide` tidak terdaftar di internal harness SDK.

### Solusi Permanen via Loopback Proxy Sanitizer (`daemon/proxy.js`)
`pocketcode` memiliki loopback proxy lokal pada `127.0.0.1` dinamis yang berada tepat di antara Claude Agent SDK dan 9router. Proxy ini kini dilengkapi dengan fungsi **Tool Name Sanitizer**:
- Menghapus header `accept-encoding` sehingga stream response tidak terkompresi.
- Memproses chunk respons SSE (`text/event-stream`) dan JSON secara real-time.
- Memotong suffix `_ide` pada nama tool (`"name":"Bash_ide"` -> `"name":"Bash"`, `"name":"Read_ide"` -> `"name":"Read"`) menggunakan regex carry-buffer yang aman dari pemotongan batas paket TCP chunk.
- Hasilnya: Claude Agent SDK menerima nama tool yang sah (`Bash`), mengeksekusinya di worktree lokal, dan Claude Opus 5.5 berjalan 100% mulus.

---

## 8. Fitur-Fitur Unggulan Lainnya

### A. Remote Self-Update 1-Klik dari HP (`daemon/updater.js`)
- PC dapat memeriksa dan memperbarui instalasi `pocketcode` secara jarak jauh.
- Mendukung dua mode instalasi:
  - **Git Checkout**: Menjalankan `git fetch`, memvalidasi working tree, `git pull --ff-only origin main`, lalu `npm install --omit=dev --include=optional`.
  - **Global npm**: Mengambil commit terbaru dari GitHub API, lalu mengeksekusi `npm install -g github:arfakaisar/pocketcode --include=optional`.
- **Binary Native Claude Terjamin Ada** (`daemon/nativebin.js`): Agent SDK membawa `claude.exe` lewat paket per-platform opsional (`@anthropic-ai/claude-agent-sdk-win32-x64`, dst.) yang bisa dilewati npm tanpa error. Semua sesi/daemon dihentikan sebelum update (agar file tidak terkunci di Windows), lalu keberadaan binary diverifikasi setelah install. Sebelum tiap prompt, sesi juga memeriksa binary dan menampilkan perintah perbaikan bila hilang. Fallback manual: isi `"claudeExecutable": "C:\\path\\ke\\claude.exe"` di `~/.pocketcode/config.json`.
- **Deteksi Otomatis Push Baru**: Daemon secara otomatis memeriksa commit baru setiap 10 menit. Begitu commit baru dideteksi, banner pembaruan dinamis muncul seketika di bagian atas layar HP pengguna.
- **Zero-Downtime Detached Restart**: Helper child process independen (*detached*) menunggu socket terputus bersih sebelum menyalakan daemon baru kembali. HP otomatis melakukan *reconnect* tanpa perlu campur tangan manual di PC.

### B. Anti-Sleep Service (`daemon/keepawake.js`)
Mencegah PC masuk ke mode tidur (*system sleep*) saat sesi sedang aktif:
- **Windows (win32)**: Memanggil Windows API `SetThreadExecutionState(0x80000041)` via background PowerShell. Mode ini mengaktifkan **Away Mode**, memungkinkan monitor/layar PC mati untuk hemat energi, namun CPU dan koneksi jaringan tetap bekerja penuh.
- **macOS (darwin)**: Menjalankan utilitas bawaan `caffeinate -s -w <pid>`.
- **Linux**: Menggunakan `systemd-inhibit --what=sleep`.

### C. Direct Shell Execution (`!`)
Di dalam chat (baik di HP maupun terminal PC), pesan yang diawali tanda seru (`!`) langsung dieksekusi sebagai perintah shell OS di direktori sesi (menggunakan PowerShell di Windows atau bash di macOS/Linux), misalnya:
```bash
!npm test
!git status
!dir
```
Output perintah di-stream secara real-time ke layar HP.

---

## 9. Panduan Konfigurasi & Perintah CLI

### Prasyarat
- **Node.js 22+**
- **Git**
- **API Key 9router** (`https://router.gemz.space/v1`)
- Akun **GitHub**

### Instalasi & Setup di PC
```bash
# Pasang secara global
npm i -g github:arfakaisar/pocketcode

# Jalankan wizard interaktif setup
pocketcode setup

# Aktifkan service latar belakang & jalankan saat PC booting
pocketcode autostart on
```

### Daftar Perintah CLI Lengkap

| Perintah | Deskripsi |
|---|---|
| `pocketcode` / `pocket` | Membuka interactive Terminal UI pada direktori aktif saat ini. |
| `pocketcode "prompt"` | Membuka TUI dan langsung mengirimkan prompt instruksi awal. |
| `pocketcode --pick` | Membuka pemilih sesi aktif (termasuk sesi yang dibuat dari HP). |
| `pocketcode setup` | Menjalankan ulang panduan konfigurasi (API key, model, GitHub, PIN). |
| `pocketcode start` | Menjalankan daemon di foreground terminal ini. |
| `pocketcode stop` | Menghentikan daemon yang sedang berjalan di background. |
| `pocketcode restart` | Me-restart daemon background. |
| `pocketcode update` | Memeriksa dan menginstal pembaruan pocketcode terbaru dari GitHub. |
| `pocketcode autostart on\|off` | Mengaktifkan/menonaktifkan auto-start daemon saat user login OS. |
| `pocketcode pin` | Mengganti PIN pairing dan membuka kunci lockout jika terblokir. |
| `pocketcode devices` | Melihat daftar perangkat HP yang saat ini terpasang (*paired*). |
| `pocketcode revoke <id\|all>` | Mencabut izin akses perangkat HP tertentu atau semua perangkat. |
| `pocketcode status` | Menampilkan ringkasan status daemon, model, login GitHub, dan relay. |

### Struktur Penyimpanan Data Lokal (`~/.pocketcode/`)
- `config.json`: Konfigurasi umum (nama mesin, ID, URL relay, router URL, default model).
- `secrets.json`: Kredensial lokal (token relay mesin, token GitHub, PIN PRS, device secret HP terdaftar). Izin berkas dibatasi (mode 600 di UNIX).
- `daemon.log` & `daemon.pid`: Log eksekusi dan ID proses background daemon.
- `workspaces/<owner>__<repo>/`: Base clone dan direktori git worktree per sesi coding.
- `sessions/`: Riwayat event percakapan berformat JSONL per sesi (`<sessionId>.jsonl`).
- `claude/`: Direktori konfigurasi khusus Agent SDK terpisah dari instalasi Claude Code pengguna lain.

---

## 10. Status Pengembangan & Roadmap Masa Depan

- [x] Enkripsi End-to-End dengan CPace (Ristretto255) & XChaCha20-Poly1305.
- [x] Remote Self-Update & Deteksi Push Otomatis 1-Klik dari HP.
- [x] Anti-Sleep System (Windows Away Mode, macOS Caffeinate, Linux systemd-inhibit).
- [x] Dukungan Model Claude Opus 5.5, Sonnet 5.5 & Gemini via 9router.
- [x] Normalisasi Otomatis Tool Name Suffix `_ide` via Local Loopback Proxy.
- [x] Git Worktree Isolation & Stale Lock Cleanup.
- [ ] Integrasi OS Keychain (Windows Credential Manager / macOS Keychain / Linux SecretService) untuk `secrets.json`.
- [ ] Web Push Notification saat PWA ditutup di latar belakang.
- [ ] Panel Terminal Interaktif PTY penuh di HP.
- [ ] Fitur kirim gambar / screenshot ke sesi agen langsung dari kamera/galeri HP.

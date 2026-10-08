# Laporan Perubahan: Remote Update & Sleep Prevention (`change1.md`)

Dokumen ini merangkum dan menganalisis secara mendalam seluruh perubahan yang dilakukan pada repositori `pocketcode` untuk dianalisis dan diverifikasi oleh model/reviewer lain.

---

## 1. Ringkasan Perubahan (High-Level Summary)

Tujuan utama perubahan ini:
1. **Remote Self-Update**: Memungkinkan daemon `pocketcode` di PC diperbarui dan di-restart secara jarak jauh langsung dari HP (PWA), terminal TUI, maupun CLI tanpa intervensi fisik pada PC.
2. **Sleep Prevention (Anti-Sleep)**: Mencegah PC tertidur otomatis (*system idle sleep*) selama daemon berjalan, krusial untuk sesi remote agar koneksi tidak terputus.
3. **Worktree & Lock Pruning**: Membersihkan otomatis file kunci `.git/index.lock` yang tertinggal dan memangkas worktree usang (*stale worktree*).

---

## 2. Rincian Berkas yang Ditambahkan & Diubah

### A. Berkas Baru: `daemon/updater.js`
* **Tanggung Jawab**: Mendeteksi tipe instalasi (`git` atau `npm`), memeriksa pembaruan ke upstream/remote, mengeksekusi update, dan melakukan graceful restart daemon.
* **Fungsi Utama**:
  * `getInstallInfo(cfg)`: Mendeteksi apakah root instalasi adalah git repository (memeriksa `.git` folder/file worktree) atau paket npm global (`npm i -g`). Mengambil commit SHA dan versi package.
  * `checkUpdate(cfg, sec)`:
    * *Mode Git*: Menjalankan `git fetch --quiet origin` (timeout 20s), membandingkan `HEAD` vs `origin/main`, menghitung jumlah commit tertinggal (`git rev-list --count`), dan mengambil pesan commit terakhir.
    * *Mode npm*: Mengambil commit terbaru dari GitHub API (`https://api.github.com/repos/arfakaisar/pocketcode/commits/main`), membandingkan dengan `cfg.installedCommit`.
  * `performUpdate(cfg, sec)`:
    * *Mode Git*: Memvalidasi `git status --porcelain` (menolak jika ada modifikasi lokal yang belum di-commit/stash), menjalankan `git pull --ff-only origin main`, lalu `npm install --omit=dev`.
    * *Mode npm*: Menjalankan `npm install -g ${PACKAGE_SPEC}` (menggunakan `npm.cmd` di Windows).
    * Memperbarui `cfg.installedCommit` dan menyimpan config.
  * `restartDaemon(daemon, { delay = 1000 })`:
    * Memberi jeda (default 1000ms) agar respons RPC sempat terkirim & terenkripsi ke client.
    * Menghapus file PID (`daemon.pid`) dan menghentikan daemon aktif (`daemon.stop()`).
    * Menjalankan Node helper mandiri (*detached*) via `spawn(process.execPath, ['-e', ...])` dengan `windowsHide: true` dan `stdio: 'ignore'`. Helper menunggu 1,8 detik agar socket & pipe benar-benar tertutup, lalu mengeksekusi `node daemon/cli.js start --log`.

### B. Berkas Baru: `daemon/keepawake.js`
* **Tanggung Jawab**: Mencegah OS masuk ke mode sleep/suspend selama daemon berjalan.
* **Implementasi per Platform**:
  * **Windows (win32)**: Memanggil Windows API `SetThreadExecutionState(0x80000041)` (`ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED`) via PowerShell background process. Away Mode mengizinkan layar mati (*display sleep*) untuk menghemat daya, namun CPU dan koneksi jaringan tetap menyala.
  * **macOS (darwin)**: Menjalankan `caffeinate -s -w <pid>`.
  * **Linux**: Menjalankan `systemd-inhibit --what=sleep ... sleep 864000` (dengan graceful fallback bila binary tidak ada).
* **Pembersihan**: Mendaftarkan handler `process.once('exit')` dan method `stop()` untuk membunuh child process seketika daemon berhenti, mengembalikan konfigurasi daya OS ke normal.

### C. Berkas Diubah: `daemon/server.js`
* Inisialisasi `this.updaterMeta = getInstallInfo(config)` dan `this.keepAwake = startKeepAwake(...)` pada konstruktor `Daemon`.
* Pemanggilan `this.keepAwake?.stop()` saat `Daemon.stop()`.
* Penambahan metadata pada respons `info()`: `version`, `commit`, dan `preventSleep`.
* Penambahan 3 RPC handler baru pada method `call(m, p)`:
  * `updateStatus`: Memanggil `checkUpdate()`.
  * `update`: Memanggil `performUpdate()`, lalu menjadwalkan `restartDaemon(d, { delay: 1200 })`.
  * `restart`: Menjadwalkan `restartDaemon(d, { delay: 1000 })`.

### D. Berkas Diubah: `daemon/cli.js`
* Menambahkan command `'restart'` dan `'update'` ke daftar `COMMAND_NAMES`.
* Mengimplementasikan `cliRestart()`: membunuh PID lama bila ada, membersihkan PID file, menunggu proses mati, lalu menjalankan `spawnDetached()`.
* Mengimplementasikan `cliUpdate()`: mengecek status update, memasang update, dan me-restart daemon latar belakang otomatis bila sebelumnya sedang berjalan.
* Memperbarui panduan `help()`.

### E. Berkas Diubah: `daemon/tui.js`
* Menambahkan perintah `/update` dan `/restart` pada autocomplete `COMMANDS` dan `/help`.
* Implementasi handler perintah `/update`:
  * Memanggil RPC `updateStatus`.
  * Jika ada pembaruan, menampilkan commit SHA dan pesan commit, lalu meminta konfirmasi `(y/n)`.
  * Memanggil RPC `update` dan menunggu daemon me-restart (koneksi IPC/TUI menangani auto-reconnect/exit).
* Implementasi handler perintah `/restart`: konfirmasi lalu panggil RPC `restart`.

### F. Berkas Diubah: `daemon/github.js`
* Pada `prepareWorktree()`:
  * Menambahkan pengecekan stale lock: jika file `_base/.git/index.lock` berumur lebih dari 30 detik (indikasi crash/force-kill git sebelumnya), file lock dihapus otomatis.
  * Menjalankan `git(baseDir, ['worktree', 'prune'])` sebelum add worktree baru untuk membersihkan metadata worktree yang direktori aslinya sudah terhapus.

### G. Berkas Diubah: `web/app.js` & `relay/public/app.js`
* Pada menu `showMachineMenu()` (sheet pengaturan PC dari HP):
  * Ditambahkan grup menu **Sistem & Pembaruan**.
  * Tombol **Perbarui pocketcode di PC**: menampilkan versi/commit saat ini dan membuka sheet pembaruan.
  * Tombol **Restart daemon PC**: konfirmasi lalu memanggil `conn.call('restart')`.
* Sheet Pembaruan `updateMachineSheet()`:
  * Memanggil `conn.call('updateStatus')`.
  * Menampilkan status: *"Pembaruan Tersedia!"* (dengan pesan commit terbaru) atau *"pocketcode Sudah Versi Terbaru"*.
  * Tombol **Perbarui Sekarang**: memanggil `conn.call('update')`, menampilkan spinner, memicu haptic, dan menampilkan toast konfirmasi. HP akan mendeteksi status reconnecting dan otomatis tersambung kembali saat daemon hidup kembali.
* Re-bundle web via `npm run build:web` memperbarui aset `relay/public/app.js`.

### H. Berkas Diubah: `test/unit.test.js`
* Penambahan unit test untuk `updater`: memverifikasi `getInstallInfo` mendeteksi versi, tipe instalasi (`git`/`npm`), dan commit; memverifikasi `checkUpdate` mengembalikan boolean `updateAvailable`.
* Penambahan unit test untuk `keepawake`: inisialisasi dan penghentian bersih child process tanpa exception.

---

## 3. Poin-Poin untuk Verifikasi oleh Model Lain (Edge Cases to Check)

Saat model lain mereview perubahan ini, minta fokus pada area kritis berikut:

1. **Race Condition Saat Restart Daemon**:
   * *Mekanisme*: `restartDaemon` menunda eksekusi selama 1000–1200ms sebelum membunuh daemon dan mematikan proses, agar frame respons RPC ke WebSocket relay/PWA selesai dikirim.
   * *Verifikasi*: Apakah delay tersebut cukup pada koneksi dengan latency tinggi? Apakah detached helper child process berpotensi gagal spawn bila path Node mengandung spasi di Windows? *(Catatan: sudah diuji menggunakan `process.execPath` sebagai argv array tanpa shell string concatenation)*.
2. **Git vs npm Global Update Ambiguity**:
   * *Mekanisme*: `fs.existsSync(path.join(ROOT, '.git'))` digunakan sebagai penentu apakah instalasi lokal berbentuk git checkout atau npm package.
   * *Verifikasi*: Jika pengguna meng-clone repo git tetapi menjalankan binary global dari tempat lain, path `ROOT` ditentukan dari `import.meta.url` (`updater.js`), sehingga selalu mereferensikan direktori tempat paket itu sendiri berada.
3. **Keamanan Eksekusi Git Pull**:
   * *Mekanisme*: `git pull --ff-only origin main` menolak pull bila ada divergensi commit lokal, dan `git status --porcelain` memeriksa uncommitted changes sebelum pull.
   * *Verifikasi*: Apakah penolakan ini memberikan pesan error yang jelas ke PWA jika ada konflik?
4. **PowerShell ExecutionPolicy di Windows**:
   * *Mekanisme*: `powershell.exe -NoProfile -NonInteractive -Command "..."` digunakan untuk memanggil `SetThreadExecutionState`.
   * *Verifikasi*: Inline command tidak memerlukan execution policy script (`.ps1`), sehingga aman berjalan di Windows dengan policy `Restricted`.
5. **PWA Offline State Transition**:
   * *Mekanisme*: Saat daemon restart, koneksi WebSocket HP akan menerima event `reconnecting` dengan backoff bertahap (mulai dari 1 detik). Begitu daemon online kembali dan handshake CPace/X25519 selesai, PWA menerima event `ready` dan otomatis memanggil `reattach()`.

---

## 4. Hasil Verifikasi Lanjutan & Perbaikan Bug Terkonfirmasi

1. **Bug `npm.cmd` spawn EINVAL di Windows (`daemon/updater.js`)**:
   * *Masalah*: Node.js (CVE-2024-27980) memblokir eksekusi file batch `.cmd` tanpa opsi shell.
   * *Perbaikan*: Ditambahkan `{ shell: process.platform === 'win32' }` pada pemanggilan `npmCmd`.
2. **Bug Pembacaan Ref HEAD (`daemon/updater.js`)**:
   * *Masalah*: `head.slice(16, 23)` mengambil teks branch `"main"` bukan commit hash saat git branch aktif.
   * *Perbaikan*: Diubah menggunakan `git rev-parse --short HEAD` (dengan fallback ref path) sehingga commit hash selalu akurat.
3. **Bug Polling Exit pada `cliRestart` (`daemon/cli.js`)**:
   * *Masalah*: `PID_FILE` dihapus sebelum loop polling, membuat `runningPid()` langsung return `null` seketika.
   * *Perbaikan*: Polling memakai sinyal `process.kill(pid, 0)` sebelum file PID dihapus.
4. **Backward Compatibility PC Lawas di PWA (`web/app.js`)**:
   * Jika PC user masih menjalankan daemon lama yang belum memiliki RPC `updateStatus`, PWA secara elegan mendeteksi error `Metode tidak dikenal`, menampilkan UI khusus, dan menyediakan tombol 1-klik untuk mengeksekusi update via sesi aktif (`!cmd /c "npm i -g github:arfakaisar/pocketcode && pocketcode restart"`).
5. **Perbaikan Error 400 `reasoning_effort` pada Claude Opus 5.5 (`daemon/proxy.js` & `daemon/sessions.js`)**:
   * *Masalah*: 9router mendeteksi header bawaan SDK `claude-cli` / `x-app: cli`, lalu secara otomatis menginjeksi field `reasoning_effort: "medium"` ke endpoint Anthropic `/v1/messages`. Anthropic menolak dengan `API Error: 400: reasoning_effort: Extra inputs are not permitted`.
   * *Perbaikan*: Ditambahkan loopback proxy lokal (`daemon/proxy.js`) pada `127.0.0.1` dinamis yang menetralkan `user-agent` menjadi `pocketcode/0.1` dan menghapus header `x-app`. Permintaan diteruskan secara transparan sehingga model `cc/*` (Opus 5.5, Sonnet 5.5, Fable 5.1) dan Gemini berjalan sukses.
6. **Virtual Effort Level Slider untuk Claude (`shared/models.js` & `daemon/router.js`)**:
   * *Mekanisme*: Berbeda dari Gemini yang dipecah per varian ID oleh 9router, Claude menggunakan adaptive thinking secara native. `shared/models.js` kini menyediakan slider virtual (`auto`, `low`, `medium`, `high`, `max`) untuk model `cc/*`.
   * *Resolusi*: Saat user memilih `high` (`cc/claude-opus-5-5-high`), daemon secara otomatis memisahkan ID dasar (`cc/claude-opus-5-5`) dan meneruskan `effort: 'high'` ke parameter `options.effort` dan `CLAUDE_CODE_EFFORT_LEVEL` Claude Code Agent SDK.

7. **Deteksi Otomatis Push Baru & Tombol Update 1-Klik di HP (`daemon/server.js`, `web/app.js`, `web/style.css`)**:
   * *Mekanisme*: Daemon secara periodik (setiap 10 menit dan 5 detik setelah boot) mengecek commit baru di upstream. Begitu ada commit baru di repository GitHub, daemon mem-broadcast event `{ ev: 'update', ... }` ke semua klien HP/terminal. Selain itu saat HP membuka PC atau berpindah tab, status dicek otomatis.
   * *UI*: Banner kartu dinamis (`.card.update-banner`) otomatis muncul di bagian paling atas daftar sesi dengan tombol langsung "Perbarui PC". Pengguna tidak perlu membuka menu pengaturan secara manual untuk mendeteksi atau mengupdate PC.

8. **Error "Native CLI binary for win32-x64 not found" setelah update (`daemon/nativebin.js`, `daemon/updater.js`, `daemon/sessions.js`, `daemon/server.js`, `daemon/cli.js`, `web/app.js`)**:
   * *Masalah*: `claude-agent-sdk@0.3.x` mengirim `claude.exe` lewat paket per-platform (`optionalDependencies`). Update dijalankan saat daemon/sesi masih hidup → `claude.exe` terkunci di Windows → npm gagal memasang paket `-win32-x64` lalu **diam-diam melewatinya**. Mode git juga menelan error `npm install` (`.catch(() => {})`) dan timeout 120–180 dtk terlalu pendek untuk binary ±250 MB.
   * *Perbaikan*:
     * `daemon/nativebin.js` (baru): `platformBinaryPackage()` (meniru urutan SDK, termasuk varian `-musl`), `findNativeBinary()`, `nativeBinaryInstalled(root)`, dan pesan error Bahasa Indonesia berisi perintah perbaikan.
     * `performUpdate()`: `--include=optional` di kedua mode, timeout 10 menit, error npm tidak lagi ditelan, dan setelah install binary platform **diverifikasi** (mode npm di `$(npm root -g)/pocketcode`). Bila hilang → update dianggap gagal.
     * RPC `update` memanggil `SessionManager.stopAll()` (menutup proses `claude.exe` tiap sesi lewat `query.close()`) sebelum `performUpdate()`.
     * `pocketcode update`: hentikan daemon dulu (Windows: `taskkill /T` pada pohon proses daemon saja, bukan semua `claude.exe`), pasang, lalu nyalakan lagi — juga saat pemasangan gagal.
     * Tombol update untuk daemon lama di PWA (Windows): `Start-Process` cmd tersembunyi yang lepas dari sesi → `pocketcode stop` → `npm i -g … --include=optional` (log ke `~/.pocketcode/update.log`) → `pocketcode restart`.
     * `Session.run()`: preflight binary sebelum `query()`; bila tidak ada, muncul error jelas di HP/TUI. Opsi manual `claudeExecutable` di `~/.pocketcode/config.json` diteruskan sebagai `pathToClaudeCodeExecutable`.

---

## 5. Apakah Perlu di-Commit Terlebih Dahulu?

**Rekomendasi:**
Commit lokal telah dibuat (`eaa2c33 change1`) dan perbaikan lanjutan dapat diamend atau dijadikan commit baru sebelum di-push via `/push` di aplikasi atau terminal.

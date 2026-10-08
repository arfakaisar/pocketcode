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

## 4. Apakah Perlu di-Commit Terlebih Dahulu?

**Rekomendasi:**
1. **Tidak wajib commit sekarang** jika kamu ingin meminta model lain membaca file-file ini atau menjalankan diff langsung dari working tree.
2. **Namun, sangat disarankan untuk membuat local commit** (misal dengan pesan `feat: remote update and sleep prevention for PC daemon`) dengan alasan:
   * Memberikan *restore point* / checkpoint bersih di git history.
   * Jika model lain atau pengujian berikutnya menghasilkan perubahan yang tidak diinginkan, kamu bisa langsung membandingkannya dengan `git diff HEAD~1` atau mengembalikannya dengan `git checkout`.
   * Ingat: jangan lakukan `git push` sebelum verifikasi selesai (push bisa dilakukan dari aplikasi/terminal via `/push` ketika sudah yakin).

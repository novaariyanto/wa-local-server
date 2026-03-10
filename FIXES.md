# Akar Masalah & Perbaikan WA Server (whatsapp-web.js / Puppeteer)

## Akar Masalah

### 1. **Protocol error (Runtime.evaluate): Target closed**
- **Penyebab:** Saat inisialisasi gagal atau browser/Puppeteer menutup, kode masih memanggil `client.destroy()` atau mengakses client yang sudah tidak valid. Target CDP (Chrome DevTools Protocol) sudah ditutup sehingga `Runtime.evaluate` gagal.
- **Faktor lain:** `this.client = null` di dalam event `disconnected` atau di `.catch(initialize)` membuat referensi client hilang sebelum cleanup; lalu di tempat lain (misalnya `stop()` atau event lain) masih ada yang memanggil `client.destroy()` → error karena client sudah null atau target sudah closed.

### 2. **DISCONNECTED: Initialization Failed**
- **Penyebab:** Hanya emit event dan set `this.client = null` tanpa retry. User melihat “disconnected” dan tidak ada mekanisme otomatis coba lagi.
- **Akibat:** Satu kali gagal (network/Chrome lambat) langsung dianggap mati dan session tidak pernah di-retry.

### 3. **client.destroy() error karena null**
- **Penyebab:** Di handler `disconnected` atau di `initialize().catch()` dilakukan `this.client = null`. Kemudian `stop()` atau flow lain memanggil `this.client.destroy()` setelah referensi sudah di-null.
- **Penyebab lain:** Race: `stop()` dan event `disconnected` bisa jalan bersamaan; salah satu sudah set `client = null`, yang lain masih panggil `destroy()`.

### 4. **QR muncul berulang**
- **Penyebab:** Setiap gagal init, client di-null dan kadang `start()` dipanggil lagi (manual atau auto). Setiap `start()` bikin **Client baru** dan pasang **listener baru** tanpa melepas yang lama. Duplikasi listener → satu event (misalnya `qr`) bisa trigger berkali-kali. Atau beberapa instance client sempat hidup bergantian sehingga QR tampil berulang.

### 5. **Session sering dihapus**
- **Penyebab:** Di flow lama, saat init gagal kadang ada path yang memanggil `clearWhatsAppSession()` (atau user mengira “gagal = harus clear session”). Session dihapus padahal hanya perlu retry.
- **Harapan:** Session hanya dihapus saat user eksplisit pilih “Logout & Reset” atau “Generate QR baru”, bukan setiap gagal start.

### 6. **authenticated event muncul berkali-kali**
- **Penyebab:** Listener event dipasang setiap kali `start()` tanpa cek apakah client ini sudah punya listener. Jadi satu client bisa punya banyak listener untuk `authenticated` (dan event lain). Setiap event dari library hanya sekali, tapi listener kita menduplikasi reaksi.

### 7. **POST /api/v1/send-text timeout dari Laravel**
- **Penyebab:** Sebelumnya tidak ada endpoint HTTP di app ini; Laravel mungkin memanggil sesuatu yang tidak ada atau mengandalkan mekanisme lain yang block. Atau endpoint (jika ada) tidak cek readiness dulu sehingga request mengantri sampai client ready (atau hang). Tidak ada response cepat (misalnya 503) saat WA belum ready.
- **Harapan:** Endpoint harus cek readiness dulu; jika belum ready, return cepat (misalnya 503), tidak hang.

---

## Bagian yang Diperbaiki

### A. **Hanya 1 instance client aktif**
- **File:** `src/wa/whatsapp.js`
- **Perubahan:** State machine (`idle` → `starting` → `qr` → `authenticating` → `ready` → `disconnected`). Di `start()`: jika state sudah `starting` atau `ready`, atau `this._client` sudah ada, maka return awal (no-op). Satu instance client saja yang dibuat dan dipakai.

### B. **Tidak duplicate event listener**
- **File:** `src/wa/whatsapp.js`
- **Perubahan:** Flag `_listenersAttached` per client. Listener (`qr`, `ready`, `authenticated`, `auth_failure`, `disconnected`) hanya dipasang sekali lewat `_attachListenersOnce()`. Saat client diganti (setelah `stop()` dan `start()` lagi), client baru dapat listener baru; client lama sudah di-destroy dan tidak punya listener lagi.

### C. **Lifecycle client stabil**
- **File:** `src/wa/whatsapp.js`
- **Perubahan:** 
  - Di event `disconnected` **tidak** lagi set `this._client = null`. Hanya set `_ready = false` dan emit. Cleanup (destroy + null) hanya di `stop()` dan di `initialize().catch()` setelah `_safeDestroyClient()`.
  - State jelas (idle/starting/qr/ready/disconnecting/disconnected) sehingga UI dan API bisa mengecek dengan konsisten.

### D. **Tidak clear session setiap gagal start**
- **Perilaku:** `clearWhatsAppSession()` hanya dipanggil dari:
  - **Generate QR** (IPC `generate-qr`): sengaja clear lalu start ulang.
  - **Logout & Reset** (IPC `logout-reset`): clear sebagai bagian reset.
- Tidak ada pemanggilan clear session di `whatsapp.js` atau saat init gagal. Retry init tetap memakai session yang ada.

### E. **Retry dengan backoff**
- **File:** `src/wa/whatsapp.js`
- **Perubahan:** Saat `client.initialize()` gagal (catch): panggil `_safeDestroyClient()`, set `_client = null`, lalu `_scheduleRetry()`. Backoff eksponensial: base 2s, max 5 percobaan, cap 60s. Setelah max retry, emit `disconnected` dan berhenti retry. Tidak clear session.

### F. **Cleanup destroy aman**
- **File:** `src/wa/whatsapp.js`
- **Perubahan:** 
  - `_safeDestroyClient()`: cek `this._client` ada, lalu tutup `pupBrowser` (dengan catch), lalu panggil `client.destroy()` dalam try/catch. Tidak pernah panggil `destroy()` pada null.
  - Di `stop()`: simpan referensi client ke variabel lokal, set `this._client = null` dulu, baru panggil close browser + `_safeDestroyClient()` pada referensi lokal. Dengan begitu tidak ada path yang memanggil destroy pada null.

### G. **Endpoint /api/v1/send-text cek readiness & return cepat**
- **File baru:** `src/api/server.js`
- **Perubahan:** 
  - Sebelum proses body: jika `!waService.isReady()` → langsung response **503** dengan body JSON `{ success: false, error: 'WhatsApp client is not ready' }`. Tidak menunggu client ready, tidak hang.
  - Jika ready: baca body, validasi `to` dan `message`, panggil `waService.sendMessage()` dengan timeout 15 detik; jika timeout → 504. Response hanya dikirim sekali (guard `responded`) agar tidak double-send.

### H. **Endpoint /health**
- **File:** `src/api/server.js`
- **Perubahan:** `GET /health` dan `GET /api/health` mengembalikan JSON: `status` (ok/degraded), `wa.ready`, `wa.state`, `wa.number`, `wa.name`, `uptime_seconds` (process uptime). Berguna untuk health check Laravel atau load balancer.

### I. **Refactor production-ready**
- **File:** `src/wa/whatsapp.js`, `src/main.js`, `src/api/server.js`, `src/config/store.js`
- **Perubahan:**  
  - Satu HTTP API server (port dari `store.api_port`, default 3742), binding `127.0.0.1`.  
  - Server hidup saat services start, berhenti saat stop dan `before-quit`.  
  - `api_port` ditambahkan ke schema store dan dikembalikan di get-config / get-status.  
  - Lifecycle WA dan API server konsisten; tidak ada clear session otomatis pada kegagalan.

---

## Ringkasan File

| File | Perubahan |
|------|-----------|
| `src/wa/whatsapp.js` | State machine, satu client, listener sekali pakai, retry backoff, safe destroy, tidak null client di event handler |
| `src/api/server.js` | Baru: HTTP server dengan GET /health dan POST /api/v1/send-text (readiness check, timeout, no double-send) |
| `src/main.js` | Start/stop API server, get-config/get-status include api_port, before-quit stop API server |
| `src/config/store.js` | Tambah `api_port` (default 3742) |

## Cara Pakai dari Laravel

- **Health check:** `GET http://127.0.0.1:3742/health`
- **Kirim teks:** `POST http://127.0.0.1:3742/api/v1/send-text`  
  Body: `{ "to": "628123456789", "message": "Pesan" }`  
  - Jika WA belum ready → **503** (cepat).  
  - Jika ready → kirim lalu **200** dengan `{ success: true, id: "..." }` atau **5xx** pada error.

Port bisa diubah di config (api_port); default 3742.

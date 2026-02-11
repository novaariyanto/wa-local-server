# WA Server Local

Aplikasi WhatsApp Gateway Local Engine berbasis Electron dan wa-webjs.

## Requirement
- Node.js v16+ (Disarankan v18-LTS)
- Google Chrome atau Microsoft Edge terinstall di Windows target (agar tidak perlu download Chromium).

## Instalasi & Menjalankan (Development)
1. Install dependencies:
   ```bash
   npm install
   ```

2. Jalankan aplikasi (Mode Dev):
   ```bash
   npm start
   ```

3. Aplikasi akan terbuka.
   - Masukkan **Manager URL** (Server Backend yang menerima API)
   - Masukkan **Auth Code** (Kode dari backend untuk pairing device)
   - Masukkan **Device Name**.
   - Klik **Register**.

4. Jika sukses, QR Code WhatsApp akan muncul. Scan dengan HP.

## Cara Build (.exe Installer)
Untuk membuat installer Windows (NSIS):

1. Pastikan folder `assets` ada dan berisi `icon.ico` (optional, tapi disarankan agar icon muncul).
2. Jalankan command:
   ```bash
   npm run dist
   ```
3.  Hasil installer ada di folder `dist/`.
    - File: `WA Server Local Setup 1.0.0.exe`

## Cara Register dengan WA-Manager

### 1. Generate Activation Code di WA-Manager
Login ke wa-manager dan generate activation code (6 digit):
- Via Web UI: Buka `/instances` → klik "Generate Activation Code"
- Via API:
  ```bash
  curl -X POST http://127.0.0.1:8000/instances/generate-activation-code \
    -H "Cookie: laravel_session=YOUR_SESSION" \
    -H "X-CSRF-TOKEN: YOUR_TOKEN"
  ```

### 2. Register WA-Local Engine
1. Buka aplikasi WA Server Local
2. Masukkan:
   - **Manager URL**: `http://127.0.0.1:8000` (atau URL wa-manager Anda)
   - **Auth Code**: Kode 6 digit dari step 1
   - **Device Name**: Nama device (contoh: "Office PC 1")
3. Klik **Register**

### 3. Scan QR Code
Setelah registrasi berhasil, QR code WhatsApp akan muncul. Scan dengan HP Anda.

### 4. Verifikasi
Cek log aplikasi untuk memastikan:
```
✓ Registration successful!
✓ Instance ID: 13 (type: local)
✓ Instance Key: abc123...
✓ Token saved. Starting job polling...
```

## Reset Configuration
Jika Anda perlu register ulang (misalnya karena error 401 Unauthorized), ada 2 cara:

### Cara 1: Dari UI (Recommended)
1. Buka aplikasi
2. Klik tombol **"Logout & Reset"** (tombol merah di dashboard)
3. Konfirmasi dialog
4. Aplikasi akan kembali ke halaman registration
5. Register ulang dengan activation code baru

### Cara 2: Via Script
1. Tutup aplikasi
2. Jalankan:
   ```bash
   node reset-config.js
   ```
3. Restart aplikasi dan register ulang dengan activation code baru

**Catatan**: Logout akan menghapus:
- Konfigurasi device (token, instance_id, dll)
- Session WhatsApp (perlu scan QR lagi)
- Semua data lokal

Setelah logout, aplikasi akan kembali ke halaman registration tanpa perlu restart.

## Struktur Data
- **Config**: Tersimpan di `%APPDATA%\wa-server-local\config.json`.
- **Session WA**: Tersimpan di `%APPDATA%\wa-server-local\.wwebjs_auth\`.
- **Logs**: Tersimpan di `%APPDATA%\wa-server-local\logs\`.

## Konfigurasi Config.json (Contoh)
Lokasi: `%APPDATA%\wa-server-local\config.json`
```json
{
	"manager_url": "http://127.0.0.1:8000",
	"device_token": "13|AbCdEf123456...",
	"instance_id": "13",
	"instance_key": "abc123def456",
	"device_name": "Office-PC-1",
	"registered": true
}
```

## Troubleshoot
- **Error 401 Unauthorized**: Token tidak valid atau menggunakan token dari instance remote. Jalankan `node reset-config.js` dan register ulang dengan activation code baru.
- **QR tidak muncul**: Cek koneksi internet. Cek apakah Chrome/Edge terinstall.
- **Log error "Browser not found"**: Install Chrome atau Edge, atau biarkan script mendownload Chromium (tapi ukuran build akan besar).
- **Message tidak masuk queue**: Pastikan menggunakan `instance_key` yang benar saat kirim message via API.
- **Polling tidak dapat job**: Cek log untuk error 401. Pastikan instance type='local' di database wa-manager.

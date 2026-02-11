# RESTART APLIKASI

Kode sudah diperbaiki dari POST ke PUT, tapi Anda perlu restart aplikasi untuk menerapkan perubahan.

## Cara Restart yang Benar:

### Opsi 1: Jika Running via npm start
1. Tekan `Ctrl+C` di terminal untuk stop aplikasi
2. Tunggu sampai benar-benar berhenti
3. Jalankan lagi: `npm start`

### Opsi 2: Jika Running sebagai .exe
1. Tutup aplikasi sepenuhnya (klik X atau Quit dari tray)
2. Buka Task Manager (Ctrl+Shift+Esc)
3. Pastikan tidak ada proses "WA Server Local" atau "electron" yang masih berjalan
4. Jika ada, End Task
5. Jalankan ulang aplikasi

### Opsi 3: Clear Electron Cache (Jika masih error)
1. Tutup aplikasi
2. Hapus folder cache:
   - `%APPDATA%\wa-server-local\Cache`
   - `%APPDATA%\wa-server-local\Code Cache`
3. Restart aplikasi

## Verifikasi Perubahan Sudah Diterapkan:
Setelah restart, coba register lagi. Jika masih error yang sama, cek log aplikasi. 
Seharusnya sekarang menggunakan PUT method.

## Jika Masih Error:
Kemungkinan endpoint di wa-manager memang berbeda. Coba cek routing di wa-manager:
- File: `routes/web.php` atau `routes/api.php`
- Cari route untuk `instances/register`
- Pastikan method yang digunakan (GET/POST/PUT/DELETE)

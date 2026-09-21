# WA Chat Summary

Aplikasi lokal untuk login ke WhatsApp Web, memilih rentang tanggal, lalu menghitung jumlah nomor pribadi unik yang memiliki minimal satu pesan di dalam rentang tersebut.

Contoh: jika Anda memilih **1 Januari 2025 sampai 31 Januari 2025**, hasilnya adalah jumlah nomor pribadi yang memiliki chat setidaknya sekali pada periode tersebut.

Grup, channel, isi pesan, nama kontak, dan rincian per nomor tidak disimpan atau ditampilkan.

## Menjalankan

1. Pastikan Node.js 20 atau lebih baru terpasang.
2. Install dependensi:

   ```powershell
   npm install
   ```

3. Jalankan aplikasi:

   ```powershell
   npm start
   ```

4. Buka [http://localhost:3000](http://localhost:3000), pindai QR dengan WhatsApp di ponsel, isi tanggal mulai dan tanggal akhir, lalu klik **Mulai hitung**.

Hasil dapat diunduh sebagai CSV atau JSON. Ringkasan tersimpan di `data/chat-summary.json`; sesi login tersimpan di `.wwebjs_auth/`. Keduanya dikecualikan dari Git.

## Catatan

- Batas tanggal bersifat inklusif: pesan pada tanggal mulai dan tanggal akhir ikut dihitung.
- Pesan dibaca sementara oleh WhatsApp Web hanya untuk mengecek timestamp; isi pesan tidak ditulis ke disk dan tidak dikirim ke API aplikasi.
- Pemindaian menghitung chat pribadi yang riwayatnya dapat dimuat oleh WhatsApp Web. Grup, broadcast, channel, dan chat dengan akun sendiri sengaja dikecualikan.
- `limit: Infinity` digunakan secara default agar WhatsApp Web diminta memuat seluruh riwayat yang tersedia. Batasi untuk pengujian dengan `WA_FETCH_LIMIT=100`.
- Aplikasi otomatis memakai Google Chrome atau Microsoft Edge yang terpasang. Jika browser berada di lokasi khusus pada PowerShell, set `$env:CHROME_PATH = 'C:\lokasi\browser.exe'` sebelum menjalankan `npm start`.
- Login WhatsApp Web tetap memakai otomasi pihak ketiga, sehingga risiko pemblokiran tidak dapat dijamin nol.

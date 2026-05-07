// File ini hanya placeholder untuk service worker.
// Konfigurasi Firebase lama sudah dihapus supaya tidak membingungkan.
// Jika nanti push notification dipakai lagi, buat konfigurasi baru dengan aman.
self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Notifikasi', {
      body: data.body || '',
      icon: '/manifest.json'
    })
  );
});

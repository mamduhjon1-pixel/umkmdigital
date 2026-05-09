self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const page = event.notification?.data?.page || "notif";
  const targetUrl = `${self.location.origin}/?page=${encodeURIComponent(page)}`;

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        client.postMessage({ type: "UMKM_OPEN_PAGE", page });
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener("fetch", () => {});

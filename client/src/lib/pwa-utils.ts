/**
 * PWA utility functions for service worker registration and offline handling
 */

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    console.log("Service Workers not supported");
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });

    console.log("Service Worker registered successfully:", registration);

    // Listen for updates
    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "activated") {
          // Notify user about app update
          console.log("Service Worker updated and activated");
          // You can trigger a UI notification here
        }
      });
    });

    return registration;
  } catch (error) {
    console.error("Service Worker registration failed:", error);
    return null;
  }
}

export function isOnline(): boolean {
  return navigator.onLine;
}

export function setupOnlineOfflineListeners(
  onOnline: () => void,
  onOffline: () => void
) {
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}

export async function clearCache() {
  if (!("caches" in window)) {
    console.log("Cache API not supported");
    return;
  }

  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((name) => caches.delete(name)));
  console.log("All caches cleared");
}

export async function getCacheSize(): Promise<number> {
  if (!("caches" in window) || !("estimate" in navigator.storage)) {
    return 0;
  }

  const estimate = await navigator.storage.estimate();
  return estimate.usage || 0;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage && navigator.storage.persist) {
    const persistent = await navigator.storage.persist();
    console.log("Persistent storage:", persistent);
    return persistent;
  }
  return false;
}

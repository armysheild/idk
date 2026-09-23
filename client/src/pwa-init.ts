/**
 * PWA Initialization
 * Runs on app startup to register service worker and set up PWA features
 */

import { registerServiceWorker, requestPersistentStorage } from "./lib/pwa-utils";

export async function initPWA() {
  // Only initialize in production or if explicitly enabled
  if (import.meta.env.MODE === "production") {
    try {
      // Register service worker
      await registerServiceWorker();

      // Request persistent storage
      await requestPersistentStorage();

      console.log("PWA initialized successfully");
    } catch (error) {
      console.error("PWA initialization error:", error);
    }
  }
}

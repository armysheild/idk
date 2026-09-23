import { useEffect, useState } from "react";
import { setupOnlineOfflineListeners } from "@/lib/pwa-utils";

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => {
    // Initialize with current status
    return typeof navigator !== "undefined" ? navigator.onLine : true;
  });

  useEffect(() => {
    const cleanup = setupOnlineOfflineListeners(
      () => setIsOnline(true),
      () => setIsOnline(false)
    );

    return cleanup;
  }, []);

  return isOnline;
}

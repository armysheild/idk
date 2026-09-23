import { Wifi, WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div className="fixed top-4 left-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 shadow-md">
      <WifiOff size={18} className="flex-shrink-0" />
      <div className="flex-1">
        <p className="font-semibold">You're offline</p>
        <p className="text-xs">Some features may be limited. Changes will sync when back online.</p>
      </div>
    </div>
  );
}

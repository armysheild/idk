import { X, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { Button } from "./ui/button";

export function PWAInstallPrompt() {
  const { isInstallable, isIOS, installApp } = usePWAInstall();
  const [isVisible, setIsVisible] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if app is already running as PWA
    const isStandalonePWA = window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(isStandalonePWA);

    if (isInstallable && !isStandalonePWA) {
      setIsVisible(true);
    }
  }, [isInstallable]);

  if (!isVisible || isStandalone) {
    return null;
  }

  const handleInstall = async () => {
    await installApp();
    setIsVisible(false);
  };

  const handleDismiss = () => {
    setIsVisible(false);
  };

  if (isIOS) {
    return (
      <div className="fixed bottom-4 right-4 max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-lg">
        <div className="flex gap-3">
          <div className="flex-1">
            <p className="font-semibold text-amber-900">Install VahanSync</p>
            <p className="text-sm text-amber-800">
              Tap <span className="font-mono font-bold">Share</span> then <span className="font-mono font-bold">Add to Home Screen</span>
            </p>
          </div>
          <button onClick={handleDismiss} className="text-amber-600 hover:text-amber-800">
            <X size={20} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 max-w-sm rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-lg">
      <div className="flex gap-3">
        <div className="flex-1">
          <p className="font-semibold text-blue-900">Install VahanSync App</p>
          <p className="text-sm text-blue-800">Access your fleet operations offline</p>
        </div>
        <button onClick={handleDismiss} className="text-blue-600 hover:text-blue-800">
          <X size={20} />
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={handleInstall} size="sm" className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700">
          <Download size={16} /> Install
        </Button>
        <Button onClick={handleDismiss} variant="outline" size="sm" className="flex-1">
          Later
        </Button>
      </div>
    </div>
  );
}

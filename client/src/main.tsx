import { createRoot } from "react-dom/client";
import App from "./App";
import { initPWA } from "./pwa-init";
import "./index.css";
import "./redesign.css";
import "./frontend-replacement.css";
import "./accountant-replacement.css";
import "./driver-replacement.css";
import "./mechanic-replacement.css";
import "./team-replacement.css";
import "./notification-replacement.css";
import "./executive-replacement.css";
import "./fallback-replacement.css";
import "./procurement-replacement.css";
import "./billing-replacement.css";
import "./compliance-replacement.css";
import "./fleet-manager-overview-replacement.css";
import "./public-replacement.css";
import "./public-auth-replacement.css";
import "./profile-replacement.css";

createRoot(document.getElementById("root")!).render(<App />);

// Initialize PWA features
initPWA().catch(console.error);

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** Redirect unauthenticated users to the FleetOps Supabase sign-in route. */
export const startLogin = () => {
  if (typeof window !== "undefined") {
    window.location.assign("/login");
  }
};

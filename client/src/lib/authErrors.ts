export function describeAuthError(error: unknown, action: "sign-in" | "sign-up" | "password recovery" | "password update" = "sign-in") {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (/invalid login credentials|invalid email or password|invalid credentials/.test(normalized)) {
    return "Email or password is incorrect. Check your credentials and try again.";
  }
  if (/email not confirmed|email_not_confirmed/.test(normalized)) {
    return "Confirm your email address before signing in, then try again.";
  }
  if (/rate limit|too many requests|over_email_send_rate_limit/.test(normalized)) {
    return "Too many authentication attempts. Wait a moment and try again.";
  }
  if (/user already registered|already registered|already exists|user exists/.test(normalized)) {
    return "This email already has a FleetOps account. Choose Sign In or use the invitation join flow.";
  }
  if (/network|fetch failed|failed to fetch|timeout/.test(normalized)) {
    return "FleetOps could not reach Supabase Auth. Check your connection and try again.";
  }
  if (action === "password recovery") return message || "FleetOps could not request a recovery link. Please try again.";
  if (action === "password update") return message || "FleetOps could not update your password. Please try again.";
  return action === "sign-in"
    ? "FleetOps could not sign you in. Check your credentials and try again."
    : message || "FleetOps could not create the account. Please try again.";
}

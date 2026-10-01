export function onboardingCompletionKey(userId: string) {
  return `vahana:onboarding-complete:${userId}`;
}

export function hasCompletedOnboarding(userId: string) {
  return Boolean(userId) && window.localStorage.getItem(onboardingCompletionKey(userId)) === "1";
}

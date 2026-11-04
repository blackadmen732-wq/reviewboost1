/**
 * What the owner app says while it recovers. Short (no line over twelve
 * words), says what is happening and what happens next, and never asks the
 * owner to go and check something the app can check itself. The customer
 * page has its own words, in three languages, in `customer-messages.ts`.
 */
export const recoveryWords = {
  // Something failed to load, and tries again by itself.
  didNotLoad: "That didn’t load",
  retryingIn: (seconds: number) => `Trying again in ${seconds} s.`,
  retryingSoon: "Trying again in a few seconds.",
  retrying: "Trying again…",
  tryNow: "Try now",
  offlineTitle: "You’re offline",
  offlineBody: "This loads again when you’re back online.",
  offlineTry: "You’re offline. We’ll try again when you’re back.",
  stoppedTitle: "Still not loading",
  stoppedBody: "Wait a minute, then try again.",
  tryAgain: "Try again",

  // A change's answer was lost, and the app finds out what happened.
  checking: "Checking whether that went through…",
  noAnswerIn: (seconds: number) => `No answer yet. Checking again in ${seconds} s.`,
  noAnswerSoon: "No answer yet. Checking again shortly.",
  checkingAgain: "Checking again…",
  offlineCheck: "You’re offline. We’ll check if it saved when you’re back.",
  stillNoAnswer: "Still no answer. Wait a minute, then check again.",
  checkNow: "Check now",
  checkAgain: "Check again",

  // A button that is taking a while.
  stillWorking: "Still working…",

  // The auth service did not answer: fail closed, but say so.
  unansweredTitle: "ReviewBoost isn’t answering",
  unansweredBody: "We couldn’t check your sign-in.",

  // The connection.
  offlineBanner: "You’re offline. Nothing saves until you’re back.",
  backOnline: "Back online.",
} as const;

import { router } from "expo-router";
import * as Linking from "expo-linking";

/**
 * Where a website link from the Home model goes in the app. Feedback and Tags
 * are tabs here; a single Tag is its own screen. Business details, the Google
 * link and the customer page are edited on the website, so those open it in
 * the browser. Billing is never a destination: the Home endpoint already
 * removes every link to it (App Store 3.1.3(f)), and this refuses one anyway.
 */
const SITE = (process.env.EXPO_PUBLIC_API_URL || "https://reviewboost.fit").replace(/\/+$/, "");

export type Destination =
  | { kind: "tab"; path: "/(tabs)/home" | "/(tabs)/feedback" | "/(tabs)/stands" | "/(tabs)/text-requests" }
  | { kind: "screen"; path: string }
  | { kind: "web"; url: string }
  | { kind: "none" };

export function destinationFor(href: string): Destination {
  const path = href.split(/[?#]/)[0] ?? "";
  if (path.startsWith("/settings/billing")) return { kind: "none" };
  if (path === "/home") return { kind: "tab", path: "/(tabs)/home" };
  if (path === "/feedback" || path === "/feedback/insights") return { kind: "tab", path: "/(tabs)/feedback" };
  if (path === "/text-requests") return { kind: "tab", path: "/(tabs)/text-requests" };
  if (path === "/stands") return { kind: "tab", path: "/(tabs)/stands" };
  const tag = /^\/stands\/([0-9a-f-]{36})$/i.exec(path);
  if (tag) return { kind: "screen", path: `/stand/${tag[1]}` };
  const feedback = /^\/feedback\/([0-9a-f-]{36})$/i.exec(path);
  if (feedback) return { kind: "screen", path: `/feedback/${feedback[1]}` };
  if (path === "/settings" || path === "/onboarding" || path === "/customer-page") {
    return { kind: "web", url: `${SITE}${path}` };
  }
  return { kind: "none" };
}

/** Whether a link leaves the app, so its button can say "Opens in your browser". */
export function opensBrowser(href: string): boolean {
  return destinationFor(href).kind === "web";
}

export function go(href: string): void {
  const destination = destinationFor(href);
  if (destination.kind === "tab") router.navigate(destination.path);
  else if (destination.kind === "screen") router.push(destination.path as never);
  else if (destination.kind === "web") void Linking.openURL(destination.url);
}

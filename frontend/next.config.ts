import type { NextConfig } from "next";

if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PUBLIC_USE_CUSTOMER_FIXTURES === "true"
) {
  throw new Error("Customer fixtures must never be enabled in a production build.");
}

/**
 * Headers for every page. API routes are left out: `lib/server/http.ts` gives
 * each of them a stricter set of its own.
 *
 * `frame-ancestors 'none'` is the one that matters. Without it any site can
 * load the owner's Settings or Delete account page in an invisible frame and
 * line a click up with a button. Nothing in ReviewBoost frames its own pages:
 * the owner's preview renders the customer page as components, not an iframe.
 *
 * This is not a script policy. One that allows Next's inline bootstrap and
 * Google's Picker is a separate change with its own browser testing.
 */
const PAGE_SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // A customer leaving for Google sends the origin, never the Tag's /q/ path.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
] as const;

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    useTypeScriptCli: false,
  },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/((?!api/).*)", headers: [...PAGE_SECURITY_HEADERS] }];
  },
};

export default nextConfig;

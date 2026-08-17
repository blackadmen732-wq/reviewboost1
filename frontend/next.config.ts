import type { NextConfig } from "next";

if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PUBLIC_USE_CUSTOMER_FIXTURES === "true"
) {
  throw new Error("Customer fixtures must never be enabled in a production build.");
}

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    useTypeScriptCli: false,
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;

import type { MetadataRoute } from "next";

/**
 * PWA manifest.
 *
 * Here because an owner adding this to their home screen is a realistic thing —
 * it is checked daily on a phone — and without a manifest that shortcut gets a
 * screenshot of the page as its icon.
 *
 * `maskable` matters: Android crops icons to whatever shape the launcher uses,
 * and an un-maskable icon gets its corners cut off. Every icon here is the one
 * full-square app-icon artwork from `scripts/brand/generate-brand-assets.mjs`,
 * with the mark inside the 40% safe circle, so the maskable entry is the same
 * picture declared for that purpose.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ReviewBoost",
    short_name: "ReviewBoost",
    description: "Collect honest reviews for your local business.",
    start_url: "/home",
    display: "standalone",
    background_color: "#FCFCFB",
    theme_color: "#00A86B",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

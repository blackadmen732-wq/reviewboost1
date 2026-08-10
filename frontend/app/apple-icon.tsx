import { ImageResponse } from "next/og";

/**
 * The iOS home-screen icon.
 *
 * 180px, no rounding of our own — iOS applies its own mask, and a pre-rounded
 * icon ends up with a visible double corner. Generous padding so the letter
 * survives that mask on every device shape.
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#00A86B",
          color: "#0D2118",
          fontSize: 120,
          fontWeight: 700,
          letterSpacing: "-0.04em",
        }}
      >
        B
      </div>
    ),
    size,
  );
}

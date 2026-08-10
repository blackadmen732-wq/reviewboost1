import { ImageResponse } from "next/og";

/**
 * The favicon, generated rather than shipped as a binary.
 *
 * A checked-in .ico drifts from the brand the moment a colour changes, and
 * nobody remembers to re-export it. This reads the same green the stylesheet
 * does, so the tab icon cannot fall out of sync with the app.
 *
 * A "B" rather than the wordmark: at 32px "ReviewBoost" is an unreadable
 * smudge. The letter is the one carrying the weight and the colour in the
 * wordmark, so the two stay recognisably related.
 */

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          // Dark ink, never white — white on this green is 3.08:1.
          color: "#0D2118",
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          borderRadius: 7,
        }}
      >
        B
      </div>
    ),
    size,
  );
}

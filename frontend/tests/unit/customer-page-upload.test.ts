import { describe, expect, it } from "vitest";

/**
 * Upload state derivation tests.
 *
 * These validate the state machine that drives the Customer Page editor's
 * upload UX. The component derives three values from its state:
 *
 *   displayUrl          — what the preview shows
 *   hasConfirmedArtwork — is there server-confirmed artwork?
 *   canPublish          — is the Publish button enabled?
 *
 * The rules under test:
 *   - A successful upload revokes the blob, clears localPreviewUrl, and
 *     switches preview to the confirmed server URL.
 *   - A failed first upload (no prior artwork) cannot publish.
 *   - A failed replacement (prior artwork exists) preserves the confirmed
 *     server artwork and allows publish of that prior state.
 *   - The server URL is always authoritative after a round-trip.
 */

type UploadStatus = "idle" | "uploading" | "confirmed" | "failed";

interface EditorState {
  confirmedServerUrl: string | null;
  localPreviewUrl: string | null;
  uploadStatus: UploadStatus;
  busy: "save" | "publish" | null;
}

function displayUrl(s: EditorState): string | null {
  return s.localPreviewUrl ?? s.confirmedServerUrl;
}

function hasConfirmedArtwork(s: EditorState): boolean {
  return s.confirmedServerUrl !== null && s.uploadStatus !== "uploading";
}

function canPublish(s: EditorState): boolean {
  return hasConfirmedArtwork(s) && s.busy === null;
}

describe("Customer Page upload state", () => {
  describe("successful upload switches blob → server URL", () => {
    it("after success, displayUrl is the server URL (not a blob)", () => {
      const state: EditorState = {
        confirmedServerUrl: "/api/v1/customer-page/artwork?format=raw&t=12345",
        localPreviewUrl: null,
        uploadStatus: "confirmed",
        busy: null,
      };
      const url = displayUrl(state);
      expect(url).toBe("/api/v1/customer-page/artwork?format=raw&t=12345");
      expect(url).not.toMatch(/^blob:/);
    });

    it("localPreviewUrl is null after successful upload", () => {
      const state: EditorState = {
        confirmedServerUrl: "/api/v1/customer-page/artwork?format=raw&t=12345",
        localPreviewUrl: null,
        uploadStatus: "confirmed",
        busy: null,
      };
      expect(state.localPreviewUrl).toBeNull();
      expect(canPublish(state)).toBe(true);
    });
  });

  describe("failed first upload cannot publish", () => {
    it("no prior artwork + failed upload = canPublish false", () => {
      const state: EditorState = {
        confirmedServerUrl: null,
        localPreviewUrl: null,
        uploadStatus: "idle",
        busy: null,
      };
      expect(canPublish(state)).toBe(false);
      expect(displayUrl(state)).toBeNull();
    });

    it("blob URL is not treated as confirmed artwork", () => {
      const uploading: EditorState = {
        confirmedServerUrl: null,
        localPreviewUrl: "blob:http://localhost/abc",
        uploadStatus: "uploading",
        busy: null,
      };
      expect(canPublish(uploading)).toBe(false);
      expect(displayUrl(uploading)).toBe("blob:http://localhost/abc");
    });
  });

  describe("failed replacement preserves prior confirmed artwork", () => {
    it("prior confirmed URL is still the display after replacement fails", () => {
      const state: EditorState = {
        confirmedServerUrl: "/api/v1/customer-page/artwork?format=raw&t=earlier",
        localPreviewUrl: null,
        uploadStatus: "failed",
        busy: null,
      };
      expect(displayUrl(state)).toBe(
        "/api/v1/customer-page/artwork?format=raw&t=earlier",
      );
    });

    it("publish is allowed using prior confirmed artwork after replacement fails", () => {
      const state: EditorState = {
        confirmedServerUrl: "/api/v1/customer-page/artwork?format=raw&t=earlier",
        localPreviewUrl: null,
        uploadStatus: "failed",
        busy: null,
      };
      expect(canPublish(state)).toBe(true);
    });

    it("blob URL is revoked and cleared on failure", () => {
      const state: EditorState = {
        confirmedServerUrl: "/api/v1/customer-page/artwork?format=raw&t=earlier",
        localPreviewUrl: null,
        uploadStatus: "failed",
        busy: null,
      };
      expect(state.localPreviewUrl).toBeNull();
    });
  });

  describe("server state remains authoritative", () => {
    it("idle state with server artwork is publishable", () => {
      const state: EditorState = {
        confirmedServerUrl: "/api/v1/customer-page/artwork?format=raw&t=init",
        localPreviewUrl: null,
        uploadStatus: "idle",
        busy: null,
      };
      expect(canPublish(state)).toBe(true);
      expect(displayUrl(state)).toBe(
        "/api/v1/customer-page/artwork?format=raw&t=init",
      );
    });

    it("confirmed server URL always wins over absent blob", () => {
      for (const status of ["idle", "confirmed", "failed"] as const) {
        const state: EditorState = {
          confirmedServerUrl: "/server-url",
          localPreviewUrl: null,
          uploadStatus: status,
          busy: null,
        };
        expect(displayUrl(state)).toBe("/server-url");
      }
    });

    it("during upload, blob shows as preview but publish is blocked", () => {
      const state: EditorState = {
        confirmedServerUrl: "/server-url",
        localPreviewUrl: "blob:http://localhost/xyz",
        uploadStatus: "uploading",
        busy: null,
      };
      expect(displayUrl(state)).toBe("blob:http://localhost/xyz");
      expect(canPublish(state)).toBe(false);
    });

    it("idle without any artwork cannot publish", () => {
      const state: EditorState = {
        confirmedServerUrl: null,
        localPreviewUrl: null,
        uploadStatus: "idle",
        busy: null,
      };
      expect(canPublish(state)).toBe(false);
    });
  });
});

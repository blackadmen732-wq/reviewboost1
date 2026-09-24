/**
 * The status line above the sheet's stage.
 *
 * The dark "wallet card" panel this used to be is gone — the sheet's whole
 * background now carries the moment, and the real mark lives in `NfcHeader`
 * above it. This is just the plain-text status the owner glances at, kept
 * separate from the big centered glyph below so the glyph can be the one
 * thing that changes between scenes.
 */
export function NfcCard({ working, status }: { working: boolean; status: string }) {
  return (
    <div className="nfc-status" data-working={working ? "true" : "false"}>
      <span className="nfc-status__dot" aria-hidden="true" />
      <span className="nfc-status__label">{status}</span>
    </div>
  );
}

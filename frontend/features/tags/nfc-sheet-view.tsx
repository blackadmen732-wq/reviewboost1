import * as Dialog from "@radix-ui/react-dialog";
import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { Button } from "@/components/ui/button";
import { NfcFigure } from "@/features/tags/nfc-visuals";
import type { NfcScene, SceneCopy } from "@/lib/owner/nfc-presentation";

/**
 * How the programming sheet looks, given a scene and its words.
 *
 * Separate from the machine in `program-tag-sheet.tsx` so the one can change
 * without touching the other: this file decides nothing about when a Tag is
 * read or written, and that one draws nothing.
 *
 * Composition, top to bottom: the logo, one large figure, a title and at most
 * one supporting sentence, then the actions pinned near the thumb. The success
 * scene has no controls at all — it is finished, and it leaves on its own.
 */
export function NfcSheetView({
  scene,
  phase,
  copy,
  onPrimary,
  onDismiss,
}: {
  scene: NfcScene;
  /** The machine phase underneath, exposed for tests and nothing else. */
  phase: string;
  copy: SceneCopy;
  onPrimary: () => void;
  onDismiss: () => void;
}) {
  const controls = scene !== "success";

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Content className="nfc-sheet">
          <div
            className="nfc-sheet__panel"
            data-nfc-phase={phase}
            data-nfc-scene={scene}
          >
            <div className="nfc-sheet__brand">
              <ReviewBoostLogo />
            </div>

            <div className="nfc-sheet__stage">
              <NfcFigure scene={scene} />

              <div className="nfc-sheet__words" aria-live="polite">
                <Dialog.Title asChild>
                  <p className="nfc-sheet__title">{copy.title}</p>
                </Dialog.Title>
                <Dialog.Description asChild>
                  <p className={copy.body ? "nfc-sheet__body" : "sr-only"}>
                    {copy.body ?? "NFC setup for your ReviewBoost Tag."}
                  </p>
                </Dialog.Description>
              </div>
            </div>

            <div className="nfc-sheet__actions">
              {controls && copy.action ? (
                <Button
                  variant="action"
                  size="lg"
                  className="nfc-sheet__button"
                  onClick={onPrimary}
                >
                  {copy.action}
                </Button>
              ) : null}
              {controls && copy.dismiss ? (
                <Button
                  variant="secondary"
                  size="lg"
                  className="nfc-sheet__button"
                  onClick={onDismiss}
                >
                  {copy.dismiss}
                </Button>
              ) : null}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

"use client";

import { Check, Copy, Download, ExternalLink, Printer, RefreshCw, Smartphone, Wifi } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import { useAuthenticatedQr } from "@/lib/hooks/use-authenticated-qr";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { WebNfcWriter } from "@/features/dashboard/web-nfc-writer";

interface StandCardProps {
  standId: string;
  label: string;
  standType: string;
  status: string;
  tokenPrefix: string;
  tokenRotatedAt: string | null;
  nfcProvisionedAt: string | null;
}

const PNG_SIZES = [
  { label: "Small (300px)", value: 300 },
  { label: "Medium (512px)", value: 512 },
  { label: "Large (1024px)", value: 1024 },
  { label: "Print (2048px)", value: 2048 },
] as const;

const MIN_CUSTOM_PNG = 150;
const MAX_CUSTOM_PNG = 4096;

export function StandCard({
  standId,
  label,
  standType,
  status,
  tokenPrefix,
  tokenRotatedAt,
  nfcProvisionedAt,
}: StandCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pngSize, setPngSize] = useState(512);
  const [customPngSize, setCustomPngSize] = useState("");
  const [useCustomSize, setUseCustomSize] = useState(false);
  const [downloadingPng, setDownloadingPng] = useState(false);
  const [copied, setCopied] = useState(false);
  const qr = useAuthenticatedQr(standId);

  const [rotatedLocally, setRotatedLocally] = useState(false);
  const hasNfc = nfcProvisionedAt !== null;
  const tokenWasRotatedAfterNfc =
    rotatedLocally ||
    (hasNfc && tokenRotatedAt !== null && new Date(tokenRotatedAt) > new Date(nfcProvisionedAt!));

  async function rotate() {
    setBusy(true);

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      setBusy(false);
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    const response = await fetch(`/api/v1/review-stands/${standId}/rotate-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    setBusy(false);
    setConfirming(false);

    if (!response.ok) {
      notify.error("Could not make a new code", "Please try again.");
      return;
    }

    qr.reload();
    if (hasNfc) setRotatedLocally(true);
    notify.success("New code ready", "Print it and replace the old one.");
  }

  function getEffectivePngSize(): number | null {
    if (!useCustomSize) return pngSize;
    const parsed = Number(customPngSize);
    if (!Number.isFinite(parsed) || parsed < MIN_CUSTOM_PNG || parsed > MAX_CUSTOM_PNG) return null;
    return Math.round(parsed);
  }

  async function downloadPng() {
    const size = getEffectivePngSize();
    if (!size) {
      notify.error("Invalid size", `Enter a number between ${MIN_CUSTOM_PNG} and ${MAX_CUSTOM_PNG}.`);
      return;
    }

    setDownloadingPng(true);

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      setDownloadingPng(false);
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    try {
      const res = await fetch(
        `/api/v1/review-stands/${standId}/qr?format=png&size=${size}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
          credentials: "omit",
        },
      );
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          notify.error("Please sign in again", "Your session expired.");
          setDownloadingPng(false);
          return;
        }
        throw new Error("download_failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reviewboost-${tokenPrefix}-${size}px.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      notify.error("Could not download the code", "Please try again.");
    } finally {
      setDownloadingPng(false);
    }
  }

  async function copyStandUrl() {
    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    try {
      const res = await fetch(`/api/v1/review-stands/${standId}/qr?format=json`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        credentials: "omit",
      });
      if (!res.ok) throw new Error("fetch_failed");
      const json = await res.json();
      const url = json.data?.standUrl;
      if (!url) throw new Error("no_url");
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      notify.success("Link copied", "Paste it into NFC Tools or share it directly.");
    } catch {
      notify.error("Could not copy the link", "Please try again.");
    }
  }

  async function testStand() {
    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    try {
      const res = await fetch(`/api/v1/review-stands/${standId}/qr?format=json`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        credentials: "omit",
      });
      if (!res.ok) throw new Error("fetch_failed");
      const json = await res.json();
      const url = json.data?.standUrl;
      if (!url) throw new Error("no_url");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      notify.error("Could not open stand page", "Please try again.");
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-ink">{label}</p>
          <p className="text-sm text-muted">
            Code {tokenPrefix}… · {status === "active" ? "Working" : status}
            {standType === "physical_nfc" && " · NFC"}
          </p>
        </div>
      </div>

      {/* NFC provisioning status */}
      {hasNfc && (
        <div className={`mb-4 flex items-start gap-2 rounded-[var(--radius-control)] p-3 text-sm ${
          tokenWasRotatedAfterNfc
            ? "border border-[color:var(--rb-danger-border)] bg-[color:var(--rb-danger-bg)] text-danger"
            : "bg-[color:var(--rb-success-bg)] text-[color:var(--rb-success)]"
        }`}>
          <Wifi className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            {tokenWasRotatedAfterNfc ? (
              <p>
                <strong>NFC tag needs rewriting.</strong> The code was changed after this tag was
                written. The physical tag still links to the old code.
              </p>
            ) : (
              <p>
                NFC tag written ·{" "}
                {new Date(nfcProvisionedAt!).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mb-5 rounded-[var(--radius-control)] bg-white p-4">
        {qr.status === "error" || qr.status === "expired" ? (
          <div className="mx-auto flex aspect-square w-full max-w-[240px] items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-muted">
                {qr.status === "expired" ? "Please sign in again" : "Could not load QR code"}
              </p>
              <button
                type="button"
                onClick={qr.reload}
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-text"
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Try again
              </button>
            </div>
          </div>
        ) : qr.objectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr.objectUrl}
            alt={`QR code for ${label}`}
            className="mx-auto aspect-square w-full max-w-[240px]"
          />
        ) : (
          <div className="mx-auto flex aspect-square w-full max-w-[240px] items-center justify-center">
            <div className="size-8 animate-spin rounded-full border-4 border-border border-t-brand-text" />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Button onClick={() => window.print()}>
          <Printer className="size-5" aria-hidden="true" />
          Print this code
        </Button>

        <Button
          variant="secondary"
          onClick={() => qr.download(`reviewboost-${tokenPrefix}.svg`)}
          loading={qr.downloading}
        >
          <Download className="size-5" aria-hidden="true" />
          Save SVG — best for printing
        </Button>

        {/* PNG download with size picker. Wraps on narrow phones instead of
            pushing Save PNG past the card edge. */}
        <div className="flex flex-wrap items-center gap-2">
          {useCustomSize ? (
            <div className="flex min-w-[12rem] flex-1 items-center gap-2">
              <input
                type="number"
                min={MIN_CUSTOM_PNG}
                max={MAX_CUSTOM_PNG}
                value={customPngSize}
                onChange={(e) => setCustomPngSize(e.target.value)}
                placeholder={`${MIN_CUSTOM_PNG}–${MAX_CUSTOM_PNG}`}
                className="h-11 w-28 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-ink"
                aria-label="Custom PNG size in pixels"
              />
              <span className="text-sm text-muted">px</span>
              <button
                type="button"
                onClick={() => setUseCustomSize(false)}
                className="text-sm text-brand-text hover:underline"
              >
                Presets
              </button>
            </div>
          ) : (
            <div className="flex min-w-[12rem] flex-1 items-center gap-2">
              <select
                value={pngSize}
                onChange={(e) => setPngSize(Number(e.target.value))}
                className="h-11 min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-ink"
                aria-label="PNG size"
              >
                {PNG_SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setUseCustomSize(true)}
                className="text-sm text-brand-text hover:underline"
              >
                Custom
              </button>
            </div>
          )}
          <Button
            variant="secondary"
            onClick={() => void downloadPng()}
            loading={downloadingPng}
            className="w-auto flex-shrink-0"
          >
            <Download className="size-5" aria-hidden="true" />
            Save PNG
          </Button>
        </div>

        {/* Copy NFC Link */}
        <Button
          variant="secondary"
          onClick={() => void copyStandUrl()}
        >
          {copied ? (
            <Check className="size-5" aria-hidden="true" />
          ) : (
            <Copy className="size-5" aria-hidden="true" />
          )}
          {copied ? "Link copied" : "Copy NFC link"}
        </Button>

        {/* Test Stand */}
        <Button
          variant="secondary"
          onClick={() => void testStand()}
        >
          <ExternalLink className="size-5" aria-hidden="true" />
          Test Stand
        </Button>
      </div>

      {/* NFC write instructions */}
      <div className="mt-5 border-t border-border pt-5">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted hover:text-ink">
            <Smartphone className="size-4" aria-hidden="true" />
            Write to NFC tag
            <span className="ml-auto text-xs text-muted group-open:rotate-90 transition-transform">&#9654;</span>
          </summary>
          <div className="mt-3 space-y-3 text-sm text-muted">
            <p>
              Use Android Chrome or the NFC Tools app on any phone to write
              this stand&apos;s URL to an NFC tag. The tag will contain the same link as
              the QR code.
            </p>
            <WebNfcWriter standId={standId} />
            <div className="rounded-[var(--radius-control)] border border-border p-3">
              <p className="mb-2 font-medium text-ink">Recommended NFC tags</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>NTAG213 — works with all phones</li>
                <li>NTAG215 — more storage, widely compatible</li>
              </ul>
            </div>
            <div className="rounded-[var(--radius-control)] border border-border p-3">
              <p className="mb-2 font-medium text-ink">Using NFC Tools (any phone)</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Install <strong>NFC Tools</strong> from App Store or Play Store</li>
                <li>Open the app and tap <strong>Write</strong></li>
                <li>Tap <strong>Add a record</strong> → <strong>URL / URI</strong></li>
                <li>Use the <strong>Copy NFC link</strong> button above and paste it</li>
                <li>Tap <strong>Write</strong> and hold your phone to the tag</li>
                <li>Verify: tap the tag with your phone to confirm it opens the correct page</li>
              </ol>
            </div>
            <p className="text-xs">
              Do not permanently write-lock tags. If the code is rotated, the tag
              must be rewritten.
            </p>
          </div>
        </details>
      </div>

      <div className="mt-4 border-t border-border pt-5">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm font-medium text-muted transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Make a new code
        </button>
        {hasNfc && (
          <p className="mt-1 pl-2 text-xs text-muted">
            This will also invalidate the NFC tag. You will need to rewrite it.
          </p>
        )}
      </div>

      <AlertDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Your printed code will stop working"
        description={
          hasNfc
            ? "Anyone who scans the old QR code or taps the NFC tag will see nothing. You will have to print the new code and rewrite the NFC tag."
            : "Anyone who scans the old one will see nothing. You will have to print the new code and replace it on every table."
        }
        confirmLabel="Yes, make a new code"
        cancelLabel="Keep my code"
        loading={busy}
        onConfirm={() => void rotate()}
      />
    </div>
  );
}

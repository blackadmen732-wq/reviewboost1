"use client";

import { AlertCircle, Send } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabaseBrowser } from "@/lib/supabase/browser";

const DEFAULT_TEMPLATE = "How was your visit? Tap here to leave a review: {{link}}";

interface ComposeProps {
  stands: { standId: string; label: string; token: string }[];
  segmentsRemaining: number;
  onSent: () => void;
}

export function TextRequestCompose({ stands, segmentsRemaining, onSent }: ComposeProps) {
  const [phone, setPhone] = useState("");
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [selectedStand, setSelectedStand] = useState(stands[0]?.standId ?? "");
  const [preview, setPreview] = useState<{ segments: number; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const stand = stands.find((s) => s.standId === selectedStand);

  const fetchPreview = useCallback(async () => {
    if (!stand || !phone.trim()) return;
    setError(null);

    const { data: { session } } = await supabaseBrowser().auth.getSession();
    if (!session) { setError("Session expired. Please sign in again."); return; }

    const res = await fetch("/api/v1/text-requests/preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        phone: phone.trim(),
        standToken: stand.token,
        messageTemplate: template,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError((body as { error?: { message?: string } } | null)?.error?.message ?? "Could not preview message.");
      return;
    }

    const body = (await res.json()) as { data: { segments: number; renderedBody: string } };
    setPreview({ segments: body.data.segments, body: body.data.renderedBody });
  }, [phone, stand, template]);

  async function handleSend() {
    if (!stand || !phone.trim()) return;
    setBusy(true);
    setError(null);

    const { data: { session } } = await supabaseBrowser().auth.getSession();
    if (!session) { setError("Session expired."); setBusy(false); return; }

    const res = await fetch("/api/v1/text-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        phone: phone.trim(),
        standToken: stand.token,
        messageTemplate: template,
        consent: { source: "owner_import" },
      }),
    });

    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError((body as { error?: { message?: string } } | null)?.error?.message ?? "Could not send text request.");
      return;
    }

    setSent(true);
    setPhone("");
    setPreview(null);
    onSent();
    setTimeout(() => setSent(false), 3000);
  }

  if (stands.length === 0) {
    return (
      <InlineNotice kind="info">
        Create a Tag first. Text Requests need a Tag link to include in the message.
      </InlineNotice>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <h2 className="mb-4 text-base font-semibold text-ink">Send a review request</h2>

        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="tr-phone" className="mb-1 block text-sm font-medium text-ink">
              Recipient phone
            </label>
            <Input
              id="tr-phone"
              type="tel"
              value={phone}
              placeholder="+1 555 123 4567"
              onChange={(e) => { setPhone(e.target.value); setPreview(null); }}
            />
          </div>

          {stands.length > 1 ? (
            <div>
              <label htmlFor="tr-stand" className="mb-1 block text-sm font-medium text-ink">
                Tag
              </label>
              <select
                id="tr-stand"
                value={selectedStand}
                onChange={(e) => setSelectedStand(e.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-base text-ink"
              >
                {stands.map((s) => (
                  <option key={s.standId} value={s.standId}>{s.label}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label htmlFor="tr-template" className="mb-1 block text-sm font-medium text-ink">
              Message
            </label>
            <Textarea
              id="tr-template"
              value={template}
              onChange={(e) => { setTemplate(e.target.value); setPreview(null); }}
              rows={3}
              className="text-sm"
            />
            <p className="mt-1 text-xs text-muted">
              {"{{link}}"} is replaced with your Tag link.
            </p>
          </div>

          {preview ? (
            <div className="rounded-[var(--radius-card)] bg-quiet p-4">
              <p className="mb-1 text-xs font-medium text-muted">
                Preview ({preview.segments} {preview.segments === 1 ? "segment" : "segments"})
              </p>
              <p className="whitespace-pre-wrap text-sm text-ink">{preview.body}</p>
            </div>
          ) : (
            phone.trim() ? (
              <Button variant="ghost" size="sm" onClick={() => void fetchPreview()}>
                Preview message
              </Button>
            ) : null
          )}

          {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}

          {sent ? (
            <InlineNotice kind="success">Text request sent.</InlineNotice>
          ) : null}

          {segmentsRemaining <= 0 ? (
            <InlineNotice kind="warning">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                No text segments remaining. Upgrade your plan for more.
              </div>
            </InlineNotice>
          ) : null}

          <Button
            variant="primary"
            loading={busy}
            loadingLabel="Sending…"
            disabled={!phone.trim() || !stand || segmentsRemaining <= 0}
            onClick={() => void handleSend()}
          >
            <Send className="size-4" aria-hidden="true" />
            Send text request
          </Button>
        </div>
      </div>
    </div>
  );
}

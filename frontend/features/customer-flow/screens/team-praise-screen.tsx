"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { FormEvent } from "react";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SubmissionStatus } from "@/features/customer-flow/customer-flow-state";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";

interface TeamPraiseScreenProps {
  businessName: string;
  messages: CustomerMessages;
  firstName: string;
  note: string;
  status: SubmissionStatus;
  onDraftChange: (firstName: string, note: string) => void;
  onSubmit: (firstName: string, note: string) => void;
  onSkip: () => void;
}

interface PraiseFormValues {
  firstName: string;
  note: string;
}

export function TeamPraiseScreen({
  businessName,
  messages,
  firstName,
  note,
  status,
  onDraftChange,
  onSubmit,
  onSkip,
}: TeamPraiseScreenProps) {
  const schema = useMemo(
    () =>
      z.object({
        firstName: z.string().trim().min(1, messages.requiredFirstName).max(80),
        note: z.string().max(2000),
      }),
    [messages],
  );

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<PraiseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { firstName, note },
  });

  const firstNameField = register("firstName");
  const noteField = register("note");
  const isSubmitting = status === "submitting";
  const hasError = status === "error";
  const isOffline = status === "offline";

  function preventNativeSubmit(event: FormEvent<HTMLFormElement>) {
    if (isSubmitting || isOffline) event.preventDefault();
  }

  return (
    <section className="flow-screen" data-flow-screen="team-praise">
      <div className="screen-heading-group">
        <h1 className="customer-question" data-screen-heading tabIndex={-1}>
          {messages.praiseHeading}
        </h1>
        <p className="customer-support">{messages.praiseSupport(businessName)}</p>
      </div>

      <form
        className="customer-form praise-form"
        onSubmit={(event) => {
          preventNativeSubmit(event);
          if (!isSubmitting && !isOffline) {
            void handleSubmit((values) => onSubmit(values.firstName.trim(), values.note.trim()))(
              event,
            );
          }
        }}
      >
        <div className="field-group">
          <label className="field-label" htmlFor="staff-first-name">
            {messages.firstNameLabel}
          </label>
          <Input
            {...firstNameField}
            id="staff-first-name"
            autoComplete="off"
            maxLength={80}
            disabled={isSubmitting}
            invalid={Boolean(errors.firstName)}
            aria-describedby={errors.firstName ? "first-name-error" : undefined}
            onChange={(event) => {
              void firstNameField.onChange(event);
              onDraftChange(event.target.value, getValues("note"));
            }}
          />
          {errors.firstName ? (
            <p className="field-error" id="first-name-error" role="alert">
              {errors.firstName.message}
            </p>
          ) : null}
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="praise-note">
            {messages.praiseNoteLabel} <span className="field-optional">({messages.optional})</span>
          </label>
          <Textarea
            {...noteField}
            id="praise-note"
            maxLength={2000}
            disabled={isSubmitting}
            placeholder={messages.praiseNotePlaceholder}
            onChange={(event) => {
              void noteField.onChange(event);
              onDraftChange(getValues("firstName"), event.target.value);
            }}
          />
        </div>

        {hasError ? (
          <InlineNotice kind="error" title={messages.praiseErrorHeading} blocking>
            <p>{messages.praiseErrorBody}</p>
          </InlineNotice>
        ) : null}
        {isOffline ? (
          <InlineNotice kind="offline">
            <p>{messages.offline}</p>
          </InlineNotice>
        ) : null}

        <div className="action-stack">
          <Button
            type="submit"
            loading={isSubmitting}
            loadingLabel={messages.sending}
            disabled={isOffline}
          >
            {hasError ? messages.tryAgain : messages.sendThanks}
          </Button>
          <Button variant="secondary" onClick={onSkip} disabled={isSubmitting}>
            {messages.skip}
          </Button>
        </div>
      </form>
    </section>
  );
}


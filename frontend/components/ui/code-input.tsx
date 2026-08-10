"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Six-digit code entry.
 *
 * The whole reason this product has no passwords. A restaurant owner should
 * never have to invent, remember, or reset one — and every password field is a
 * place where someone gives up and never comes back.
 *
 * Six separate boxes rather than one field, because:
 *
 *   - You can see at a glance how many digits are left. A single input gives no
 *     feedback until it is wrong.
 *   - Fat fingers land on a 56px target instead of a text cursor.
 *   - It looks like every delivery app they already use, so nobody has to learn
 *     anything.
 *
 * It submits itself on the sixth digit. Making someone find a button after
 * typing the last number is a step that exists only for the developer's
 * convenience.
 */

interface CodeInputProps {
  length?: number;
  disabled?: boolean;
  onComplete: (code: string) => void;
  /** Cleared and refocused when this changes — used to reset after a bad code. */
  resetToken?: number;
  label: string;
}

export function CodeInput({
  length = 6,
  disabled = false,
  onComplete,
  resetToken = 0,
  label,
}: CodeInputProps) {
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length }, () => ""));
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  /**
   * Clearing on reset happens during render, not in an effect.
   *
   * React's documented way to adjust state when a prop changes: compare against
   * the previous value and set during rendering. The effect version renders the
   * stale code once, then re-renders empty — which after a wrong code shows the
   * rejected digits for a frame before they vanish.
   */
  const [seenReset, setSeenReset] = useState(resetToken);
  if (resetToken !== seenReset) {
    setSeenReset(resetToken);
    setDigits(Array.from({ length }, () => ""));
  }

  // Focus is a DOM side effect, so it does belong in an effect. Runs on mount
  // and again whenever a reset lands, putting the caret where the next digit
  // goes without the person having to tap.
  useEffect(() => {
    inputs.current[0]?.focus();
  }, [seenReset]);

  function commit(next: string[]) {
    setDigits(next);
    const code = next.join("");
    // Fires the moment the last box is filled. No button to hunt for.
    if (code.length === length && !next.includes("")) onComplete(code);
  }

  function handleChange(index: number, raw: string) {
    const value = raw.replace(/\D/g, "");
    if (!value) return;

    const next = [...digits];

    // A phone autofilling the whole code from an SMS or email lands here as one
    // long string, not six events.
    if (value.length > 1) {
      for (let offset = 0; offset < value.length && index + offset < length; offset += 1) {
        next[index + offset] = value[offset] ?? "";
      }
      commit(next);
      inputs.current[Math.min(index + value.length, length - 1)]?.focus();
      return;
    }

    next[index] = value;
    commit(next);
    inputs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = [...digits];

      // Backspace on an empty box steps back and clears the previous one, which
      // is what people expect and what saves a second tap.
      if (next[index]) {
        next[index] = "";
        setDigits(next);
        return;
      }
      if (index > 0) {
        next[index - 1] = "";
        setDigits(next);
        inputs.current[index - 1]?.focus();
      }
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < length - 1) inputs.current[index + 1]?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;

    const next = Array.from({ length }, (_, position) => pasted[position] ?? "");
    commit(next);
    inputs.current[Math.min(pasted.length, length - 1)]?.focus();
  }

  return (
    <div
      role="group"
      aria-label={label}
      className="flex justify-center gap-2 sm:gap-3"
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            inputs.current[index] = element;
          }}
          value={digit}
          disabled={disabled}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
          // `one-time-code` is what lets iOS and Android offer the code from the
          // notification instead of making someone switch apps to read it.
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={length}
          aria-label={`Digit ${index + 1}`}
          className={cn(
            "h-16 w-12 rounded-[var(--radius-control)] border-2 bg-surface text-center",
            "text-2xl font-semibold tabular-nums text-ink caret-brand sm:h-[72px] sm:w-14 sm:text-3xl",
            "transition-[border-color,box-shadow] duration-150",
            "focus:outline-none focus:ring-4 focus:ring-[color:var(--rb-focus-soft)]",
            "disabled:opacity-50",
            digit
              ? "border-brand shadow-[var(--shadow-control)]"
              : "border-[color:var(--rb-border-strong)] focus:border-brand",
          )}
        />
      ))}
    </div>
  );
}

import { AlertCircle, LoaderCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface StatePanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  tone?: "neutral" | "danger";
  busy?: boolean;
}
function StatePanel({
  icon: Icon,
  title,
  description,
  action,
  tone = "neutral",
  busy,
}: StatePanelProps) {
  return (
    <section
      className="grid justify-items-center gap-5 py-8 text-center"
      aria-busy={busy || undefined}
    >
      <span
        className={cn(
          "grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand-text",
          tone === "danger" && "bg-[color:var(--rb-danger-soft)] text-danger",
        )}
      >
        <Icon
          className={cn(
            "size-7",
            busy && "animate-spin motion-reduce:animate-none",
          )}
          aria-hidden="true"
        />
      </span>
      <div className="grid gap-2">
        <h1 className="m-0 text-[clamp(1.75rem,7vw,2.125rem)] font-semibold leading-[1.12] tracking-[-0.035em] text-ink">
          {title}
        </h1>
        <p className="m-0 text-base leading-6 text-muted">{description}</p>
      </div>
      {action ? <div className="w-full">{action}</div> : null}
    </section>
  );
}
export function LoadingState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <StatePanel
      icon={LoaderCircle}
      title={title}
      description={description}
      busy
    />
  );
}
export function ErrorState({
  title,
  description,
  action,
}: Omit<StatePanelProps, "icon" | "tone">) {
  return (
    <StatePanel
      icon={AlertCircle}
      title={title}
      description={description}
      action={action}
      tone="danger"
    />
  );
}

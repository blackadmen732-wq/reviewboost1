import { CircleAlert, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

interface InlineNoticeProps {
  title?: string;
  children: ReactNode;
  kind?: "error" | "offline" | "info";
  blocking?: boolean;
  id?: string;
}

export function InlineNotice({
  title,
  children,
  kind = "info",
  blocking = false,
  id,
}: InlineNoticeProps) {
  const Icon = kind === "offline" ? WifiOff : CircleAlert;

  return (
    <div
      id={id}
      className={cn("inline-notice", `inline-notice--${kind}`)}
      role={blocking ? "alert" : "status"}
      aria-live={blocking ? undefined : "polite"}
    >
      <Icon aria-hidden="true" size={20} strokeWidth={2} />
      <div>
        {title ? <p className="inline-notice__title">{title}</p> : null}
        <div className="inline-notice__body">{children}</div>
      </div>
    </div>
  );
}


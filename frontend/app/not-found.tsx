import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-5">
      <div className="flex flex-col items-center gap-6 text-center">
        <Wordmark size="md" />
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">
          Page not found
        </h1>
        <p className="max-w-[30ch] text-base text-muted">
          The page you are looking for does not exist or has been moved.
        </p>
        <Button asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}

import { Check, QrCode, Smartphone, Star } from "lucide-react";
import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";
import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <Container
        as="header"
        size="marketing"
        className="flex items-center justify-between py-5"
      >
        <Wordmark size="md" />
        <Link
          href="/login"
          className="rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium text-brand-text transition-colors hover:text-brand-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          Sign in
        </Link>
      </Container>

      <Container as="section" size="marketing" className="pb-16 pt-12 sm:pb-24 sm:pt-20">
        <div className="max-w-[640px]">
          <h1 className="text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[3.5rem]">
            More Google reviews, without the&nbsp;work
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted sm:text-xl">
            Your customers scan a tag on your counter. One tap, and they are
            leaving you a review on Google. No app to download. No account to
            create.
          </p>
          <div className="mt-8">
            <Button asChild size="lg">
              <Link href="/login">Get started — free</Link>
            </Button>
          </div>
        </div>
      </Container>

      <Container as="section" size="marketing" className="py-16 sm:py-24">
        <h2 className="mb-10 text-sm font-semibold uppercase tracking-wide text-muted">
          How it works
        </h2>
        <div className="grid gap-8 sm:grid-cols-3 sm:gap-12">
          <Step
            number={1}
            icon={QrCode}
            title="Place your tag"
            description="Put a tag by the register. Customers scan it with their phone camera — nothing to install."
          />
          <Step
            number={2}
            icon={Smartphone}
            title="One tap"
            description="They see your stars and tap a rating. It takes three seconds, while they are still thinking of you."
          />
          <Step
            number={3}
            icon={Star}
            title="Straight to Google"
            description="Every rating sends the customer to Google to leave a review. Every customer, every star — no filtering."
          />
        </div>
      </Container>

      <Container as="section" size="marketing" className="py-16 sm:py-24">
        <div className="mx-auto max-w-[640px]">
          <h2 className="mb-8 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
            Built for businesses that serve people face to face
          </h2>
          <ul className="flex flex-col gap-6">
            <Benefit
              title="Set up in two minutes"
              description="Type your name, paste your Google link, get your tag. No IT department needed."
            />
            <Benefit
              title="Every rating goes to Google"
              description="We do not filter, gate, or intercept reviews. A 1-star and a 5-star get the same path."
            />
            <Benefit
              title="Your customers stay private"
              description="We never ask them for a name, phone number, or email address. They answer honestly because nobody is watching."
            />
            <Benefit
              title="Nothing for customers to download"
              description="No app, no account, no signup. They scan, tap, and they are done."
            />
          </ul>
        </div>
      </Container>

      <Container as="section" size="marketing" className="py-16 text-center sm:py-24">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
          Ready to see it work?
        </h2>
        <p className="mt-3 text-base text-muted">
          Setup is free. Your first tag is ready in two minutes.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4">
          <Button asChild size="lg">
            <Link href="/login">Get started</Link>
          </Button>
          <p className="text-sm text-muted">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-brand-text underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </Container>

      <Container
        as="footer"
        size="marketing"
        className="border-t border-border py-6"
      >
        <div className="flex items-center justify-between">
          <Wordmark size="sm" tone="mono" />
          <a
            href="mailto:help@reviewboost.app"
            className="text-sm text-muted transition-colors hover:text-ink"
          >
            help@reviewboost.app
          </a>
        </div>
      </Container>
    </div>
  );
}

function Step({
  number,
  icon: Icon,
  title,
  description,
}: {
  number: number;
  icon: typeof QrCode;
  title: string;
  description: string;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-base font-bold text-brand-text">
          {number}
        </span>
        <Icon className="size-6 text-muted" aria-hidden="true" />
      </div>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-base leading-relaxed text-muted">{description}</p>
    </div>
  );
}

function Benefit({ title, description }: { title: string; description: string }) {
  return (
    <li className="flex items-start gap-3">
      <Check
        className="mt-0.5 size-5 shrink-0 text-brand-text"
        aria-hidden="true"
      />
      <div>
        <p className="font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-base leading-relaxed text-muted">
          {description}
        </p>
      </div>
    </li>
  );
}

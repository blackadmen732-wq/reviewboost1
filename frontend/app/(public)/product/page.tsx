import type { Metadata } from "next";
import Link from "next/link";
import {
  ChartLine,
  House,
  ImageIcon,
  Languages,
  Link2,
  MessagesSquare,
  Nfc,
  QrCode,
  Send,
  ShieldCheck,
  Star,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PRODUCT, PUBLIC_HERO, START_HREF } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";
import { ProductDemo } from "@/features/public/product-demo";
import { publicPageMetadata } from "@/lib/site";

export const metadata: Metadata = publicPageMetadata({
  path: "/product",
  title: "Product",
  description:
    "Everything you get: a Tag for your counter (QR code and NFC), a customer page in three languages, and Home, Feedback, Insights and Text Requests for you.",
});

const ICONS: Record<(typeof PRODUCT.groups)[number]["features"][number]["icon"], LucideIcon> = {
  qr: QrCode,
  nfc: Nfc,
  link: Link2,
  photo: ImageIcon,
  star: Star,
  language: Languages,
  private: ShieldCheck,
  home: House,
  feedback: MessagesSquare,
  insights: ChartLine,
  texts: Send,
};

/**
 * The whole product, in the order an owner meets it: the Tag on the counter,
 * the page a customer opens, then the owner's own screens. Each feature is
 * something the code does today; nothing here is coming soon.
 */
export default function ProductPage() {
  return (
    <PublicArticle
      marketing
      currentPath="/product"
      breadcrumb="/product"
      title={PRODUCT.headline}
      lede={PRODUCT.lede}
      media={<ProductDemo hero />}
      actions={
        <>
          <Button asChild variant="action" className="w-auto">
            <Link href={START_HREF}>{PUBLIC_HERO.primary.label}</Link>
          </Button>
          <Link href="/pricing" className="public-hero__sample-link">
            View pricing
          </Link>
        </>
      }
    >
      {PRODUCT.groups.map((group) => (
        <section key={group.title} className="public-feature-group">
          <p className="public-eyebrow">{group.eyebrow}</p>
          <h2>{group.title}</h2>
          <ul className="public-feature-grid">
            {group.features.map((feature) => {
              const Icon = ICONS[feature.icon];
              return (
                <li key={feature.title} className="public-feature">
                  <span className="public-step__icon public-step__icon--soft" aria-hidden="true">
                    <Icon className="size-5" strokeWidth={1.9} />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section>
        <h2>Both carry the same link</h2>
        <p>
          The QR code and the NFC chip open your ReviewBoost page, never to
          Google directly. Customers tap a star, then get your Google review
          link. Every rating is kept in your Feedback.
        </p>
      </section>

      <details className="public-product-details">
        <summary>What breaks a code, and what does not</summary>
        <div>
          <p>
            Changing your Google link does not break your Tag. If your Google
            listing changes, update its review link in Settings. Your printed
            code and NFC tag still work.
          </p>
          <p>
            Rotating a Tag&apos;s code does, and that is what it is for.
            Rotation issues a new address and retires the old one, so anything
            already printed or programmed stops working. Use it when a code has
            ended up somewhere it should not be. Once you rotate, print the new
            code and rewrite the NFC tag before putting it back in use.
          </p>
        </div>
      </details>

      <section className="public-article__close">
        <h2>Put your first Tag on the counter.</h2>
        <p>Sign up, add your Google link, then print your code or program a Tag.</p>
        <div className="mt-6 max-w-xs">
          <Button asChild variant="action" size="lg">
            <Link href={START_HREF}>{PUBLIC_HERO.primary.label}</Link>
          </Button>
        </div>
      </section>
    </PublicArticle>
  );
}

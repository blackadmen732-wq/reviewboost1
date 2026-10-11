import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * A raised surface. The one in the product.
 *
 * This file existed before and nothing imported it — generated boilerplate
 * with `CardHeader`/`CardContent`/`CardFooter` on a p-6 rhythm this product
 * does not use. Meanwhile twenty-one places wrote the recipe out by hand, in
 * fourteen different spellings: p-3, p-4, p-5, p-6, `p-4 sm:p-5`,
 * `p-5 sm:p-6`, some with the shadow and some without. That is why no two
 * screens looked like the same product — not taste, just six paddings for
 * one idea.
 *
 * So there is one padding now, and the two knobs below exist because the
 * call sites proved they were needed, not because a card could imagine
 * wanting them:
 *
 *   pad="tight"  a card INSIDE another card, where the outer one already
 *                paid for the margin
 *   pad="none"   a card whose children are full-bleed rows and draw their
 *                own padding (the grouped lists)
 *   raised=false a card on a surface that is already raised, where a second
 *                shadow reads as a sticker rather than depth
 *
 * `card-sources.test.ts` fails the build if the recipe is typed by hand again.
 */
export function Card({
  as: Tag = "div",
  pad = "default",
  raised = true,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  /** `section` where the card is a labelled region; a div would drop the landmark. */
  as?: "div" | "section";
  pad?: "default" | "tight" | "none";
  raised?: boolean;
}) {
  return (
    <Tag
      className={cn(
        "rounded-[var(--radius-card)] border border-border bg-surface text-ink",
        pad === "default" && "p-5 sm:p-6",
        pad === "tight" && "p-4",
        raised && "shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}

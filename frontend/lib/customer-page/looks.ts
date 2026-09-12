import type { LookId } from "@/lib/customer-page/design";

/**
 * The curated Looks.
 *
 * A Look decides how a business's name is composed inside the hero, and nothing
 * else. It cannot move the hero, resize the rating sheet, or change a colour
 * outside the identity. That constraint is the product: an owner picks from six
 * finished results in a few seconds instead of being handed a font menu and a
 * colour picker and asked to become a designer.
 */

export interface LookDefinition {
  id: LookId;
  label: string;
  /** Shown under the thumbnail in the owner's picker. */
  description: string;
}

export const looks: readonly LookDefinition[] = [
  {
    id: "signature",
    label: "Signature",
    description: "Expressive wordmark with a tracked descriptor.",
  },
  { id: "modern", label: "Modern", description: "Strong, clean type." },
  {
    id: "bold",
    label: "Bold",
    description: "Heavy type. Suits trades, barbers, gyms, garages.",
  },
  { id: "editorial", label: "Editorial", description: "Elegant and premium." },
  { id: "classic", label: "Classic", description: "Balanced and timeless." },
  {
    id: "minimal",
    label: "Minimal",
    description: "Very little type. For strong photos or long names.",
  },
];

export interface WordmarkParts {
  lead: string;
  descriptor: string | null;
}

/**
 * How much type a name can carry before a Look has to give ground.
 *
 * "Mario's Pizza" can be set enormous. "Southeast Regional Dental Associates"
 * cannot, and forcing it would either clip the name or shrink it to a caption.
 * Every Look reads this and steps its type down, which is why a long name never
 * produces a broken hero.
 */
export type NameScale = "compact" | "long" | "extended";

const maxLeadLength = 18;
const maxDescriptorLength = 12;

/**
 * Split a business name into the two lines a Look composes with.
 *
 * Deterministic on purpose. The wordmark is real text set by us, never text
 * generated inside an image, so a business's spelling is always its own — and
 * the same name always produces the same composition, on the owner's preview and
 * on the customer's phone.
 *
 * The last word becomes the descriptor because that is where the category
 * almost always sits in a local business name: Mario's *Pizza*, Sunrise Family
 * *Dental*, Eastside *Barbers*. When the split would leave either line too long
 * to set well, the name stays on one line instead, which is the honest outcome
 * for a name that was never built to be a wordmark.
 */
export function splitBusinessName(name: string): WordmarkParts {
  const collapsed = name.replace(/\s+/gu, " ").trim();
  if (!collapsed) return { lead: "", descriptor: null };

  const words = collapsed.split(" ");
  if (words.length < 2) return { lead: collapsed, descriptor: null };

  const descriptor = words[words.length - 1] ?? "";
  const lead = words.slice(0, -1).join(" ");

  if (lead.length > maxLeadLength || descriptor.length > maxDescriptorLength) {
    return { lead: collapsed, descriptor: null };
  }

  return { lead, descriptor };
}

/**
 * Minimal exists for the business whose photograph should carry the hero, or
 * whose name is too long to be a wordmark. It sets the name on one quiet line,
 * so it never splits.
 */
export function wordmarkForLook(name: string, look: LookId): WordmarkParts {
  if (look === "minimal") {
    return { lead: name.replace(/\s+/gu, " ").trim(), descriptor: null };
  }
  return splitBusinessName(name);
}

export function nameScale(name: string): NameScale {
  const length = name.replace(/\s+/gu, " ").trim().length;
  if (length <= 16) return "compact";
  if (length <= 28) return "long";
  return "extended";
}

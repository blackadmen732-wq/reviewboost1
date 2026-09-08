import type { LookId } from "@/lib/customer-page/design";
import { nameScale, wordmarkForLook } from "@/lib/customer-page/looks";

interface BusinessWordmarkProps {
  businessName: string;
  look: LookId;
}

/**
 * A business's name, set as type — never as pixels.
 *
 * The alternative would be generating the identity inside the hero image, and
 * that fails in the one way a business will not forgive: an image cannot be
 * trusted to spell "Mario's" correctly, and a customer looking at a misspelt
 * name is looking at a page the business will never scan again. Real text also
 * means a screen reader announces the business, the name survives translation of
 * everything around it, and a rename is a database update rather than a
 * re-render of artwork.
 *
 * The Look chooses the faces and the composition; this component only decides
 * which words go on which line.
 */
export function BusinessWordmark({ businessName, look }: BusinessWordmarkProps) {
  const { lead, descriptor } = wordmarkForLook(businessName, look);

  return (
    <p className="cp-wordmark" data-look={look} data-scale={nameScale(businessName)}>
      <span className="cp-wordmark__lead">{lead}</span>
      {descriptor ? (
        <>
          <span className="cp-wordmark__rule" aria-hidden="true" />
          <span className="cp-wordmark__descriptor">{descriptor}</span>
        </>
      ) : null}
    </p>
  );
}

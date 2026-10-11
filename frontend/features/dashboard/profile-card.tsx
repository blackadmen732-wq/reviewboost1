import { Card } from "@/components/ui/card";

/**
 * Who you are signed in as, at the top of Settings.
 *
 * The reference this comes from is a consumer app: a round photo, a person's
 * name, their email underneath. Two of those three exist here, and the third
 * does not, so this says what is true instead of filling the shape.
 *
 * NOT A PHOTO
 * -----------
 * `profiles.avatar_url` exists in the schema and has never been read or
 * written. Making it real is an upload, a storage bucket, a cache-busting
 * URL, a default state and a moderation question — for an image only the one
 * person looking at their own dashboard would ever see. Initials carry the
 * same recognition at none of that cost.
 *
 * NOT A PERSON'S NAME
 * -------------------
 * `profiles.display_name` is filled at signup by a trigger, from the identity
 * provider's `full_name` — falling back to the part of the email before the
 * @. Sign-in here is an emailed code, so there is no provider name and it is
 * always that fallback. Putting it above the email would render "mario" over
 * "mario@mariospizza.com", which looks like a bug rather than an identity.
 *
 * So the business is the title. It is the name somebody typed themselves, it
 * is what the account is actually for, and in a product where one login can
 * hold several places it is the thing worth confirming at a glance.
 */

/** Up to two initials, from the words that have letters in them. */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  const letters = words.slice(0, 2).map((word) => [...word].find((c) => /\p{L}/u.test(c)) ?? "");
  return letters.join("").toUpperCase() || "?";
}

export function ProfileCard({
  businessName,
  email,
}: {
  businessName: string;
  email: string | null;
}) {
  return (
    <Card className="mb-7 flex items-center gap-4">
      <span
        aria-hidden="true"
        className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-soft text-[1.0625rem] font-semibold text-brand-text"
      >
        {initialsOf(businessName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
          {businessName}
        </span>
        {/* The address the code goes to. The one fact somebody checks here. */}
        <span className="block truncate text-[length:var(--rb-text-small)] text-muted">
          {email ?? "No email on this account"}
        </span>
      </span>
    </Card>
  );
}

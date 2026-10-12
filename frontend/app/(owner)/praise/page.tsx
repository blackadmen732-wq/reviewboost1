import { redirect } from "next/navigation";

/** Compatibility for a retired owner surface; historical data stays intact. */
export default function LegacyPage(): never {
  redirect("/feedback");
}

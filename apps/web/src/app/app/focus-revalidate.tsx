"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { watchTabReturn } from "../../lib/revalidate-on-return";

/**
 * Renders nothing. Triggers `router.refresh()` — re-running this route's
 * Server Components, including the membership/branch revalidation in
 * `page.tsx` — when the user comes back to the tab. This is the
 * "recuperar foco" revalidation trigger frontend.md FE-0.1 task 3 requires,
 * without a bespoke Server Action or client-side Supabase/API call.
 *
 * Only `visibilitychange` is used (`focus` fires alongside it and doubled every refresh), and
 * `shouldRevalidateOnReturn` requires the tab to have been hidden at least 15 s with at least
 * 30 s between runs, so quick tab flips do not re-render the page.
 */
export function FocusRevalidate(): null {
  const router = useRouter();

  useEffect(() => watchTabReturn(() => router.refresh()), [router]);

  return null;
}

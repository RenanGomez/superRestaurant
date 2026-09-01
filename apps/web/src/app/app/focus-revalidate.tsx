"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Renders nothing. Triggers `router.refresh()` — re-running this route's
 * Server Components, including the membership/branch revalidation in
 * `page.tsx` — whenever the tab regains focus or visibility. This is the
 * "recuperar foco" revalidation trigger frontend.md FE-0.1 task 3 requires,
 * without a bespoke Server Action or client-side Supabase/API call.
 */
export function FocusRevalidate(): null {
  const router = useRouter();

  useEffect(() => {
    function revalidate(): void {
      router.refresh();
    }
    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") revalidate();
    }

    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}

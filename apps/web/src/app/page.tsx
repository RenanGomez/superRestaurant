import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { createServerSupabaseClient } from "../lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function RootPage(): Promise<ReactNode> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect(user === null ? "/login" : "/app");
}

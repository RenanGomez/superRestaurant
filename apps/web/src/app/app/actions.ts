"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "../../lib/supabase-server";

/** Local, immediate logout — reversible via re-login, so no confirmation dialog. */
export async function logoutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}

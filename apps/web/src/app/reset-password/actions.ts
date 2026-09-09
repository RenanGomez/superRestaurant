"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "../../lib/supabase-server";

export async function updatePasswordAction(formData: FormData): Promise<void> {
  const password = formData.get("password");
  const confirmation = formData.get("confirmation");
  if (typeof password !== "string" || typeof confirmation !== "string" || password.length < 10 || password !== confirmation) {
    redirect("/reset-password?error=invalid_password");
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) redirect("/login?error=invalid_credentials");

  const { error } = await supabase.auth.updateUser({ password });
  if (error !== null) redirect("/reset-password?error=update_failed");

  // Do not carry the recovery session into normal application navigation. The
  // operator signs in explicitly with the password just established.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?password_updated=1");
}

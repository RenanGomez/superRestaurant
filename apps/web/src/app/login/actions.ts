"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "../../lib/supabase-server";

/**
 * Password sign-in. Redirect destinations are fixed constants ("/login" with
 * an allowlisted error code, or "/app") — never a caller-supplied path — per
 * frontend.md's "destinos fijos" requirement. Failures always surface the
 * same generic message: this action never distinguishes "unknown email" from
 * "wrong password" (AGENTS.md: "error de autenticación genérico").
 */
export async function loginAction(formData: FormData): Promise<void> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string" || email.trim() === "" || password === "") {
    redirect("/login?error=invalid_credentials");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

  if (error) {
    redirect("/login?error=invalid_credentials");
  }

  redirect("/app");
}

"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getServerEnv } from "../../../../env";
import { createServerSupabaseClient } from "../../../../lib/supabase-server";
import { disableSystemRestaurant, provisionSystemRestaurant } from "../../../../lib/system-onboarding";
export async function createRestaurantAction(formData: FormData): Promise<void> {
  const supabase = await createServerSupabaseClient(); const { data: { session } } = await supabase.auth.getSession(); if (session === null) redirect("/login");
  const env = getServerEnv();
  const result = await provisionSystemRestaurant(session.access_token, env.apiBaseUrl, {
    idempotencyKey: randomUUID(),
    restaurant: { name: text(formData, "restaurantName"), timeZone: text(formData, "timeZone"), currency: text(formData, "currency") },
    branch: { name: text(formData, "branchName") },
    manager: { email: text(formData, "managerEmail").toLowerCase(), role: "manager" },
    seedProfile: "development_minimal_v1",
  });
  redirect(result?.status === "invitation_pending" ? "/app/system-admin/restaurants?created=1" : "/app/system-admin/restaurants?error=1");
}
function text(data: FormData, key: string): string { const value = data.get(key); return typeof value === "string" ? value.trim() : ""; }
export async function disableRestaurantAction(formData: FormData): Promise<void> {
  const supabase = await createServerSupabaseClient(); const { data: { session } } = await supabase.auth.getSession(); if (session === null) redirect("/login");
  const result = await disableSystemRestaurant(session.access_token, getServerEnv().apiBaseUrl, text(formData, "restaurantId"), text(formData, "reason"));
  redirect(result ? "/app/system-admin/restaurants?disabled=1" : "/app/system-admin/restaurants?error=1");
}

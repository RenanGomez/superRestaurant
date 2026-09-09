import type { ReactNode } from "react";

import { createServerSupabaseClient } from "../lib/supabase-server";
import { RootRedirect } from "./root-redirect";

export const dynamic = "force-dynamic";

export default async function RootPage(): Promise<ReactNode> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return <RootRedirect authenticated={user !== null} />;
}

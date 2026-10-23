import { NextResponse } from "next/server";

import { isAccessToken, isRefreshToken } from "../../../../lib/auth-callback";
import { createServerSupabaseClient } from "../../../../lib/supabase-server";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();
    if (!isCallbackBody(body)) return NextResponse.json({ ok: false }, { status: 400 });

    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.setSession({
      access_token: body.accessToken,
      refresh_token: body.refreshToken,
    });

    return error === null
      ? NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } })
      : NextResponse.json({ ok: false }, { status: 400, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}

function isCallbackBody(value: unknown): value is { readonly accessToken: string; readonly refreshToken: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isAccessToken(record.accessToken) && isRefreshToken(record.refreshToken);
}

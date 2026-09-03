export function readLocalProxyTarget(value: string | undefined): string {
  const candidate = value ?? "http://127.0.0.1:3001";
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("KDS_PROXY_TARGET_INVALID");
  }
  if (
    parsed.protocol !== "http:"
    || !["127.0.0.1", "localhost"].includes(parsed.hostname)
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
  ) throw new Error("KDS_PROXY_TARGET_INVALID");
  return parsed.origin;
}

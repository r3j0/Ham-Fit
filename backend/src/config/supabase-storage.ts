/** Server-only Storage settings. Database passwords and publishable keys are not Storage credentials. */
export function supabaseStorageSettings(config: Record<string, unknown>) {
  const value = config.SUPABASE_URL;
  let url: URL;
  try {
    if (typeof value !== 'string') throw new Error();
    url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value) throw new Error();
  } catch {
    throw new Error(
      'SUPABASE_URL must be an HTTPS project origin without a path or trailing slash.',
    );
  }
  const key = config.SUPABASE_SECRET_KEY;
  let privileged =
    typeof key === 'string' && /^sb_secret_[A-Za-z0-9_-]+$/.test(key);
  if (
    !privileged &&
    typeof key === 'string' &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)
  ) {
    try {
      // Classify configuration only. Supabase verifies the signature and privileges on every request.
      const claims = JSON.parse(
        Buffer.from(key.split('.')[1], 'base64url').toString('utf8'),
      ) as { role?: unknown };
      privileged = claims.role === 'service_role';
    } catch {
      /* Invalid credentials are rejected below without echoing them. */
    }
  }
  if (!privileged)
    throw new Error(
      'SUPABASE_SECRET_KEY must be a server-only secret key or legacy service_role key.',
    );
  const bucket = config.SUPABASE_AVATAR_BUCKET ?? 'avatar-assets';
  if (
    typeof bucket !== 'string' ||
    bucket.length > 100 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bucket)
  ) {
    throw new Error(
      'SUPABASE_AVATAR_BUCKET must be a lowercase bucket ID containing letters, numbers and hyphens.',
    );
  }
  return { url: url.origin, key: key as string, bucket };
}

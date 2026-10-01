import { isIP } from 'node:net';

export function validateEnvironment(config: Record<string, unknown>) {
  const nodeEnv = config.NODE_ENV ?? 'development';
  if (
    typeof nodeEnv !== 'string' ||
    !['development', 'production', 'test'].includes(nodeEnv)
  ) {
    throw new Error('NODE_ENV must be development, production, or test.');
  }

  const port = Number(config.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const frontendOrigin = config.FRONTEND_ORIGIN ?? 'http://localhost:3000';
  if (typeof frontendOrigin !== 'string') {
    throw new Error('FRONTEND_ORIGIN must be a valid HTTP(S) origin.');
  }
  let url: URL;
  try {
    url = new URL(frontendOrigin);
  } catch {
    throw new Error('FRONTEND_ORIGIN must be a valid HTTP(S) origin.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== frontendOrigin
  ) {
    throw new Error(
      'FRONTEND_ORIGIN must be an HTTP(S) origin without a path or trailing slash.',
    );
  }

  const databaseUrl = config.DATABASE_URL;
  try {
    if (typeof databaseUrl !== 'string' || databaseUrl.trim() !== databaseUrl) {
      throw new Error();
    }
    const database = new URL(databaseUrl);
    const schema = database.searchParams.get('schema');
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      !database.hostname ||
      !database.username ||
      database.pathname.length <= 1 ||
      database.pathname.slice(1).includes('/') ||
      database.hash ||
      database.searchParams.getAll('schema').length > 1 ||
      (schema !== null && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'DATABASE_URL must be a PostgreSQL URL with a user, host, database, and valid schema.',
    );
  }

  const secret = config.AUTH_JWT_SECRET;
  if (typeof secret !== 'string' || !/^[a-fA-F0-9]{64}$/.test(secret)) {
    throw new Error(
      'AUTH_JWT_SECRET must contain 32 random bytes encoded as 64 hexadecimal characters.',
    );
  }
  const accessTtl = Number(config.AUTH_ACCESS_TTL_SECONDS ?? 900);
  const refreshTtl = Number(config.AUTH_REFRESH_TTL_SECONDS ?? 604800);
  if (!Number.isInteger(accessTtl) || accessTtl < 60 || accessTtl > 3600) {
    throw new Error('AUTH_ACCESS_TTL_SECONDS must be between 60 and 3600.');
  }
  if (
    !Number.isInteger(refreshTtl) ||
    refreshTtl < 3600 ||
    refreshTtl > 2592000 ||
    refreshTtl <= accessTtl
  ) {
    throw new Error(
      'AUTH_REFRESH_TTL_SECONDS must be between 3600 and 2592000 and exceed the access token lifetime.',
    );
  }
  const sameSite = config.AUTH_COOKIE_SAME_SITE ?? 'lax';
  if (
    (sameSite !== 'lax' && sameSite !== 'none') ||
    (sameSite === 'none' && nodeEnv !== 'production')
  ) {
    throw new Error(
      'AUTH_COOKIE_SAME_SITE must be lax, or none with production HTTPS.',
    );
  }
  if (nodeEnv === 'production' && url.protocol !== 'https:') {
    throw new Error('FRONTEND_ORIGIN must use HTTPS in production.');
  }
  const trustedProxyInput = config.TRUST_PROXY_CIDRS ?? '';
  if (typeof trustedProxyInput !== 'string')
    throw new Error(
      'TRUST_PROXY_CIDRS must contain explicit IP addresses or CIDRs.',
    );
  const trustedProxies = trustedProxyInput
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const address of trustedProxies) {
    const [ip, prefix, extra] = address.split('/');
    const family = isIP(ip);
    if (
      !family ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) ||
          Number(prefix) < 1 ||
          Number(prefix) > (family === 4 ? 32 : 128)))
    ) {
      throw new Error(
        'TRUST_PROXY_CIDRS must contain explicit IP addresses or CIDRs; trusting every address is not allowed.',
      );
    }
  }

  if (
    config.AVATAR_MANAGER_TOKEN !== undefined &&
    (typeof config.AVATAR_MANAGER_TOKEN !== 'string' ||
      !/^[a-f0-9]{64}$/.test(config.AVATAR_MANAGER_TOKEN))
  ) {
    throw new Error(
      'AVATAR_MANAGER_TOKEN must be 32 random bytes encoded as 64 lowercase hexadecimal characters.',
    );
  }
  if (
    config.AVATAR_ASSET_DIR !== undefined &&
    (typeof config.AVATAR_ASSET_DIR !== 'string' ||
      !config.AVATAR_ASSET_DIR.trim())
  ) {
    throw new Error(
      'AVATAR_ASSET_DIR must be a nonempty persistent directory path.',
    );
  }

  return {
    ...config,
    NODE_ENV: nodeEnv,
    PORT: port,
    FRONTEND_ORIGIN: frontendOrigin,
    DATABASE_URL: databaseUrl,
    AUTH_JWT_SECRET: secret,
    AUTH_ACCESS_TTL_SECONDS: accessTtl,
    AUTH_REFRESH_TTL_SECONDS: refreshTtl,
    AUTH_COOKIE_SAME_SITE: sameSite,
    TRUST_PROXY_CIDRS: trustedProxies,
  };
}

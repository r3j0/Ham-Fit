/** Shared by runtime and integration tests; never print the credential-bearing URL. */
export function databaseOptions(connectionString: string) {
  const url = new URL(connectionString);
  const schema = url.searchParams.get('schema') ?? 'public';
  url.searchParams.delete('schema');
  // Prisma's pg adapter reads/writes timestamptz using UTC wall-clock values.
  // Apply this at connection startup so every pooled connection uses UTC.
  // Keep caller options, but make UTC the final setting if a timezone exists.
  const options = url.searchParams.get('options');
  url.searchParams.set(
    'options',
    options ? `${options} -c timezone=UTC` : '-c timezone=UTC',
  );

  return {
    connectionString: url.toString(),
    schema,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  };
}

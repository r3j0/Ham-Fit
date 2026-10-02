// Route smoke check: deliberately unauthenticated, with an invalid empty body.
// Never purchases products or reads account data on the target deployment.
const target = process.argv[2];
if (!target)
  throw new Error('Usage: node scripts/verify-shop-routes.mjs API_ORIGIN');
const origin = new URL(target);
if (
  !['http:', 'https:'].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash
)
  throw new Error(
    'Provide an HTTP(S) origin without a path, query or credentials.',
  );
for (const path of ['/api/v1/shop/purchases', '/api/v1/shop/purchases/batch']) {
  const response = await fetch(new URL(path, origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
    body: '{}',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 401)
    throw new Error(
      `${path}: expected authentication boundary 401, received ${response.status}. Verify the API deployment and routing.`,
    );
  console.log(`${path}: authentication boundary OK (401)`);
}

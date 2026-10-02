import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Client generation does not need a database. Migration commands require a URL.
  // Supabase migration/inspection commands use direct or session connections.
  // The running API continues to use DATABASE_URL through DatabaseService.
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL },
});

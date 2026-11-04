import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: ['.env', '../../.env'], quiet: true });

/**
 * Configures the Prisma CLI: schema location, migrations folder and database URL.
 * @since REQ-001
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});

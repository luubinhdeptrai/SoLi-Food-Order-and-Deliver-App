import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../drizzle/db';
import { openAPI } from 'better-auth/plugins';
import * as schema from '../drizzle/schema';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [openAPI()],
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },
});

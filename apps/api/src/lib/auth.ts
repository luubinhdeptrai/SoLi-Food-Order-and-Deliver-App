import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, bearer, openAPI } from 'better-auth/plugins';
import { db } from '../drizzle/db';
import * as schema from '../drizzle/schema';

export const APP_ROLES = ['admin', 'restaurant', 'shipper', 'user'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    openAPI(),
    bearer(),
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
    }),
  ],
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },
});

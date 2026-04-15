import { Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DB_CONNECTION } from './drizzle.constants';

@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      useFactory: () => {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
          throw new Error('DATABASE_URL is not defined');
        }
        return drizzle({
          connection: {
            connectionString: databaseUrl,
          },
        });
      },
    },
  ],
  exports: [DB_CONNECTION],
})
export class DatabaseModule {}

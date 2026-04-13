import { Injectable, Inject } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

@Injectable()
export class DrizzleService {
  constructor(@Inject('DB_CONNECTION') readonly db: NodePgDatabase) {}
}

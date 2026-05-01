/**
 * env-setup.ts
 *
 * Loads environment variables before Jest runs any test file.
 * Resolution order:
 *   1. .env.test (if it exists) — for running tests against a dedicated test DB
 *   2. .env        — fallback to the dev env (shared DB — use with caution)
 *
 * Place this file in setupFiles in jest-e2e.json so it runs in the same
 * worker process as the tests, making process.env available to NestJS modules.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const envTest = path.join(root, '.env.test');
const envDev = path.join(root, '.env');

if (fs.existsSync(envTest)) {
  dotenv.config({ path: envTest, override: true });
} else if (fs.existsSync(envDev)) {
  dotenv.config({ path: envDev, override: true });
}

import { readFileSync } from 'fs';
import { Client } from 'pg';

const sql = readFileSync('./src/drizzle/out/0011_money_integer_refactor.sql', 'utf8');

const client = new Client({
  connectionString: 'postgresql://food_order:foodordersecret@localhost:5433/food_order_db',
});

async function run() {
  await client.connect();
  try {
    // Split on the --> statement-breakpoint marker used by drizzle, or just run as-is
    await client.query(sql);
    console.log('Migration 0011 applied successfully');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();

const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://food_order:foodordersecret@localhost:5433/food_order_db' });
async function run() {
  await client.connect();
  try {
    await client.query(\$migSql\);
    console.log('Migration 0011 applied successfully');
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}
run();

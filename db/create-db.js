const { Pool } = require('pg');
require('dotenv').config();

// Connect to default 'postgres' database to create our app database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\/chess_trainer$/, '/postgres'),
});

async function createDb() {
  try {
    // Check if database exists
    const check = await pool.query(
      "SELECT 1 FROM pg_database WHERE datname = 'chess_trainer'"
    );
    if (check.rows.length > 0) {
      console.log('✅ Database chess_trainer already exists');
    } else {
      await pool.query('CREATE DATABASE chess_trainer');
      console.log('✅ Database chess_trainer created');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createDb();

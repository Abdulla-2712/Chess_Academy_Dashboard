const pool = require('./pool');

const LEVELS = [];
for (let i = 1; i <= 13; i++) {
  const pricePerSession = 100 + (i - 1) * 15;
  LEVELS.push({
    level_number: i,
    price_per_session: pricePerSession,
    total_price: pricePerSession * 8,
  });
}

async function seed() {
  try {
    for (const level of LEVELS) {
      await pool.query(
        `INSERT INTO levels (level_number, price_per_session, total_price)
         VALUES ($1, $2, $3)
         ON CONFLICT (level_number) DO UPDATE
         SET price_per_session = EXCLUDED.price_per_session,
             total_price = EXCLUDED.total_price`,
        [level.level_number, level.price_per_session, level.total_price]
      );
    }
    console.log('✅ Seeded 13 levels successfully');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();

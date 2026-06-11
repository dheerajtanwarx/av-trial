const mysql = require('mysql2/promise');
require('dotenv/config');

const pool = mysql.createPool({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  port: process.env.DATABASE_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function deleteAccessories() {
  let conn;
  try {
    conn = await pool.getConnection();

    // Step 1: Find the Accessories category
    const [categories] = await conn.query(
      `SELECT id, name FROM Category WHERE name = ?`,
      ['Accessories']
    );

    if (categories.length === 0) {
      console.log('❌ Accessories category not found.');
      return;
    }

    const categoryId = categories[0].id;
    console.log(`\n✅ Found Accessories category:`);
    console.log(`   ID: ${categoryId}`);
    console.log(`   Name: ${categories[0].name}\n`);

    // Step 2: Find all products in this category
    const [products] = await conn.query(
      `SELECT id, name, price FROM Product WHERE categoryId = ?`,
      [categoryId]
    );

    console.log(`✅ Found ${products.length} product(s) in Accessories:\n`);
    products.forEach((p) => {
      console.log(`   ID: ${p.id} | Name: "${p.name}" | Price: $${p.price}`);
    });

    // Ask for confirmation
    console.log('\n⚠️  This will delete:');
    console.log(`   - ${products.length} product(s)`);
    console.log(`   - 1 category (Accessories)\n`);

    // Step 3: Delete products first (foreign key constraint)
    console.log('🔄 Deleting products...');
    const productIds = products.map((p) => p.id);
    if (productIds.length > 0) {
      await conn.query(`DELETE FROM Product WHERE id IN (?)`, [productIds]);
      console.log(`✅ Deleted ${productIds.length} product(s)\n`);
    }

    // Step 4: Delete category
    console.log('🔄 Deleting category...');
    await conn.query(`DELETE FROM Category WHERE id = ?`, [categoryId]);
    console.log(`✅ Deleted Accessories category\n`);

    // Step 5: Verify deletion
    const [remainingCategories] = await conn.query(
      `SELECT COUNT(*) as count FROM Category WHERE name = ?`,
      ['Accessories']
    );

    if (remainingCategories[0].count === 0) {
      console.log('✅ Verification: Accessories category successfully removed from database\n');
    }

    console.log('🎉 Cleanup complete!\n');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

deleteAccessories();

import { PrismaClient } from '@/lib/prisma';

const prisma = new PrismaClient();

async function deleteAccessories() {
  try {
    // Step 1: Find the Accessories category
    const category = await prisma.category.findUnique({
      where: { name: 'Accessories' },
      include: { products: true },
    });

    if (!category) {
      console.log('❌ Accessories category not found.');
      process.exit(0);
    }

    console.log(`\n✅ Found Accessories category:`);
    console.log(`   ID: ${category.id}`);
    console.log(`   Name: ${category.name}\n`);

    // Step 2: Show products
    console.log(`✅ Found ${category.products.length} product(s) in Accessories:\n`);
    category.products.forEach((p) => {
      console.log(`   ID: ${p.id} | Name: "${p.name}" | Price: $${p.price}`);
    });

    console.log('\n⚠️  This will delete:');
    console.log(`   - ${category.products.length} product(s)`);
    console.log(`   - 1 category (Accessories)\n`);

    // Step 3: Delete products first
    console.log('🔄 Deleting products...');
    const deleteProducts = await prisma.product.deleteMany({
      where: { categoryId: category.id },
    });
    console.log(`✅ Deleted ${deleteProducts.count} product(s)\n`);

    // Step 4: Delete category
    console.log('🔄 Deleting category...');
    await prisma.category.delete({
      where: { id: category.id },
    });
    console.log(`✅ Deleted Accessories category\n`);

    // Step 5: Verify
    const remaining = await prisma.category.findUnique({
      where: { name: 'Accessories' },
    });

    if (!remaining) {
      console.log('✅ Verification: Accessories category successfully removed from database\n');
    }

    console.log('🎉 Cleanup complete!\n');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

deleteAccessories();

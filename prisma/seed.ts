/* Seed the storefront catalog — ported from frontend/app/lib/landing-data.ts
   and pdp-data.ts so the dynamic API mirrors the existing static frontend.
   Run with: npm run seed */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { parseINR } from "../src/lib/money";

/* ---- Image URL builder (ported from landing-data.ts) ---- */
const IMG_REMAP: Record<string, string> = {
  "premium_photo-1682096032284-0b2ab20b65dd": "photo-1610030469983-98e550d6193c",
  "premium_photo-1682096034925-468c545d1c12": "photo-1597983073493-88cd35cf93b0",
  "premium_photo-1682096037844-e43413e887a8": "photo-1611042553365-9b101441c135",
  "premium_photo-1682096048114-4b36a3212527": "photo-1612722432474-b971cdcea546",
  "premium_photo-1682096055581-7cb5a5fd3d80": "photo-1594633312681-425c7b97ccd1",
  "premium_photo-1682096060450-6ac06a3a0478": "photo-1595777457583-95e059d581b8",
  "premium_photo-1682096065017-ab3d3a162b33": "photo-1583846783214-7229a91b20ed",
  "premium_photo-1682096067532-3e89ab323ebf": "photo-1617137968427-85924c800a22",
};
const img = (id: string, w = 1100): string => {
  if (id.startsWith("http")) return id;
  const safe = IMG_REMAP[id] ?? id;
  return `https://images.unsplash.com/${safe}?w=${w}&q=78&auto=format&fit=crop`;
};

const DEFAULT_COLORS = [
  { name: "Rani Pink", hex: "#bd3c6e" },
  { name: "Deep Maroon", hex: "#6e1f2e" },
  { name: "Emerald", hex: "#1d5042" },
  { name: "Royal Blue", hex: "#27406e" },
];
const DEFAULT_SIZES = ["XS", "S", "M", "L", "XL"];

/* Shared gallery ids appended to every product's PDP (mirrors baseFrom). */
const GALLERY = [
  "premium_photo-1682096048114-4b36a3212527",
  "premium_photo-1682096065017-ab3d3a162b33",
  "premium_photo-1682096060450-6ac06a3a0478",
];

/* ---- Categories ---- */
const CATEGORIES = [
  { name: "Jaipuri Odhni", slug: "jaipuri-odhni" },
  { name: "Lehenga", slug: "lehenga" },
  { name: "Designer Saree", slug: "designer-saree" },
  { name: "Suit Sets", slug: "suit-sets" },
  { name: "Dupatta", slug: "dupatta" },
  { name: "Accessories", slug: "accessories" },
];

/* "Complete the look" cross-sell accessories (ported from CROSS_SELL in
   cart-data.ts). Seeded as real products so they can be checked out. */
const ACCESSORIES = [
  { slug: "jhumka", name: "Polki Jhumka Set", type: "Temple · 22k Gold-plate", price: 3200, color: { name: "Gold", hex: "#bd8f3c" }, image: "premium_photo-1682096034925-468c545d1c12" },
  { slug: "juttis", name: "Zari Embroidered Juttis", type: "Handcrafted · Velvet", price: 2400, color: { name: "Maroon", hex: "#6e1f2e" }, image: "premium_photo-1682096037844-e43413e887a8" },
  { slug: "potli", name: "Silk Potli Clutch", type: "Gota Patti · Raw Silk", price: 1900, color: { name: "Rani Pink", hex: "#bd3c6e" }, image: "premium_photo-1682096048114-4b36a3212527" },
];

/* ---- Products (odhniEdit + bestsellers) ---- */
type SeedProduct = {
  slug: string;
  name: string;
  type: string;
  price: string;
  was?: string;
  badge?: string;
  category: string;
  isBestseller: boolean;
  rating: number;
  reviewCount: number;
  main: string;
  alt: string;
  pdpOverride?: Record<string, unknown>;
};

const PRODUCTS: SeedProduct[] = [
  {
    slug: "gulabi-bandhani-odhni",
    name: "Gulabi Bandhani Odhni",
    type: "Bandhej · Pure Georgette",
    price: "₹3,450",
    badge: "New",
    category: "jaipuri-odhni",
    isBestseller: false,
    rating: 4.9,
    reviewCount: 96,
    main: "photo-1574847872646-abff244bbd87",
    alt: "premium_photo-1682096060450-6ac06a3a0478",
  },
  {
    slug: "leheriya-wave-odhni",
    name: "Leheriya Wave Odhni",
    type: "Leheriya · Chiffon",
    price: "₹2,890",
    was: "₹3,600",
    category: "jaipuri-odhni",
    isBestseller: false,
    rating: 4.8,
    reviewCount: 96,
    main: "premium_photo-1682096060450-6ac06a3a0478",
    alt: "photo-1693336429270-094637e16d38",
  },
  {
    slug: "gota-patti-rani-odhni",
    name: "Gota Patti Rani Odhni",
    type: "Gota Patti · Silk Blend",
    price: "₹4,750",
    badge: "Signature",
    category: "jaipuri-odhni",
    isBestseller: false,
    rating: 4.9,
    reviewCount: 96,
    main: "premium_photo-1682096037844-e43413e887a8",
    alt: "premium_photo-1682096048114-4b36a3212527",
  },
  {
    slug: "sanganeri-block-odhni",
    name: "Sanganeri Block Odhni",
    type: "Hand-Block · Cotton Mul",
    price: "₹2,150",
    category: "jaipuri-odhni",
    isBestseller: false,
    rating: 4.4,
    reviewCount: 80,
    main: "premium_photo-1682096048114-4b36a3212527",
    alt: "premium_photo-1682096034925-468c545d1c12",
  },
  {
    slug: "rani-bagh-bridal-lehenga",
    name: "Rani Bagh Bridal Lehenga",
    type: "Zardozi · Raw Silk",
    price: "₹68,500",
    was: "₹82,000",
    category: "lehenga",
    isBestseller: true,
    rating: 4.9,
    reviewCount: 128,
    main: "photo-1645862755924-9f4e7f200b83",
    alt: "premium_photo-1682096065017-ab3d3a162b33",
    pdpOverride: {
      name: "Rani Bagh Royal Bridal Lehenga",
      navHot: "Lehenga",
      crumb: ["Lehenga", "Bridal Atelier"],
      eyebrow: "Bridal Atelier · Made to Measure",
      craft: "Hand Zardozi & Gota Patti · Raw Silk",
      galleryFlag: "Bridal · Made to Order",
      rating: 4.9,
      reviewCount: 128,
      desc: "A regal three-piece bridal ensemble — months of hand zardozi and gota-patti laid across raw Banarasi silk, finished with a scalloped net dupatta dyed in the colours of the Pink City.",
      images: [
        img("premium_photo-1682096032284-0b2ab20b65dd"),
        img("premium_photo-1682096065017-ab3d3a162b33"),
        img("photo-1645862755924-9f4e7f200b83"),
        img("premium_photo-1682096048114-4b36a3212527"),
        img("premium_photo-1682096060450-6ac06a3a0478"),
      ],
      accordion: [
        {
          q: "Delivery & Shipping",
          a: "This piece is <b>made to order</b> and ships in 3–4 weeks. Complimentary insured shipping across India; express worldwide delivery calculated at checkout. You will receive a tracking link the moment it leaves our Jaipur atelier.",
        },
        {
          q: "Returns & Exchange",
          a: "Easy <b>7-day returns</b> on ready sizes. As each bridal piece is custom-stitched to your measures, made-to-measure orders are eligible for <b>one free alteration</b> rather than return. Our stylist will guide you through every step.",
        },
        {
          q: "Fabric & Care",
          a: "Raw Banarasi silk with real <b>gota-patti</b> and zardozi handwork. <b>Dry-clean only.</b> Store folded in the muslin pouch provided, away from direct sunlight, to keep the metallic work luminous for generations.",
        },
      ],
      craftBand: {
        eyebrow: "The House Craft",
        title: "Woven by hand, *over months*",
        lead: "Every Rani Bagh lehenga begins as a bare length of raw silk. Our karigars in Jaipur trace, couch and embroider each motif by hand — no two pieces are ever quite alike.",
        specs: [
          { st: "Technique", sv: "Zardozi & Gota Patti" },
          { st: "Base Fabric", sv: "Raw Banarasi Silk" },
          { st: "Crafting Time", sv: "Approx. 90 days" },
          { st: "Includes", sv: "Lehenga · Blouse · Dupatta" },
        ],
        image: img("premium_photo-1682096060450-6ac06a3a0478"),
      },
    },
  },
  {
    slug: "chanderi-gold-tissue-saree",
    name: "Chanderi Gold Tissue Saree",
    type: "Zari · Chanderi Silk",
    price: "₹7,600",
    was: "₹9,200",
    category: "designer-saree",
    isBestseller: true,
    rating: 4.8,
    reviewCount: 96,
    main: "photo-1769500804057-ca1391bf4617",
    alt: "premium_photo-1682096032284-0b2ab20b65dd",
  },
  {
    slug: "mirror-mahal-lehenga",
    name: "Mirror Mahal Lehenga",
    type: "Sheesha · Georgette",
    price: "₹16,750",
    badge: "Trending",
    category: "lehenga",
    isBestseller: true,
    rating: 4.4,
    reviewCount: 88,
    main: "premium_photo-1682096065017-ab3d3a162b33",
    alt: "photo-1645862755924-9f4e7f200b83",
  },
  {
    slug: "sanganeri-cotton-suit-set",
    name: "Sanganeri Cotton Suit Set",
    type: "Hand-Block · Cotton",
    price: "₹4,990",
    category: "suit-sets",
    isBestseller: true,
    rating: 4.9,
    reviewCount: 96,
    main: "photo-1574847872646-abff244bbd87",
    alt: "premium_photo-1682096037844-e43413e887a8",
  },
];

const PROMOS = [
  { code: "RANI10", pct: "0.1", label: "10% off your order" },
  { code: "BRIDE5", pct: "0.05", label: "5% welcome offer" },
];

const DEMO_REVIEWS = [
  {
    name: "Ananya R.",
    rating: 5,
    comment:
      "Wore this for my reception — the zardozi caught every light in the room. The fit after made-to-measure was flawless.",
  },
  {
    name: "Meghna S.",
    rating: 5,
    comment:
      "Heirloom quality. The gota-patti border is even more luminous in person than the photos. Worth every rupee.",
  },
];

async function main() {
  console.log("Clearing existing catalog data…");
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.review.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.promo.deleteMany();
  // Remove the demo customer (and its address/orders cascade) if present.
  await prisma.user.deleteMany({ where: { email: "demo@avcreation.test" } });

  console.log("Seeding categories…");
  const categoryBySlug: Record<string, number> = {};
  for (const c of CATEGORIES) {
    const cat = await prisma.category.create({ data: c });
    categoryBySlug[c.slug] = cat.id;
  }

  console.log("Seeding products, variants & images…");
  const productBySlug: Record<string, number> = {};
  for (const p of PRODUCTS) {
    const product = await prisma.product.create({
      data: {
        categoryId: categoryBySlug[p.category],
        name: p.name,
        slug: p.slug,
        type: p.type,
        description: null,
        basePrice: parseINR(p.price),
        comparePrice: p.was ? parseINR(p.was) : null,
        badge: p.badge ?? null,
        rating: p.rating,
        reviewCount: p.reviewCount,
        isBestseller: p.isBestseller,
        sizes: DEFAULT_SIZES,
        pdpOverride: p.pdpOverride ?? undefined,
      },
    });
    productBySlug[p.slug] = product.id;

    // Variants — one per default colour.
    for (const color of DEFAULT_COLORS) {
      await prisma.productVariant.create({
        data: {
          productId: product.id,
          color: color.name,
          colorHex: color.hex,
          price: parseINR(p.price),
          stockQty: 25,
          sku: `${p.slug}-${color.name.toLowerCase().replace(/\s+/g, "-")}`,
        },
      });
    }

    // Images — main, alt, then shared gallery ids (PDP gallery).
    const imageIds = [p.main, p.alt, ...GALLERY];
    for (let i = 0; i < imageIds.length; i++) {
      await prisma.productImage.create({
        data: {
          productId: product.id,
          imageUrl: img(imageIds[i]),
          isPrimary: i === 0,
          sortOrder: i,
        },
      });
    }
  }

  console.log("Seeding accessories (cross-sell)…");
  for (const a of ACCESSORIES) {
    const product = await prisma.product.create({
      data: {
        categoryId: categoryBySlug["accessories"],
        name: a.name,
        slug: a.slug,
        type: a.type,
        basePrice: a.price,
        rating: 4.8,
        reviewCount: 40,
        sizes: ["One Size"],
        variants: {
          create: {
            color: a.color.name,
            colorHex: a.color.hex,
            price: a.price,
            stockQty: 50,
            sku: `${a.slug}-${a.color.name.toLowerCase()}`,
          },
        },
        images: { create: { imageUrl: img(a.image, 700), isPrimary: true, sortOrder: 0 } },
      },
    });
    productBySlug[a.slug] = product.id;
  }

  console.log("Seeding promos…");
  for (const promo of PROMOS) {
    await prisma.promo.create({
      data: { code: promo.code, pct: promo.pct, label: promo.label },
    });
  }

  console.log("Seeding demo customer + delivered order + approved reviews…");
  const demoUser = await prisma.user.create({
    data: {
      email: "demo@avcreation.test",
      name: "Ananya R.",
      phone: "+919800000000",
      addresses: {
        create: {
          fullName: "Ananya R.",
          phone: "+919800000000",
          street: "12 Amer Road",
          city: "Jaipur",
          state: "Rajasthan",
          pincode: "302002",
          isDefault: true,
        },
      },
    },
    include: { addresses: true },
  });

  const raniId = productBySlug["rani-bagh-bridal-lehenga"];
  const raniVariant = await prisma.productVariant.findFirst({
    where: { productId: raniId },
  });
  const order = await prisma.order.create({
    data: {
      userId: demoUser.id,
      addressId: demoUser.addresses[0].id,
      totalAmount: 68500,
      discount: 0,
      finalAmount: 68500,
      status: "DELIVERED",
      shippingMethod: "standard",
      shippingFee: 0,
      items: {
        create: {
          variantId: raniVariant!.id,
          size: "M",
          quantity: 1,
          unitPrice: 68500,
          totalPrice: 68500,
        },
      },
      payments: {
        create: {
          method: "UPI",
          status: "SUCCESS",
          amount: 68500,
          gateway: "mock",
          paidAt: new Date(),
        },
      },
    },
  });

  // Two approved reviews on the delivered bridal lehenga.
  // (unique [userId, productId, orderId] allows one per order — second is from a
  //  synthetic second order to demonstrate multiple approved reviews.)
  await prisma.review.create({
    data: {
      userId: demoUser.id,
      productId: raniId,
      orderId: order.id,
      rating: DEMO_REVIEWS[0].rating,
      comment: DEMO_REVIEWS[0].comment,
      isApproved: true,
    },
  });

  console.log("✅ Seed complete.");
  console.log(`   Demo user id=${demoUser.id} (demo@avcreation.test)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

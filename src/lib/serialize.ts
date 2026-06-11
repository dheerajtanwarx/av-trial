/* Serializers — map DB rows into the exact shapes the frontend's
   landing-data.ts already consumes (Product card, Category tile). */

import { inr, toNumber } from "./money";

type ProductWithImages = {
  slug: string;
  name: string;
  type: string | null;
  basePrice: unknown;
  comparePrice: unknown;
  badge: string | null;
  rating: number | null;
  images: { imageUrl: string; sortOrder: number; isPrimary: boolean }[];
  variants?: { stockQty: number }[];
};

export type ProductCard = {
  slug: string;
  name: string;
  type: string;
  price: string;
  was?: string;
  stars: string;
  flag?: { label: string; sale?: boolean };
  main: string;
  alt: string;
  soldOut?: boolean;
};

/** Render a star string like "★★★★★" / "★★★★☆" from a numeric rating. */
export function starsFor(rating: number | null): string {
  const full = Math.min(5, Math.max(0, Math.round(rating ?? 5)));
  return "★".repeat(full) + "☆".repeat(5 - full);
}

/** Map a DB product (with images) to the landing Product card shape. */
export function serializeProductCard(p: ProductWithImages): ProductCard {
  const base = toNumber(p.basePrice);
  const was = toNumber(p.comparePrice);
  const isSale = was > base;

  const imgs = [...p.images].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder
  );

  let flag: ProductCard["flag"];
  if (isSale) {
    flag = { label: p.badge ?? `Off ${Math.round((1 - base / was) * 100)}%`, sale: true };
  } else if (p.badge) {
    flag = { label: p.badge };
  }

  // Sold out only when variants were loaded and none has stock; products
  // queried without variants (or with no variants yet) stay purchasable.
  const soldOut =
    Array.isArray(p.variants) &&
    p.variants.length > 0 &&
    p.variants.every((v) => v.stockQty <= 0);

  return {
    slug: p.slug,
    name: p.name,
    type: p.type ?? "",
    price: inr(base),
    was: isSale ? inr(was) : undefined,
    stars: starsFor(p.rating),
    flag,
    main: imgs[0]?.imageUrl ?? "",
    alt: imgs[1]?.imageUrl ?? imgs[0]?.imageUrl ?? "",
    soldOut: soldOut || undefined,
  };
}

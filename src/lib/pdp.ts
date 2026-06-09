/* PDP builder — mirrors frontend/app/lib/pdp-data.ts.
   Core fields come from the DB; the boilerplate (accordion, size chart,
   craft band, look, distribution) is templated here and can be overridden
   per-product via Product.pdpOverride (JSON). */

import { inr, toNumber } from "./money";

export type PdpColor = { name: string; hex: string };
export type PdpReview = { stars: number; txt: string; name: string; loc: string };
export type AccordionItem = { q: string; a: string };
export type CraftSpec = { st: string; sv: string };
export type LookItem = { nm: string; ty: string; pr: string; image: string };
export type RelatedItem = {
  slug: string;
  nm: string;
  ty: string;
  pr: string;
  was?: string;
  image: string;
  flag?: string;
};

export type PdpProduct = {
  slug: string;
  name: string;
  navHot: string;
  crumb: string[];
  eyebrow: string;
  craft: string;
  galleryFlag?: string;
  rating: number;
  reviewCount: number;
  price: string;
  was?: string;
  off?: string;
  desc: string;
  images: string[];
  colors: PdpColor[];
  sizes: string[];
  sizeChart: string[][];
  accordion: AccordionItem[];
  reviews: PdpReview[];
  reviewDist: [string, number][];
  craftBand: {
    eyebrow: string;
    title: string;
    lead: string;
    specs: CraftSpec[];
    image: string;
  };
  lookImage: string;
  look: LookItem[];
  related: RelatedItem[];
};

/* ---- Shared defaults (ported verbatim from the frontend) ---- */
export const DEFAULT_COLORS: PdpColor[] = [
  { name: "Rani Pink", hex: "#bd3c6e" },
  { name: "Deep Maroon", hex: "#6e1f2e" },
  { name: "Emerald", hex: "#1d5042" },
  { name: "Royal Blue", hex: "#27406e" },
];

export const DEFAULT_SIZES = ["XS", "S", "M", "L", "XL"];

const DEFAULT_SIZE_CHART = [
  ["XS", "32", "26", "36"],
  ["S", "34", "28", "38"],
  ["M", "36", "30", "40"],
  ["L", "38", "33", "42"],
  ["XL", "40", "35", "44"],
];

const DEFAULT_ACCORDION: AccordionItem[] = [
  {
    q: "Delivery & Shipping",
    a: "Complimentary insured shipping across India; express worldwide delivery calculated at checkout. You will receive a tracking link the moment it leaves our Jaipur atelier.",
  },
  {
    q: "Returns & Exchange",
    a: "Easy <b>7-day returns</b> on ready sizes. As each piece is finished by hand, we are happy to arrange <b>one free alteration</b> for the perfect fit. Our stylist will guide you through every step.",
  },
  {
    q: "Fabric & Care",
    a: "Hand-finished with real <b>gota-patti</b> and traditional handwork. <b>Dry-clean only.</b> Store folded in the muslin pouch provided, away from direct sunlight, to keep the work luminous for generations.",
  },
];

const DEFAULT_REVIEWS: PdpReview[] = [
  {
    stars: 5,
    txt: "The handwork is even more luminous in person than in the photos. Drew compliments all evening — worth every rupee.",
    name: "Ananya R.",
    loc: "Verified · Jaipur",
  },
  {
    stars: 5,
    txt: "Heirloom quality and the colour is exactly as shown. The fit after a small alteration was flawless.",
    name: "Meghna S.",
    loc: "Verified · Mumbai",
  },
  {
    stars: 4,
    txt: "Stunning craftsmanship and the stylist was so patient with my measurements. Absolutely worth the short wait.",
    name: "Priya K.",
    loc: "Verified · Delhi",
  },
];

const DEFAULT_DIST: [string, number][] = [
  ["5★", 86],
  ["4★", 9],
  ["3★", 3],
  ["2★", 1],
  ["1★", 1],
];

const DEFAULT_LOOK: LookItem[] = [
  { nm: "Kundan Rani Odhni", ty: "Bandhej · Georgette", pr: "₹6,800", image: "" },
  { nm: "Polki Jhumka Set", ty: "Temple · 22k Gold-plate", pr: "₹3,200", image: "" },
  { nm: "Zari Embroidered Juttis", ty: "Handcrafted · Velvet", pr: "₹2,400", image: "" },
  { nm: "Silk Potli Clutch", ty: "Gota Patti · Raw Silk", pr: "₹1,900", image: "" },
];

/** Map a product to the nav link it belongs under (ported from frontend). */
export function navHotFor(name: string, type: string): string {
  const hay = `${name} ${type}`.toLowerCase();
  if (hay.includes("odhni") || hay.includes("dupatta")) return "Jaipuri Odhni";
  if (hay.includes("saree")) return "Saree";
  if (hay.includes("suit")) return "Suits";
  return "Lehenga";
}

/** Build the rating distribution as percentages from real review rows. */
export function buildReviewDist(
  ratings: number[]
): [string, number][] {
  if (ratings.length === 0) return DEFAULT_DIST;
  const buckets = [0, 0, 0, 0, 0]; // index 0 => 1★ ... 4 => 5★
  for (const r of ratings) {
    const i = Math.min(5, Math.max(1, Math.round(r))) - 1;
    buckets[i] += 1;
  }
  const total = ratings.length;
  return [
    ["5★", Math.round((buckets[4] / total) * 100)],
    ["4★", Math.round((buckets[3] / total) * 100)],
    ["3★", Math.round((buckets[2] / total) * 100)],
    ["2★", Math.round((buckets[1] / total) * 100)],
    ["1★", Math.round((buckets[0] / total) * 100)],
  ];
}

type BuildInput = {
  product: {
    slug: string;
    name: string;
    type: string | null;
    description: string | null;
    basePrice: unknown;
    comparePrice: unknown;
    badge: string | null;
    rating: number | null;
    reviewCount: number | null;
    sizes: unknown;
    pdpOverride: unknown;
  };
  images: string[];
  colors: PdpColor[];
  reviews: PdpReview[];
  reviewDist: [string, number][];
  related: RelatedItem[];
};

/** Compose the full PdpProduct shape the frontend expects. */
export function buildPdp(input: BuildInput): PdpProduct {
  const { product: p } = input;
  const type = p.type ?? "Handwork · Pure Silk";
  const navHot = navHotFor(p.name, type);
  const base = toNumber(p.basePrice);
  const was = toNumber(p.comparePrice);
  const hasWas = was > base;
  const off = hasWas ? `${Math.round((1 - base / was) * 100)}% Off` : undefined;

  const sizes = Array.isArray(p.sizes) && p.sizes.length
    ? (p.sizes as string[])
    : DEFAULT_SIZES;

  const heroImage = input.images[0] ?? "";

  const pdp: PdpProduct = {
    slug: p.slug,
    name: p.name,
    navHot,
    crumb: [navHot],
    eyebrow: navHot === "Lehenga" ? "The Atelier" : `${navHot} · The Atelier`,
    craft: type,
    galleryFlag: p.badge ?? undefined,
    rating: p.rating ?? 4.8,
    reviewCount: p.reviewCount ?? input.reviews.length,
    price: inr(base),
    was: hasWas ? inr(was) : undefined,
    off,
    desc:
      p.description ??
      "Hand-finished by our karigars across Jaipur, Sanganer and Bagru — a piece made to be worn, kept and remembered. Each one carries the small, beautiful irregularities of true handwork.",
    images: input.images,
    colors: input.colors.length ? input.colors : DEFAULT_COLORS,
    sizes,
    sizeChart: DEFAULT_SIZE_CHART,
    accordion: DEFAULT_ACCORDION,
    reviews: input.reviews.length ? input.reviews : DEFAULT_REVIEWS,
    reviewDist: input.reviewDist,
    craftBand: {
      eyebrow: "The House Craft",
      title: "Woven by hand, *over weeks*",
      lead: "Each piece begins as bare cloth on a Jaipur worktable. Our karigars block, dye and embroider every motif by hand — so no two are ever quite alike.",
      specs: [
        { st: "Technique", sv: type.split(" · ")[0] ?? "Handwork" },
        { st: "Base Fabric", sv: type.split(" · ")[1] ?? "Pure Silk" },
        { st: "Crafting Time", sv: "Approx. 3 weeks" },
        { st: "Finish", sv: "Hand-finished in Jaipur" },
      ],
      image: heroImage,
    },
    lookImage: input.images[1] ?? heroImage,
    look: DEFAULT_LOOK.map((l) => ({ ...l, image: l.image || heroImage })),
    related: input.related,
  };

  // Per-product authored overrides (e.g. the Rani Bagh bridal showcase).
  const override =
    p.pdpOverride && typeof p.pdpOverride === "object"
      ? (p.pdpOverride as Partial<PdpProduct>)
      : null;

  return override ? { ...pdp, ...override } : pdp;
}

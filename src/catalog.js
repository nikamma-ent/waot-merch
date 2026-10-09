// ─────────────────────────────────────────────────────────────
// EDIT THIS FILE to set prices, designs, dates and stock.
// Everything the site shows and charges comes from here.
// ─────────────────────────────────────────────────────────────

export const TOUR = {
  artist: "Begum",
  name: "We Are Okay! Tour",
};

// Order matches the tour routing.
// code: short name shown big on the city tiles, like the poster.
// date: what fans see. null shows "Date soon".
// ordersCloseAt: when pre-orders stop for that city (IST).
//   e.g. "2026-09-30T23:59:00+05:30". null keeps it open.
export const CITIES = [
  { id: "delhi",     code: "DEL", name: "Delhi",     venue: "Odella",           date: "9th Oct",  ordersCloseAt: "2026-10-09T15:55:00+05:30" },
  { id: "goa",       code: "GOA", name: "Goa",       venue: "Hideaway",         date: "10th Oct", ordersCloseAt: "2026-10-09T15:55:00+05:30" },
  { id: "mumbai",    code: "MUM", name: "Mumbai",    venue: "Raasta",           date: "15th Oct", ordersCloseAt: null },
  { id: "bangalore", code: "BLR", name: "Bangalore", venue: "The Humming Tree", date: "16th Oct", ordersCloseAt: null },
];

export const SIZES = ["S", "M", "L", "XL", "XXL"];

// price: pre-order price in rupees (what the site charges).
// venuePrice: what the same tee costs at the merch table on the night.
//   Shown crossed out so fans see the saving. null hides it.
// image / imageBack: paths under docs/waot-merch, e.g. "img/tee-a.jpg" (no leading
//   slash). imageBack adds a Front/Back switch; null hides it.
// With no image, the site draws a plain tee in `color`.
export const DESIGNS = [
  {
    id: "tee-a",
    name: "We Are Okay! Tour Tee",
    blurb: "180 GSM single jersey knit fabric, 100% cotton. Oversized fit. Bio-washed for a soft finish, with embroidered flowers.",
    price: 1500,
    venuePrice: null,
    image: "img/tee-tour-front.jpg",
    imageBack: "img/tee-tour-back.jpg",
    color: "#E0B32A",
  },
  {
    id: "tee-b",
    name: "All My Friends Tee",
    blurb: "100% ring-spun super combed cotton, 240 GSM single jersey knit. Sky blue optic wash, with embroidered flowers.",
    price: 1500,
    venuePrice: null,
    image: "img/tee-amfs-blue.jpg",
    imageBack: null,
    color: "#5B87C5",
  },
];

// Size chart in inches, shown under the tees. null hides it.
// Get these from your printer before launch.
export const SIZE_CHART = null;
// export const SIZE_CHART = {
//   S:   { chest: 38, length: 27 },
//   M:   { chest: 40, length: 28 },
//   L:   { chest: 42, length: 29 },
//   XL:  { chest: 44, length: 30 },
//   XXL: { chest: 46, length: 31 },
// };

// Stock caps per city, design and size. null = unlimited (print to order).
// Each city has its own pool: a sale in Delhi doesn't touch Goa's stock.
// An "all" entry instead would be one pool shared by every show.
// Leave out a design/size to make it unlimited; 0 means sold out.
// 50 per design across the tour: S 10, M 14, L 14, XL 8, XXL 4.
const PER_CITY = {
  delhi:     { S: 3, M: 4, L: 4, XL: 2, XXL: 1 }, // 14
  goa:       { S: 2, M: 3, L: 3, XL: 2, XXL: 0 }, // 10
  mumbai:    { S: 2, M: 3, L: 3, XL: 2, XXL: 1 }, // 11
  bangalore: { S: 3, M: 4, L: 4, XL: 2, XXL: 2 }, // 15
};

// Same split for both tees.
export const STOCK_CAPS = Object.fromEntries(
  Object.entries(PER_CITY).map(([city, sizes]) => [city, { "tee-a": sizes, "tee-b": sizes }])
);

export const LIMITS = { maxPerLine: 5, maxPerOrder: 10 };

// How long an unpaid order holds stock. Razorpay checkout times out at 15 min.
export const HOLD_MINUTES = 20;

// ── helpers ───────────────────────────────────────────────────
export const findCity = (id) => CITIES.find((c) => c.id === id);
export const findDesign = (id) => DESIGNS.find((d) => d.id === id);
export const sku = (city, design, size) => `${city}:${design}:${size}`;

export function isCityOpen(city, now = Date.now()) {
  return !city.ordersCloseAt || now < Date.parse(city.ordersCloseAt);
}

export function capFor(pool, design, size) {
  const v = STOCK_CAPS?.[pool]?.[design]?.[size];
  return typeof v === "number" ? v : null;
}

// Which stock counter an item for this city draws from, and its cap.
export function stockFor(city, design, size) {
  const pool = capFor(city, design, size) !== null ? city : capFor("all", design, size) !== null ? "all" : city;
  return { key: sku(pool, design, size), cap: capFor(pool, design, size) };
}

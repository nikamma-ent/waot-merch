import { CITIES, DESIGNS, SIZES, HOLD_MINUTES, stockFor, findCity, findDesign } from "./catalog.js";

// Stock is tracked as a "held" count per pool/design/size (pool = a city, or
// "all" for the tour-wide pool; see STOCK_CAPS).
// Pending orders hold stock; paid orders keep it; expired orders give it back.

export async function reserve(db, city, items) {
  const done = [];
  for (const it of items) {
    const { key, cap } = stockFor(city, it.design, it.size);
    await db.prepare("INSERT INTO stock (sku, held) VALUES (?1, 0) ON CONFLICT(sku) DO NOTHING").bind(key).run();
    // Single conditional UPDATE, so two buyers can't grab the last one at once.
    const r =
      cap === null
        ? await db.prepare("UPDATE stock SET held = held + ?1 WHERE sku = ?2").bind(it.qty, key).run()
        : await db.prepare("UPDATE stock SET held = held + ?1 WHERE sku = ?2 AND held + ?1 <= ?3").bind(it.qty, key, cap).run();
    if (r.meta.changes !== 1) {
      await release(db, city, done);
      return { ok: false, soldOut: it };
    }
    done.push(it);
  }
  return { ok: true };
}

export async function release(db, city, items) {
  if (!items.length) return;
  await db.batch(
    items.map((it) =>
      db.prepare("UPDATE stock SET held = MAX(held - ?1, 0) WHERE sku = ?2").bind(it.qty, stockFor(city, it.design, it.size).key)
    )
  );
}

export async function itemsFor(db, orderId) {
  const { results } = await db
    .prepare("SELECT design, size, qty, unit_price FROM order_items WHERE order_id = ?1 ORDER BY design, size")
    .bind(orderId)
    .all();
  return results;
}

export async function sweepExpired(db, now = Date.now()) {
  const cutoff = now - HOLD_MINUTES * 60 * 1000;
  const { results } = await db
    .prepare("SELECT id, city FROM orders WHERE status = 'pending' AND created_at < ?1 LIMIT 50")
    .bind(cutoff)
    .all();
  for (const o of results) {
    const items = await itemsFor(db, o.id);
    // One batch = one transaction: stock goes back and the order flips to
    // expired together, or not at all. Each stock line only applies while the
    // order is still pending, so a second sweep racing this one does nothing.
    await db.batch([
      ...items.map((it) =>
        db
          .prepare(
            "UPDATE stock SET held = MAX(held - ?1, 0) WHERE sku = ?2 AND EXISTS (SELECT 1 FROM orders WHERE id = ?3 AND status = 'pending')"
          )
          .bind(it.qty, stockFor(o.city, it.design, it.size).key, o.id)
      ),
      db.prepare("UPDATE orders SET status = 'expired' WHERE id = ?1 AND status = 'pending'").bind(o.id),
    ]);
  }
}

export async function availability(db) {
  const { results } = await db.prepare("SELECT sku, held FROM stock").all();
  const held = Object.fromEntries(results.map((r) => [r.sku, r.held]));
  const out = {};
  for (const c of CITIES) {
    out[c.id] = {};
    for (const d of DESIGNS) {
      out[c.id][d.id] = {};
      for (const s of SIZES) {
        const { key, cap } = stockFor(c.id, d.id, s);
        out[c.id][d.id][s] = cap === null ? null : Math.max(cap - (held[key] || 0), 0);
      }
    }
  }
  return out;
}

export function itemsSummary(items) {
  return items.map((i) => `${findDesign(i.design)?.name || i.design} / ${i.size} x${i.qty}`).join(", ");
}

export function publicOrder(order, items) {
  const city = findCity(order.city);
  return {
    code: order.id,
    status: order.status,
    city: city?.name,
    venue: city?.venue,
    date: city?.date,
    name: order.name,
    email: order.email,
    amount: order.amount / 100,
    items: items.map((i) => ({ design: findDesign(i.design)?.name || i.design, size: i.size, qty: i.qty })),
  };
}

// Idempotent: safe to call from both the browser callback and the webhook.
export async function markPaid(env, ctx, rzpOrderId, paymentId) {
  const db = env.DB;
  const order = await db.prepare("SELECT * FROM orders WHERE rzp_order_id = ?1").bind(rzpOrderId).first();
  if (!order) return null;
  if (order.status === "paid") return order;

  const now = Date.now();
  const items = await itemsFor(db, order.id);
  // Same idea as sweepExpired: if the hold had lapsed but the money came in,
  // take the stock back (may go over a cap) in the same transaction that marks
  // it paid. Stock lines only apply if the order is expired at that moment, so
  // this is also right when a sweep expires it between our read and this write.
  const results = await db.batch([
    ...items.map((it) =>
      db
        .prepare(
          "INSERT INTO stock (sku, held) SELECT ?2, ?1 WHERE EXISTS (SELECT 1 FROM orders WHERE id = ?3 AND status = 'expired') ON CONFLICT(sku) DO UPDATE SET held = held + ?1"
        )
        .bind(it.qty, stockFor(order.city, it.design, it.size).key, order.id)
    ),
    db
      .prepare("UPDATE orders SET status = 'paid', rzp_payment_id = ?1, paid_at = ?2 WHERE id = ?3 AND status IN ('pending', 'expired')")
      .bind(paymentId, now, order.id),
  ]);

  if (results[results.length - 1].meta.changes === 1) {
    const paid = { ...order, status: "paid", rzp_payment_id: paymentId, paid_at: now };
    if (env.SHEET_WEBHOOK_URL) {
      ctx.waitUntil(pushToSheet(env, paid, items).catch((e) => console.error("Sheet sync failed", e)));
    }
    return paid;
  }
  return db.prepare("SELECT * FROM orders WHERE id = ?1").bind(order.id).first();
}

export async function pushToSheet(env, order, items) {
  const city = findCity(order.city);
  const res = await fetch(env.SHEET_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({
      token: env.SHEET_TOKEN,
      code: order.id,
      city: city?.name || order.city,
      venue: city?.venue || "",
      name: order.name,
      phone: order.phone,
      email: order.email,
      items: itemsSummary(items),
      quantity: items.reduce((n, i) => n + i.qty, 0),
      amount: order.amount / 100,
      paymentId: order.rzp_payment_id,
      paidAt: new Date(order.paid_at).toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`Sheet responded ${res.status}`);
}

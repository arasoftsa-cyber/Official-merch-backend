const registerAdminSeedRoutes = (router, deps) => {
  const {
    REGISTER_TEST_SEED_ROUTES,
    requireAuth,
    express,
    TEST_SEEDS_ENABLED,
    ensureAdmin,
    MAX_SEEDED_ORDERS,
    getDb,
    ensureArtistForSeed,
    ensureProductVariantForSeed,
    randomUUID,
    TEST_BUYER_ID,
  } = deps;

  if (!REGISTER_TEST_SEED_ROUTES) return;

  router.post(
    "/test/seed-orders",
    requireAuth,
    express.json(),
    async (req, res, next) => {
      if (!TEST_SEEDS_ENABLED) {
        return res.status(404).json({ error: "not_found" });
      }
      if (!ensureAdmin(req, res)) return;
      try {
        const body = req.body || {};
        const requestedPlaced = Number(body.placedCount ?? 15);
        const requestedPaid = Number(body.paidCount ?? 0);
        const placedCount = Math.min(
          Math.max(requestedPlaced, 1),
          MAX_SEEDED_ORDERS
        );
        const paidCount = Math.min(
          Math.max(requestedPaid, 0),
          placedCount
        );
        const db = getDb();
        const artist = await ensureArtistForSeed(db);
        const variant = await ensureProductVariantForSeed(
          db,
          artist.id,
          placedCount + paidCount + 5
        );
        const createdOrderIds = [];
        for (let idx = 0; idx < placedCount; idx += 1) {
          const orderId = randomUUID();
          const now = db.fn.now();
          await db.transaction(async (trx) => {
            await trx("orders").insert({
              id: orderId,
              buyer_user_id: TEST_BUYER_ID,
              status: "placed",
              total_cents: variant.selling_price_cents ?? variant.price_cents,
              created_at: now,
              updated_at: now,
            });
            await trx("inventory_skus")
              .where({ id: variant.inventory_sku_id })
              .update({
                stock: trx.raw("stock - 1"),
                updated_at: now,
              });
            await trx("payments").insert({
              id: randomUUID(),
              order_id: orderId,
              status: idx < paidCount ? "paid" : "unpaid",
              provider: "mock",
              amount_cents: variant.selling_price_cents ?? variant.price_cents,
              currency: "USD",
              created_at: now,
              updated_at: now,
            });
            await trx("order_items").insert({
              id: randomUUID(),
              order_id: orderId,
              product_id: variant.product_id,
              product_variant_id: variant.id,
              quantity: 1,
              price_cents: variant.selling_price_cents ?? variant.price_cents,
              created_at: now,
            });
            await trx("order_events").insert({
              id: randomUUID(),
              order_id: orderId,
              type: "placed",
              actor_user_id: req.user.id,
              created_at: now,
            });
          });
          createdOrderIds.push(orderId);
        }
        return res.json({
          createdPlaced: placedCount,
          createdPaid: paidCount,
          sampleOrderIds: createdOrderIds.slice(0, 5),
        });
      } catch (err) {
        next(err);
      }
    }
  );
};

module.exports = { registerAdminSeedRoutes };

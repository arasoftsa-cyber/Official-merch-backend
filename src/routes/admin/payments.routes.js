const registerAdminPaymentRoutes = (router, deps) => {
  const {
    requireAuth,
    ensureAdmin,
    getDb,
    PAYMENT_NOT_FOUND,
    listFlags,
  } = deps;

  router.get("/payments", requireAuth, async (req, res, next) => {
    try {
      if (!ensureAdmin(req, res)) return;
      const db = getDb();
      const status = req.query.status;
      let limit = parseInt(req.query.limit, 10);
      let offset = parseInt(req.query.offset, 10);
      if (Number.isNaN(limit) || limit <= 0) limit = 50;
      if (limit > 200) limit = 200;
      if (Number.isNaN(offset) || offset < 0) offset = 0;

      const query = db("payments").select(
        "id",
        "order_id",
        "status",
        "provider",
        "amount_cents",
        "currency",
        "provider_order_id",
        "provider_payment_id",
        "paid_at",
        "created_at",
        "updated_at"
      );
      if (status) {
        query.where({ status });
      }
      const payments = await query.orderBy("created_at", "desc").limit(limit).offset(offset);

      res.json({
        items: payments.map((row) => ({
          paymentId: row.id,
          orderId: row.order_id,
          status: row.status,
          provider: row.provider,
          amountCents: row.amount_cents,
          currency: row.currency,
          providerOrderId: row.provider_order_id,
          providerPaymentId: row.provider_payment_id,
          paidAt: row.paid_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        limit,
        offset,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/payments/:paymentId/events", requireAuth, async (req, res, next) => {
    try {
      if (!ensureAdmin(req, res)) return;
      const db = getDb();
      const paymentId = req.params.paymentId;
      if (!paymentId) {
        return res.status(404).json(PAYMENT_NOT_FOUND);
      }
      const payment = await db("payments").where({ id: paymentId }).first();
      if (!payment) {
        return res.status(404).json(PAYMENT_NOT_FOUND);
      }
      const events = await db("payment_events")
        .where({ payment_id: paymentId })
        .orderBy("created_at", "asc")
        .select(
          "id",
          "event_type",
          "provider",
          "provider_event_id",
          "created_at",
          "payload_json"
        );
      res.json({
        items: events.map((row) => ({
          id: row.id,
          eventType: row.event_type,
          provider: row.provider,
          providerEventId: row.provider_event_id,
          createdAt: row.created_at,
          payload: row.payload_json,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/abuse-flags", requireAuth, async (req, res, next) => {
    try {
      if (!ensureAdmin(req, res)) return;
      res.json({
        items: listFlags(),
      });
    } catch (err) {
      next(err);
    }
  });
};

module.exports = { registerAdminPaymentRoutes };

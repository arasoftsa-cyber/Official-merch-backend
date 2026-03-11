const registerOrderReadRoutes = (router, deps) => {
  const {
    requireAuth,
    requireBuyer,
    listOrdersHandler,
    rejectIfNotBuyer,
    getDb,
    fail,
    ORDER_NOT_FOUND,
    FORBIDDEN,
    ok,
    formatItem,
    formatEvent,
  } = deps;

router.get("/my", requireAuth, requireBuyer, listOrdersHandler);

router.get("/", requireAuth, requireBuyer, listOrdersHandler);

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    if (!rejectIfNotBuyer(req, res)) return;
    const db = getDb();
    const order = await db("orders").where({ id: req.params.id }).first();
    if (!order) {
      return fail(res, 404, ORDER_NOT_FOUND, "Order not found");
    }
    if (order.buyer_user_id !== req.user.id) {
      return fail(res, 403, FORBIDDEN, "Forbidden");
    }
    const items = await db("order_items").where({ order_id: order.id }).select();
    const paymentRow = await db("payments")
      .where({ order_id: order.id })
      .select("id", "status", "created_at")
      .orderBy("created_at", "desc")
      .first();
    const payment = paymentRow
      ? { status: paymentRow.status, attemptId: paymentRow.id }
      : { status: "unpaid", attemptId: null };
    ok(res, {
      id: order.id,
      status: order.status,
      totalCents: order.total_cents,
      createdAt: order.created_at,
      items: items.map(formatItem),
      payment,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/events", requireAuth, async (req, res, next) => {
  try {
    if (!rejectIfNotBuyer(req, res)) return;
    const db = getDb();
    const order = await db("orders").where({ id: req.params.id }).first();
    if (!order) {
      return fail(res, 404, ORDER_NOT_FOUND, "Order not found");
    }
    if (order.buyer_user_id !== req.user.id) {
      return fail(res, 403, FORBIDDEN, "Forbidden");
    }
    const events = await db("order_events")
      .where({ order_id: order.id })
      .orderBy("created_at", "asc");
    ok(res, {
      items: events.map(formatEvent),
    });
  } catch (err) {
    next(err);
  }
});
};

module.exports = { registerOrderReadRoutes };

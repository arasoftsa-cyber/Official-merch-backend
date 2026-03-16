const registerAdminOrderRoutes = (router, deps) => {
  const {
    requireAuth,
    requirePolicy,
    getDb,
    formatOrder,
    formatItem,
    formatEvent,
    ORDER_NOT_FOUND,
    ORDER_NOT_FULFILLABLE,
    ORDER_NOT_PAID,
    ORDER_NOT_REFUNDABLE,
    sendShipmentDispatchedEmailBestEffort,
    sendOrderStatusUpdateEmailBestEffort,
  } = deps;

  const requireAdminOrdersRead = requirePolicy("admin_dashboard:read", "orders");
  const requireAdminOrdersWrite = requirePolicy("admin_dashboard:write", "orders");

  router.get(
    "/dashboard/orders",
    requireAuth,
    requireAdminOrdersRead,
    async (req, res, next) => {
      try {
        const db = getDb();
        const rows = await db("orders")
          .leftJoin("order_items", "order_items.order_id", "orders.id")
          .select(
            "orders.id as orderId",
            "orders.status as status",
            "orders.total_cents as totalCents",
            "orders.created_at as createdAt",
            "orders.buyer_user_id as buyerUserId",
            db.raw("COUNT(order_items.id) as itemsCount")
          )
          .groupBy(
            "orders.id",
            "orders.status",
            "orders.total_cents",
            "orders.created_at",
            "orders.buyer_user_id"
          )
          .orderBy("orders.created_at", "desc")
          .limit(50);

        const items = rows.map((row) => ({
          orderId: row.orderId,
          status: row.status,
          totalCents: Number(row.totalCents ?? 0),
          createdAt: row.createdAt
            ? new Date(row.createdAt).toISOString()
            : null,
          buyerUserId: row.buyerUserId,
          itemsCount: Number(row.itemsCount ?? 0),
        }));

        res.json({ items });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get("/orders", requireAuth, requireAdminOrdersRead, async (req, res, next) => {
    try {
      const db = getDb();
      const hasLimitOffset =
        typeof req.query.limit !== "undefined" ||
        typeof req.query.offset !== "undefined";

      const toInt = (value, fallback) => {
        const parsed = Number.parseInt(String(value ?? ""), 10);
        return Number.isNaN(parsed) ? fallback : parsed;
      };

      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

      let page = 1;
      let pageSize = 25;
      let offset = 0;

      if (hasLimitOffset) {
        const limitRaw = toInt(req.query.limit, 25);
        const offsetRaw = toInt(req.query.offset, 0);
        pageSize = clamp(limitRaw, 1, 100);
        offset = Math.max(offsetRaw, 0);
        page = Math.floor(offset / pageSize) + 1;
      } else {
        const pageRaw = toInt(req.query.page, 1);
        const pageSizeRaw = toInt(req.query.pageSize, 25);
        page = Math.max(pageRaw, 1);
        pageSize = clamp(pageSizeRaw, 1, 100);
        offset = (page - 1) * pageSize;
      }

      const baseQuery = db("orders");

      const totalRow = await baseQuery
        .clone()
        .clearSelect()
        .clearOrder()
        .count({ count: "*" })
        .first();
      const total = Number(
        totalRow?.count ??
          totalRow?.["count(*)"] ??
          totalRow?.["count"] ??
          totalRow?.["COUNT(*)"] ??
          0
      );
      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      const orders = await baseQuery
        .clone()
        .select("id", "status", "total_cents", "created_at", "buyer_user_id")
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(pageSize)
        .offset(offset);

      const orderIds = orders.map((order) => order.id);
      let counts = [];
      if (orderIds.length) {
        counts = await db("order_items")
          .whereIn("order_id", orderIds)
          .groupBy("order_id")
          .select("order_id")
          .count("id as itemsCount");
      }

      const countMap = counts.reduce((acc, row) => {
        acc[row.order_id] = Number(row.itemsCount);
        return acc;
      }, {});

      res.json({
        items: orders.map((order) => ({
          ...formatOrder(order),
          itemsCount: countMap[order.id] || 0,
        })),
        page: {
          total,
          limit: pageSize,
          offset,
          totalPages,
        },
        total,
        totalPages,
        pageSize,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/orders/:id", requireAuth, requireAdminOrdersRead, async (req, res, next) => {
    try {
      const db = getDb();
      const order = await db("orders").where({ id: req.params.id }).first();
      if (!order) {
        return res.status(404).json(ORDER_NOT_FOUND);
      }
      const items = await db("order_items").where({ order_id: order.id }).select();
      const payment = await db("payments")
        .where({ order_id: order.id })
        .select("id", "status", "provider")
        .first();
      res.json({
        ...formatOrder(order),
        items: items.map(formatItem),
        payment: payment
          ? {
              paymentId: payment.id,
              status: payment.status,
              provider: payment.provider,
            }
          : null,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/orders/:id/events", requireAuth, requireAdminOrdersRead, async (req, res, next) => {
    try {
      const db = getDb();
      const order = await db("orders").where({ id: req.params.id }).first();
      if (!order) {
        return res.status(404).json(ORDER_NOT_FOUND);
      }
      const events = await db("order_events")
        .where({ order_id: order.id })
        .orderBy("created_at", "asc");
      res.json({
        items: events.map(formatEvent),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/orders/:id/fulfill", requireAuth, requireAdminOrdersWrite, async (req, res, next) => {
    try {
      const db = getDb();
      const orderId = req.params.id;
      const order = await db("orders").where({ id: orderId }).first();
      if (!order) {
        return res.status(404).json(ORDER_NOT_FOUND);
      }
      if (order.status !== "placed") {
        return res.status(400).json(ORDER_NOT_FULFILLABLE);
      }
      const payment = await db("payments")
        .where({ order_id: orderId })
        .orderBy("created_at", "desc")
        .first();
      if (!payment || payment.status !== "paid") {
        return res.status(400).json(ORDER_NOT_PAID);
      }

      const result = await db.transaction(async (trx) => {
        const now = trx.fn.now();
        await trx("orders").where({ id: orderId }).update({
          status: "fulfilled",
          updated_at: now,
        });
        const items = await trx("order_items").where({ order_id: orderId }).select();
        await trx("order_events").insert({
          order_id: orderId,
          type: "fulfilled",
          actor_user_id: req.user.id,
        });
        const updatedOrder = await trx("orders").where({ id: orderId }).first();
        return { order: updatedOrder, items };
      });
      const carrier = String(req.body?.carrier || req.body?.courier || "").trim();
      const trackingNumber = String(
        req.body?.trackingNumber || req.body?.tracking_number || ""
      ).trim();
      const trackingUrl = String(req.body?.trackingUrl || req.body?.tracking_url || "").trim();

      res.json({
        ...formatOrder(result.order),
        items: result.items.map(formatItem),
      });
      void sendShipmentDispatchedEmailBestEffort({
        db,
        orderId,
        buyerUserId: result.order?.buyer_user_id || order.buyer_user_id,
        carrier,
        trackingNumber,
        trackingUrl,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/orders/:id/refund", requireAuth, requireAdminOrdersWrite, async (req, res, next) => {
    try {
      const db = getDb();
      const orderId = req.params.id;
      const order = await db("orders").where({ id: orderId }).first();
      if (!order) {
        return res.status(404).json(ORDER_NOT_FOUND);
      }
      const payment = await db("payments")
        .where({ order_id: orderId })
        .orderBy("created_at", "desc")
        .first();
      if (!payment || payment.status !== "paid") {
        return res.status(400).json(ORDER_NOT_REFUNDABLE);
      }
      await db.transaction(async (trx) => {
        const now = trx.fn.now();
        await trx("payments").where({ id: payment.id }).update({
          status: "refunded",
          updated_at: now,
        });
        const existingRefundedEvent = await trx("order_events")
          .where({ order_id: orderId, type: "refunded" })
          .first("id");
        if (!existingRefundedEvent) {
          await trx("order_events").insert({
            order_id: orderId,
            type: "refunded",
            actor_user_id: req.user.id,
            created_at: now,
          });
        }
      });
      void sendOrderStatusUpdateEmailBestEffort({
        db,
        orderId,
        buyerUserId: order.buyer_user_id,
        status: "refunded",
        message: "A refund has been issued for your order.",
      });
      return res.json({ ok: true, status: "refunded" });
    } catch (err) {
      next(err);
    }
  });
};

module.exports = { registerAdminOrderRoutes };

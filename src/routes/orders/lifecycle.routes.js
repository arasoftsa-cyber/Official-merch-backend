const registerOrderLifecycleRoutes = (router, deps) => {
  const {
    requireAuth,
    express,
    paymentLimiter,
    rejectIfNotBuyer,
    getDb,
    fail,
    ORDER_NOT_FOUND,
    FORBIDDEN,
    ORDER_ALREADY_CANCELLED,
    ORDER_NOT_CANCELLABLE,
    ok,
    formatItem,
    sendOrderStatusUpdateEmailBestEffort,
    startPaymentForOrder,
    ORDER_NOT_PAYABLE,
    getSystemCurrency,
    assertSupportedCurrency,
    CURRENCY_MISMATCH,
    normalizeOrderPaymentPayload,
  } = deps;

router.post("/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    if (!rejectIfNotBuyer(req, res)) return;
    const db = getDb();
    const orderId = req.params.id;
    const fetchOrder = async () =>
      db("orders").where({ id: orderId }).first();
    let order = await fetchOrder();
    if (!order) {
      let attempts = 0;
      while (!order && attempts < 5) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        order = await fetchOrder();
        attempts += 1;
      }
    }
    if (!order) {
      return fail(res, 404, ORDER_NOT_FOUND, "Order not found");
    }
    if (order.buyer_user_id !== req.user.id) {
      return fail(res, 403, FORBIDDEN, "Forbidden");
    }
    const items = await db("order_items")
      .where({ order_id: orderId })
      .select(
        "id",
        "product_id",
        "product_variant_id",
        "inventory_sku_id",
        "quantity",
        "price_cents",
        "created_at"
      );

    if (order.status === "cancelled") {
      return fail(res, 400, ORDER_ALREADY_CANCELLED, "Order is already cancelled");
    }

    if (order.status !== "placed" && order.status !== "unpaid") {
      return fail(res, 400, ORDER_NOT_CANCELLABLE, "Order is not cancellable");
    }

    const canceled = await db.transaction(async (trx) => {
      const now = trx.fn.now();
      await trx("orders").where({ id: orderId }).update({
        status: "cancelled",
        updated_at: now,
      });
      const items = await trx("order_items")
        .where({ order_id: orderId })
        .select(
          "id",
          "product_id",
          "product_variant_id",
          "inventory_sku_id",
          "quantity",
          "price_cents",
          "created_at"
        );

      const unresolvedVariantIds = items
        .filter((item) => !item.inventory_sku_id && item.product_variant_id)
        .map((item) => item.product_variant_id);
      const fallbackSkuMap = new Map();
      if (unresolvedVariantIds.length > 0) {
        const variantRows = await trx("product_variants")
          .select("id", "inventory_sku_id")
          .whereIn("id", unresolvedVariantIds);
        for (const row of variantRows) {
          if (row?.id && row?.inventory_sku_id) {
            fallbackSkuMap.set(row.id, row.inventory_sku_id);
          }
        }
      }

      for (const item of items) {
        const inventorySkuId =
          item.inventory_sku_id || fallbackSkuMap.get(item.product_variant_id) || null;
        if (!inventorySkuId) continue;
        await trx("inventory_skus")
          .where({ id: inventorySkuId })
          .update({
            stock: trx.raw("stock + ?", [item.quantity]),
            updated_at: now,
          });
      }

      await trx("order_events").insert({
        order_id: orderId,
        type: "cancelled",
        actor_user_id: req.user.id,
      });

      const updatedOrder = await trx("orders").where({ id: orderId }).first();
      return { order: updatedOrder, items };
    });

    ok(res, {
      id: canceled.order.id,
      status: canceled.order.status,
      totalCents: canceled.order.total_cents,
      createdAt: canceled.order.created_at,
      items: canceled.items.map(formatItem),
    });
    void sendOrderStatusUpdateEmailBestEffort({
      db,
      user: req.user,
      orderId,
      status: "cancelled",
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/pay", requireAuth, express.json(), paymentLimiter, async (req, res, next) => {
  try {
    if (!rejectIfNotBuyer(req, res)) return;
    let currency;
    try {
      const normalized = normalizeOrderPaymentPayload(req.body || {});
      currency = assertSupportedCurrency(normalized.dto.currency, {
        allowDefaultOnEmpty: true,
      });
    } catch (currencyErr) {
      if (currencyErr?.code === "CURRENCY_MISMATCH") {
        return fail(
          res,
          400,
          CURRENCY_MISMATCH,
          "Currency does not match the configured system currency.",
          currencyErr.details
        );
      }
      throw currencyErr;
    }
    if (!req.body?.currency) {
      console.info("[orders.currency]", {
        event: "currency_autoinjected",
        currency: currency || getSystemCurrency(),
      });
    }
    const result = await startPaymentForOrder({
      knex: getDb(),
      orderId: req.params.id,
      buyerUserId: req.user.id,
      currency,
    });
    const paymentId = result.paymentId;
    const confirmPath = paymentId
      ? `/api/payments/mock/confirm/${paymentId}`
      : null;
    return ok(res, {
      ok: true,
      paymentId,
      status: result.status,
      attemptId: paymentId,
      confirmPath,
      mock: confirmPath ? { confirmPath } : null,
    });
  } catch (error) {
    if (error.code === "ORDER_NOT_FOUND") {
      return fail(res, 404, ORDER_NOT_FOUND, "Order not found");
    }
    if (error.code === "ORDER_NOT_PAYABLE") {
      return fail(res, 400, ORDER_NOT_PAYABLE, "Order is not payable");
    }
    if (error.code === "CURRENCY_MISMATCH") {
      return fail(
        res,
        400,
        CURRENCY_MISMATCH,
        "Currency does not match the configured system currency.",
        error.details
      );
    }
    next(error);
  }
});

};

module.exports = { registerOrderLifecycleRoutes };

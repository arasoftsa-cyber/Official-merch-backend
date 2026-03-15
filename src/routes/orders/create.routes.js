const registerOrderCreateRoutes = (router, deps) => {
  const {
    requireAuth,
    requireBuyer,
    express,
    orderCreateLimiter,
    orderSpamGuard,
    isBuyer,
    fail,
    FORBIDDEN,
    rejectIfNotBuyer,
    VALIDATION_ERROR,
    getDb,
    getOrderItemColumns,
    reserveInventoryForLine,
    randomUUID,
    buildOrderItemInsertPayload,
    ok,
    formatOrder,
    formatItem,
    sendOrderConfirmationEmailBestEffort,
    PRODUCT_NOT_FOUND,
    OUT_OF_STOCK,
    normalizeCreateOrderPayload,
    validateCreateOrderPayload,
    assertSupportedCurrency,
    CURRENCY_MISMATCH,
    logLegacyContractUse,
  } = deps;

router.post(
    "/",
    requireAuth,
    requireBuyer,
    express.json(),
    orderCreateLimiter,
    orderSpamGuard,
    async (req, res, next) => {
      if (!isBuyer(req.user)) {
        return fail(res, 403, FORBIDDEN, "Forbidden");
      }
      console.log(
        "[DBG orders POST]",
        "file=orders/create.routes.js",
        "role=",
        req.user?.role || req.user?.userRole,
        "userId=",
        req.user?.id,
        "url=",
        req.originalUrl
      );
      try {
        if (!rejectIfNotBuyer(req, res)) return;
        let payload;
        try {
          const normalized = normalizeCreateOrderPayload(req.body || {});
          logLegacyContractUse({
            workflow: "orders.create",
            legacyKeys: normalized.meta.legacyKeys,
          });
          payload = validateCreateOrderPayload(normalized.dto);
          payload.currency = assertSupportedCurrency(payload.currency, {
            allowDefaultOnEmpty: true,
          });
        } catch (contractErr) {
          if (contractErr?.name === "ZodError") {
            return fail(res, 400, VALIDATION_ERROR, "Invalid order payload.", {
              details: contractErr.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            });
          }
          if (contractErr?.code === "CURRENCY_MISMATCH") {
            return fail(
              res,
              400,
              CURRENCY_MISMATCH,
              "Currency does not match the configured system currency.",
              contractErr.details
            );
          }
          if (contractErr?.code === "validation_error") {
            return fail(res, 400, VALIDATION_ERROR, contractErr.message, {
              details: contractErr.details || [],
            });
          }
          throw contractErr;
        }
        if (!req.body?.currency) {
          console.info("[orders.currency]", {
            event: "currency_autoinjected",
            currency: payload.currency,
          });
        }

        const db = getDb();
        const order = await db.transaction(async (trx) => {
          const now = trx.fn.now();
          let totalCents = 0;
          const details = [];
          const orderItemColumns = await getOrderItemColumns(trx);
          for (const line of payload.items) {
            const variant = await reserveInventoryForLine({ trx, line, now });
            const linePriceCents = Number(variant.selling_price_cents ?? 0);
            totalCents += linePriceCents * line.quantity;
            details.push({ line, variant, orderItemColumns });
          }
          const orderId = randomUUID();
          await trx("orders").insert({
            id: orderId,
            buyer_user_id: req.user.id,
            status: "placed",
            total_cents: totalCents,
            created_at: now,
            updated_at: now,
          });

          await trx("payments")
            .insert({
              order_id: orderId,
              status: "unpaid",
              provider: "mock",
              amount_cents: totalCents,
              currency: payload.currency,
            })
            .onConflict("order_id")
            .ignore();

          for (const detail of details) {
            await trx("order_items").insert(
              buildOrderItemInsertPayload({
                columns: detail.orderItemColumns,
                orderId,
                line: detail.line,
                variant: detail.variant,
                now,
              })
            );
          }

          await trx("order_events").insert({
            order_id: orderId,
            type: "placed",
            actor_user_id: req.user.id,
          });

          return trx("orders").where({ id: orderId }).first();
        });

        const items = await db("order_items").where({ order_id: order.id }).select();
        ok(res, {
          order: formatOrder(order),
          items: items.map(formatItem),
        });
        void sendOrderConfirmationEmailBestEffort({
          db,
          user: req.user,
          order,
          items,
        });
      } catch (err) {
        if (err?.code === "PRODUCT_NOT_FOUND") {
          return fail(res, 404, PRODUCT_NOT_FOUND, "Product not found");
        }
        if (err?.code === "INVALID_VARIANT_ECONOMICS") {
          return fail(res, 400, VALIDATION_ERROR, "Invalid variant economics");
        }
        if (err?.code === "OUT_OF_STOCK") {
          return fail(res, 400, OUT_OF_STOCK, "Out of stock");
        }
        next(err);
      }
    }
  );
};

module.exports = { registerOrderCreateRoutes };

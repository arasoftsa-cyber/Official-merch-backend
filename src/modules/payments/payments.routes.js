const express = require("express");
const { getDb } = require("../../config/db");
const { applyWebhookEvent } = require("../../payments/paymentService");

const router = express.Router();

const ATTEMPT_NOT_FOUND = { error: "attempt_not_found" };
const ATTEMPT_NOT_CONFIRMABLE = { error: "attempt_not_confirmable" };

router.post("/mock/confirm/:paymentId", async (req, res, next) => {
  try {
    const { paymentId } = req.params;
    if (!paymentId) {
      return res.status(404).json(ATTEMPT_NOT_FOUND);
    }

    const db = getDb();
    const payment = await db("payments").where({ id: paymentId }).first();
    if (!payment) {
      return res.status(404).json({ error: "payment_not_found" });
    }

    if (payment.status !== "paid") {
      await db.transaction(async (trx) => {
        const now = trx.fn.now();
        await trx("payments").where({ id: paymentId }).update({
          status: "paid",
          paid_at: now,
          updated_at: now,
        });

        const existingPaymentEvent = await trx("payment_events")
          .where({
            payment_id: paymentId,
            provider: "mock",
            event_type: "payment_paid",
          })
          .first("id");
        if (!existingPaymentEvent) {
          await trx("payment_events").insert({
            payment_id: paymentId,
            provider: "mock",
            event_type: "payment_paid",
            payload_json: {
              source: "mock_confirm",
              paymentId,
              orderId: payment.order_id,
            },
          });
        }

        const order = await trx("orders")
          .where({ id: payment.order_id })
          .first("id", "buyer_user_id");
        const actorUserId = req.user?.id || order?.buyer_user_id || null;
        if (order?.id && actorUserId) {
          const existingPaidEvent = await trx("order_events")
            .where({ order_id: order.id, type: "paid" })
            .first("id");
          if (!existingPaidEvent) {
            await trx("order_events").insert({
              order_id: order.id,
              type: "paid",
              actor_user_id: actorUserId,
              created_at: now,
            });
          }
        }
      });
    }

    return res.json({
      ok: true,
      paymentId: payment.id,
      orderId: payment.order_id,
      status: "paid",
      idempotent: payment.status === "paid",
    });
  } catch (err) {
    next(err);
  }
});

router.post("/webhook/:provider", async (req, res, next) => {
  try {
    const { provider } = req.params;
    if (!provider) {
      return res.status(400).json({ error: "provider_required" });
    }

    const payload = req.body || {};
    const providerEventId =
      payload.event?.id ?? payload.id ?? payload.event_id ?? null;

    const db = getDb();
    let insertedEvent;
    try {
      [insertedEvent] = await db("payment_events")
        .insert({
          provider,
          event_type: "webhook_received",
          provider_event_id: providerEventId,
          payload_json: payload,
        })
        .returning(["id"]);
    } catch (err) {
      if (
        err?.code === "23505" &&
        err?.constraint === "payment_events_provider_event_unique"
      ) {
        return res.json({ ok: true, deduped: true });
      }
      throw err;
    }

    const providerPaymentCandidates = [
      payload.payment_id,
      payload.provider_payment_id,
      payload.razorpay_payment_id,
      payload.data?.payment_id,
      payload.data?.razorpay_payment_id,
    ];
    const providerOrderCandidates = [
      payload.order_id,
      payload.provider_order_id,
      payload.razorpay_order_id,
      payload.data?.order_id,
      payload.data?.razorpay_order_id,
    ];

    const normalizedString = (value) =>
      typeof value === "string" && value.trim() ? value.trim() : null;

    const providerPaymentId = providerPaymentCandidates
      .map(normalizedString)
      .find(Boolean);
    const providerOrderId = providerOrderCandidates
      .map(normalizedString)
      .find(Boolean);

    let payment = null;
    if (providerPaymentId) {
      payment = await db("payments")
        .where({ provider_payment_id: providerPaymentId })
        .first();
    }
    if (!payment && providerOrderId) {
      payment = await db("payments")
        .where({ provider_order_id: providerOrderId })
        .first();
    }

    if (payment && insertedEvent?.id) {
      await db("payment_events")
        .where({ id: insertedEvent.id })
        .update({ payment_id: payment.id });
    }

    const { action } = applyWebhookEvent({ payload });
    if (action !== "none" && payment) {
      const now = db.fn.now();
      const statusMap = {
        mark_paid: "paid",
        mark_failed: "failed",
        mark_refunded: "refunded",
      };
      const status = statusMap[action] || payment.status;
      const updates = {
        status,
        updated_at: now,
      };
      if (action === "mark_paid") {
        updates.paid_at = now;
      }
      await db("payments").where({ id: payment.id }).update(updates);

      const eventTypeMap = {
        mark_paid: "payment_paid",
        mark_failed: "payment_failed",
        mark_refunded: "payment_refunded",
      };

      await db("payment_events").insert({
        payment_id: payment.id,
        provider,
        provider_event_id: providerEventId,
        payload_json: payload,
        event_type: eventTypeMap[action],
      });
    }

    return res.json({
      ok: true,
      deduped: false,
      action,
      paymentId: payment?.id || null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

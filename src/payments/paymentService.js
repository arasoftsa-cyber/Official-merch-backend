const { randomUUID } = require("crypto");
const { getDb } = require("../config/db");
const mockProvider = require("./providers/mockProvider");

const providers = {
  [mockProvider.name]: mockProvider,
};

const ORDERS_TABLE = "orders";
const PAYMENTS_TABLE = "payments";
const ATTEMPTS_TABLE = "payment_attempts";

const getProvider = (name = "mock") => providers[name] || mockProvider;

const startPaymentForOrder = async ({ knex, orderId, buyerUserId }) => {
  const now = knex.fn.now();
  return knex.transaction(async (trx) => {
    const order = await trx(ORDERS_TABLE).where({ id: orderId }).first();
    if (!order || order.buyer_user_id !== buyerUserId) {
      const err = new Error("order_not_found");
      err.code = "ORDER_NOT_FOUND";
      throw err;
    }
    if (order.status !== "placed") {
      const err = new Error("order_not_payable");
      err.code = "ORDER_NOT_PAYABLE";
      throw err;
    }

    let payment = await trx(PAYMENTS_TABLE)
      .where({ order_id: orderId })
      .forUpdate()
      .first();

    if (!payment) {
      const [newPayment] = await trx(PAYMENTS_TABLE)
        .insert({
          id: randomUUID(),
          order_id: orderId,
          status: "pending",
          provider: "mock",
          amount_cents: order.total_cents,
          currency: "INR",
          created_at: now,
          updated_at: now,
        })
        .returning(["id", "status", "provider"]);
      payment = newPayment;
    } else if (payment.status === "paid") {
      return {
        paymentId: payment.id,
        status: "paid",
        provider: payment.provider,
        attemptId: null,
      };
    } else if (["unpaid", "failed"].includes(payment.status)) {
      await trx(PAYMENTS_TABLE)
        .where({ id: payment.id })
        .update({ status: "pending", updated_at: now });
      payment = await trx(PAYMENTS_TABLE).where({ id: payment.id }).first();
    }

    let attempt = await trx(ATTEMPTS_TABLE)
      .where({ payment_id: payment.id })
      .orderBy("created_at", "desc")
      .first();

    if (attempt?.status === "created") {
      return {
        paymentId: payment.id,
        status: payment.status,
        provider: payment.provider,
        attemptId: attempt.id,
      };
    }

    const attemptId = randomUUID();
    await trx(ATTEMPTS_TABLE).insert({
      id: attemptId,
      payment_id: payment.id,
      status: "created",
      provider: payment.provider,
      created_at: now,
    });

    return {
      paymentId: payment.id,
      status: payment.status,
      provider: payment.provider,
      attemptId,
    };
  });
};

const confirmAttempt = async ({ knex, attemptId }) => {
  return knex.transaction(async (trx) => {
    const attempt = await trx(ATTEMPTS_TABLE).where({ id: attemptId }).first();
    if (!attempt) {
      const err = new Error("attempt_not_found");
      err.code = "ATTEMPT_NOT_FOUND";
      throw err;
    }
    if (attempt.status === "succeeded") {
      return { ok: true };
    }
    if (attempt.status !== "created") {
      const err = new Error("attempt_not_confirmable");
      err.code = "ATTEMPT_NOT_CONFIRMABLE";
      throw err;
    }

    await trx(ATTEMPTS_TABLE).where({ id: attemptId }).update({
      status: "succeeded",
    });
    await trx(PAYMENTS_TABLE)
      .where({ id: attempt.payment_id })
      .update({
        status: "paid",
        updated_at: trx.fn.now(),
      });
    const provider = getProvider("mock");
    await provider.confirmAttempt({ knex: trx, attempt });
    return { ok: true };
  });
};

const applyWebhookEvent = ({ payload }) => {
  if (!payload) {
    return { action: "none" };
  }
  const statusCandidate =
    payload.status ||
    payload.event?.status ||
    payload.data?.status ||
    payload.payment?.status;
  const normalized = typeof statusCandidate === "string" ? statusCandidate.toLowerCase() : null;
  if (normalized === "paid") {
    return { action: "mark_paid" };
  }
  if (normalized === "failed") {
    return { action: "mark_failed" };
  }
  if (normalized === "refunded") {
    return { action: "mark_refunded" };
  }
  return { action: "none" };
};

module.exports = { getProvider, startPaymentForOrder, confirmAttempt, applyWebhookEvent };

const { sendEmailByTemplate } = require("../../services/email.service");
const { buildPublicAppUrl } = require("../../services/appPublicUrl.service");

const ORDER_NOT_FOUND = { error: "order_not_found" };
const ORDER_NOT_FULFILLABLE = { error: "order_not_fulfillable" };
const ORDER_NOT_PAID = { error: "order_not_paid" };
const ORDER_NOT_REFUNDABLE = { error: "order_not_refundable" };
const ORDER_DEFAULT_VIEW_PATH = "/fan/orders";

const formatItem = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    productVariantId: row.product_variant_id,
    quantity: row.quantity,
    priceCents: row.price_cents,
    createdAt: row.created_at,
  };
};

const formatOrder = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    totalCents: row.total_cents,
    createdAt: row.created_at,
    buyerUserId: row.buyer_user_id,
  };
};

const formatEvent = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    actorUserId: row.actor_user_id,
    note: row.note,
    createdAt: row.created_at,
  };
};

const resolveOrderBuyerEmail = async ({ db, buyerUserId }) => {
  const safeBuyerUserId = String(buyerUserId || "").trim();
  if (!safeBuyerUserId) return "";
  const row = await db("users").where({ id: safeBuyerUserId }).first("email");
  return String(row?.email || "").trim().toLowerCase();
};

const buildOrderViewUrl = (orderId) => {
  const safeOrderId = String(orderId || "").trim();
  if (!safeOrderId) return buildPublicAppUrl({ path: ORDER_DEFAULT_VIEW_PATH });
  return (
    buildPublicAppUrl({ path: `${ORDER_DEFAULT_VIEW_PATH}/${safeOrderId}` }) ||
    buildPublicAppUrl({ path: ORDER_DEFAULT_VIEW_PATH })
  );
};

const sendOrderStatusUpdateEmailBestEffort = async ({
  db,
  orderId,
  buyerUserId,
  status,
  message,
}) => {
  try {
    const safeOrderId = String(orderId || "").trim();
    const safeStatus = String(status || "").trim().toLowerCase();
    if (!safeOrderId || !safeStatus) return;

    const recipientEmail = await resolveOrderBuyerEmail({ db, buyerUserId });
    if (!recipientEmail) return;

    const result = await sendEmailByTemplate({
      templateKey: "order-status-update",
      to: recipientEmail,
      payload: {
        orderId: safeOrderId,
        status: safeStatus,
        message: String(message || "").trim(),
        orderUrl: buildOrderViewUrl(safeOrderId),
      },
      metadata: {
        flow: "order_status_update",
        orderId: safeOrderId,
        status: safeStatus,
      },
    });

    if (result.errorCode && !result.skipped) {
      console.warn("[admin.orders.email] status update failed", {
        orderId: safeOrderId,
        status: safeStatus,
        code: result.errorCode,
      });
    }
  } catch (err) {
    console.warn("[admin.orders.email] status update failed", err?.code || err?.message || err);
  }
};

const sendShipmentDispatchedEmailBestEffort = async ({
  db,
  orderId,
  buyerUserId,
  carrier,
  trackingNumber,
  trackingUrl,
}) => {
  try {
    const safeOrderId = String(orderId || "").trim();
    if (!safeOrderId) return;

    const recipientEmail = await resolveOrderBuyerEmail({ db, buyerUserId });
    if (!recipientEmail) return;

    const result = await sendEmailByTemplate({
      templateKey: "shipment-dispatched",
      to: recipientEmail,
      payload: {
        orderId: safeOrderId,
        carrier: String(carrier || "").trim(),
        trackingNumber: String(trackingNumber || "").trim(),
        trackingUrl: String(trackingUrl || "").trim(),
        orderUrl: buildOrderViewUrl(safeOrderId),
      },
      metadata: {
        flow: "shipment_dispatched",
        orderId: safeOrderId,
      },
    });

    if (result.errorCode && !result.skipped) {
      console.warn("[admin.orders.email] shipment dispatched failed", {
        orderId: safeOrderId,
        code: result.errorCode,
      });
    }
  } catch (err) {
    console.warn(
      "[admin.orders.email] shipment dispatched failed",
      err?.code || err?.message || err
    );
  }
};

module.exports = {
  ORDER_NOT_FOUND,
  ORDER_NOT_FULFILLABLE,
  ORDER_NOT_PAID,
  ORDER_NOT_REFUNDABLE,
  formatItem,
  formatOrder,
  formatEvent,
  sendOrderStatusUpdateEmailBestEffort,
  sendShipmentDispatchedEmailBestEffort,
};

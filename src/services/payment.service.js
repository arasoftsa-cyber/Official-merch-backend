const { getDb } = require('../core/db/db');
const Razorpay = require('razorpay');
const { randomUUID } = require('crypto');
//
class paymentService {
  constructor(parameters) {
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  async createPayment({ orderId, provider, user }) {
    try {
      const order = await getDb().from('orders').where({ id: orderId }).first();
      if (!order) {
        const err = new Error('order_not_found');
        err.code = 'ORDER_NOT_FOUND';
        throw err;
      }
      const now = new Date();
      const razorpayOrder = await this.razorpay.orders.create({
        amount: order.total_cents, // amount in paise
        currency: 'INR',
        payment_capture: 1,
      });
      const existingPayment = await getDb().from('payments').where({ order_id: orderId }).first();
      const payment = await getDb().from('payments')
        .where({ order_id: orderId })
        .update({
          status: 'pending',
          provider: 'razorpay',
          provider_order_id: razorpayOrder.id,
          amount_cents: order.total_cents,
          currency: 'INR',
          created_at: now,
          updated_at: now,
        })
        .returning('*');

      return {
        note: payment[0],
        key: process.env.RAZORPAY_KEY_ID,
        amount: order.total_cents,
        currency: 'INR',
        orderId: razorpayOrder.id,
        callback_url: 'http://localhost:3000/payment-success',
        user
      };
    } catch (error) {
      console.error('Error creating payment:', error);
      throw error;
    }
  }
  async changePaymentStatusToPaid(data) {
    try {
        const { razorpay_order_id, razorpay_payment_id,razorpay_signature } = data;
        const payment = await getDb().from('payments').where({ provider_order_id: razorpay_order_id }).first();
        if (!payment) {
            const err = new Error('payment_not_found');
            err.code = 404;
            throw err;
        }
        if (payment.status === 'paid') {
            const err = new Error('payment_already_paid');
            err.code = 400;
            throw err; // Already paid, return existing payment
        }
        // verify payment is captured from razorpay side
        const details = await this.razorpay.payments.fetch(razorpay_payment_id);
        if (details.status !== 'captured') {
            const err = new Error('payment_not_captured');
            err.code = 400;
            throw err; // Payment not captured, cannot mark as paid
        }
        const updatedPayment = await getDb()
          .from('payments')
          .where({ id: payment.id })
          .update({ status: 'paid', updated_at: new Date(),
            provider_payment_id: razorpay_payment_id,
            provider_signature: razorpay_signature,
            paid_at: new Date(),
           })
          .returning('*');
        return updatedPayment[0];

    } catch (error) {
      console.error('Error changing payment status to paid:', error);
      throw error;
    }
  };
}

module.exports = new paymentService();

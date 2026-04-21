const service = require("../services/payment.service");
class paymentController {
    constructor(parameters) {
    }
    async createPayment(req, res) {
        try {
            const result = await service.createPayment({
                orderId: req.params.id,
                provider: 'razorpay',
                user: req.user,
            });
            return res.json(result);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
    async changePaymentStatusToPaid(req, res) {
        try {
            const result = await service.changePaymentStatusToPaid(req.body);
            return res.json(result);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
        
}

module.exports = new paymentController();
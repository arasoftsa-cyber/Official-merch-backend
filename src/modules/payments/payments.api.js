'use strict';
const svc=require('../../core/payments/paymentService');
module.exports={ startPaymentForOrder:svc.startPaymentForOrder, confirmAttempt:svc.confirmAttempt };

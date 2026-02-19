/**
 * @typedef {Object} PaymentAttemptMetadata
 * @property {string|null} providerAttemptId
 * @property {Object|null} metaJson

 * @typedef {Object} StartAttemptResult
 * @property {string|null} providerAttemptId
 * @property {Object|null} metaJson

 * @typedef {Object} ConfirmAttemptResult
 * @property {boolean} ok

 * @typedef {Object} IPaymentProvider
 * @property {string} name
 * @property {(params: { knex: import('knex'), payment: Object, order: Object }) => Promise<StartAttemptResult>} createAttempt
 * @property {(params: { knex: import('knex'), attempt: Object }) => Promise<ConfirmAttemptResult>} confirmAttempt
 */

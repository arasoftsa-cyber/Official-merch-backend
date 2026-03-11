# Transactional Email Priority Ladder

Use this ladder before adding new customer-facing email templates/hooks.

## Tier 1 (must-have now)
- `password-reset`
- `welcome-account`
- `order-confirmation`
- `order-status-update`
- `shipment-dispatched`
- `admin-approved-account`
- `admin-rejected-account`

## Tier 2 (next)
- delivery and payment recovery milestones that improve clarity but are not blocking core operations.

## Tier 3 (later)
- marketing/engagement or non-essential notifications.

## Rules
- Keep using the shared sender + template registry (`src/services/emailTemplates/index.js`).
- Add new template metadata to `catalog.js` first, then implement/hook only if tier justifies it.
- Do not wire Tier 2/3 emails into live flows unless explicitly prioritized.

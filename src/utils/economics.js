const asNullableNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isNonNegativeInteger = (value) =>
  Number.isFinite(value) && Number.isInteger(value) && value >= 0;

const deriveOurShareCents = ({
  sellingPriceCents,
  vendorPayoutCents,
  royaltyCents,
}) => {
  if (
    !isNonNegativeInteger(sellingPriceCents) ||
    !isNonNegativeInteger(vendorPayoutCents) ||
    !isNonNegativeInteger(royaltyCents)
  ) {
    return null;
  }
  const derived = sellingPriceCents - vendorPayoutCents - royaltyCents;
  if (!Number.isInteger(derived) || derived < 0) {
    return null;
  }
  return derived;
};

const resolveOurShareCents = ({
  sellingPriceCents,
  vendorPayoutCents,
  royaltyCents,
  ourShareCents,
}) => {
  if (ourShareCents === undefined) {
    const derived = deriveOurShareCents({
      sellingPriceCents,
      vendorPayoutCents,
      royaltyCents,
    });
    return {
      ourShareCents: derived === null ? undefined : derived,
      derived: derived !== null,
      error: null,
    };
  }

  if (ourShareCents === null) {
    return { ourShareCents: null, derived: false, error: null };
  }

  const numeric = asNullableNumber(ourShareCents);
  if (!isNonNegativeInteger(numeric)) {
    return {
      ourShareCents: null,
      derived: false,
      error: "invalid_our_share_cents",
    };
  }

  return { ourShareCents: numeric, derived: false, error: null };
};

module.exports = {
  asNullableNumber,
  isNonNegativeInteger,
  deriveOurShareCents,
  resolveOurShareCents,
};


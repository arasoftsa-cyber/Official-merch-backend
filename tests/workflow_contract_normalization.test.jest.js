const {
  normalizeArtistAccessSubmissionPayload,
  validateArtistAccessSubmissionPayload,
  normalizeAdminArtistAccessApprovalPayload,
  validateAdminArtistAccessApprovalPayload,
} = require("../src/contracts/artistAccessRequest.contract");
const {
  normalizeCreateOrderPayload,
  validateCreateOrderPayload,
} = require("../src/contracts/orders.contract");
const {
  normalizePutProductVariantsPayload,
  validatePutProductVariantsPayload,
  normalizePatchInventorySkuPayload,
  validatePatchInventorySkuPayload,
} = require("../src/contracts/productVariants.contract");

describe("workflow contract normalization", () => {
  it("accepts canonical artist access submission payload", () => {
    const normalized = normalizeArtistAccessSubmissionPayload({
      artist_name: "Artist Name",
      handle: "artist-name",
      email: "artist@example.com",
      phone: "+49 123 4567",
      about: "About text",
      message_for_fans: "Hello fans",
      requested_plan_type: "basic",
      socials: [{ platform: "instagram", url: "https://example.com/artist" }],
    });

    expect(() => validateArtistAccessSubmissionPayload(normalized.dto)).not.toThrow();
    expect(normalized.dto.artist_name).toBe("Artist Name");
    expect(normalized.dto.phone).toBe("491234567");
  });

  it("normalizes legacy artist access payload and records legacy keys", () => {
    const normalized = normalizeArtistAccessSubmissionPayload({
      artistName: "Legacy Artist",
      handle: "@legacy-artist",
      contactEmail: "legacy@example.com",
      contactPhone: "+1 (555) 222-3333",
      aboutMe: "Legacy about",
      messageForFans: "Legacy fans",
      requestedPlanType: "advanced",
    });

    expect(normalized.dto.artist_name).toBe("Legacy Artist");
    expect(normalized.dto.email).toBe("legacy@example.com");
    expect(normalized.dto.phone).toBe("15552223333");
    expect(normalized.dto.requested_plan_type).toBe("advanced");
    expect(normalized.meta.legacyKeys).toEqual(
      expect.arrayContaining([
        "artistName",
        "contactEmail",
        "contactPhone",
        "aboutMe",
        "messageForFans",
        "requestedPlanType",
      ])
    );
    expect(normalized.meta.deprecations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "contract_alias_used",
          canonicalKey: "artist_name",
          aliasKey: "artistName",
        }),
      ])
    );
  });

  it("rejects conflicting admin approval alias fields", () => {
    expect(() =>
      normalizeAdminArtistAccessApprovalPayload({
        final_plan_type: "basic",
        finalPlanType: "advanced",
        password: "pw",
      })
    ).toThrow(/Conflicting payload fields/);
  });

  it("accepts canonical order payload", () => {
    const payload = validateCreateOrderPayload(
      normalizeCreateOrderPayload({
        items: [
          {
            productId: "00000000-0000-4000-8000-000000000001",
            productVariantId: "00000000-0000-4000-8000-000000000002",
            quantity: 2,
          },
        ],
        currency: "INR",
      }).dto
    );

    expect(payload.items).toHaveLength(1);
    expect(payload.currency).toBe("INR");
  });

  it("normalizes legacy single-item order payload", () => {
    const normalized = normalizeCreateOrderPayload({
      productId: "00000000-0000-4000-8000-000000000001",
      productVariantId: "00000000-0000-4000-8000-000000000002",
      quantity: 1,
      currency: "INR",
    });

    const payload = validateCreateOrderPayload(normalized.dto);
    expect(payload.items).toEqual([
      {
        productId: "00000000-0000-4000-8000-000000000001",
        productVariantId: "00000000-0000-4000-8000-000000000002",
        quantity: 1,
      },
    ]);
    expect(normalized.meta.legacyKeys).toEqual(
      expect.arrayContaining(["productId", "productVariantId", "quantity"])
    );
    expect(normalized.meta.deprecations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalKey: "items",
          aliasKey: "single_item_top_level_fields",
        }),
      ])
    );
  });

  it("rejects conflicting mixed order shapes", () => {
    expect(() =>
      normalizeCreateOrderPayload({
        items: [
          {
            productId: "00000000-0000-4000-8000-000000000001",
            productVariantId: "00000000-0000-4000-8000-000000000002",
            quantity: 1,
          },
        ],
        productId: "00000000-0000-4000-8000-000000000111",
        productVariantId: "00000000-0000-4000-8000-000000000222",
        quantity: 1,
        currency: "INR",
      })
    ).toThrow(/Conflicting payload fields/);
  });

  it("normalizes scoped snake_case product variant aliases", () => {
    const normalized = normalizePutProductVariantsPayload({
      variants: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          inventory_sku_id: "00000000-0000-4000-8000-000000000010",
          selling_price_cents: 2100,
          is_listed: true,
        },
      ],
    });

    expect(() => validatePutProductVariantsPayload(normalized.dto)).not.toThrow();
    expect(normalized.dto.variants[0].inventorySkuId).toBe(
      "00000000-0000-4000-8000-000000000010"
    );
    expect(normalized.dto.variants[0].sellingPriceCents).toBe(2100);
    expect(normalized.meta.legacyKeys).toEqual(
      expect.arrayContaining(["inventory_sku_id", "selling_price_cents", "is_listed"])
    );
  });

  it("rejects removed artist access alias shapes", () => {
    const normalized = normalizeArtistAccessSubmissionPayload({
      artist_name: "Artist",
      handle: "artist",
      email: "artist@example.com",
      phone: "1234567890",
      planType: "basic",
    });

    try {
      validateArtistAccessSubmissionPayload(normalized.dto);
      throw new Error("expected validation rejection");
    } catch (error) {
      expect(error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "requested_plan_type" }),
        ])
      );
    }
  });

  it("rejects removed product variant price alias shapes", () => {
    const normalized = normalizePutProductVariantsPayload({
      variants: [
        {
          inventory_sku_id: "00000000-0000-4000-8000-000000000010",
          priceCents: 2100,
        },
      ],
    });

    expect(normalized.dto.variants[0].sellingPriceCents).toBeUndefined();
  });

  it("rejects conflicting variant alias values", () => {
    expect(() =>
      normalizePutProductVariantsPayload({
        variants: [
          {
            inventorySkuId: "00000000-0000-4000-8000-000000000010",
            inventory_sku_id: "00000000-0000-4000-8000-000000000099",
          },
        ],
      })
    ).toThrow(/Conflicting payload fields/);
  });

  it("rejects malformed inventory patch mixed shape", () => {
    const normalized = normalizePatchInventorySkuPayload({
      stock: 10,
      stock_delta: 2,
    });

    expect(() => validatePatchInventorySkuPayload(normalized.dto)).toThrow(
      /stock_and_stock_delta_conflict/
    );
  });

  it("rejects removed admin artist approval aliases", () => {
    const normalized = normalizeAdminArtistAccessApprovalPayload({
      final_plan_type: "basic",
      payment_mode: "manual",
      transaction_id: "txn-1",
      generated_password: "pw",
    });

    expect(() => validateAdminArtistAccessApprovalPayload(normalized.dto)).toThrow(
      /password is required/
    );
  });
});

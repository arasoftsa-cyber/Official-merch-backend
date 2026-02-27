require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getDb } = require("../src/config/db");

const BASE_URL = process.env.API_BASE || "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ARTIST_EMAIL = process.env.ARTIST_EMAIL;
const ARTIST_PASSWORD = process.env.ARTIST_PASSWORD;
const LABEL_EMAIL = process.env.LABEL_EMAIL;
const LABEL_PASSWORD = process.env.LABEL_PASSWORD;
const BUYER_EMAIL = process.env.BUYER_EMAIL;
const BUYER_PASSWORD = process.env.BUYER_PASSWORD;
const REQUIRED_CREDENTIAL_VARS = [
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "ARTIST_EMAIL",
  "ARTIST_PASSWORD",
  "LABEL_EMAIL",
  "LABEL_PASSWORD",
  "BUYER_EMAIL",
  "BUYER_PASSWORD",
];
for (const key of REQUIRED_CREDENTIAL_VARS) {
  if (!String(process.env[key] || "").trim()) {
    throw new Error(`Missing required env var: ${key}`);
  }
}
const REPORT_DIR = path.join(__dirname, "reports");
const REPORT_PATH = path.join(REPORT_DIR, "smoke_phase1_3.md");

const reportEntries = [];
const uniqueSuffix = () => {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+tmk8AAAAASUVORK5CYII=";

const toUploadsProductsPath = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.pathname || "";
  } catch (_err) {
    return raw;
  }
};

const SEEDED_DROP_HANDLE = "seed-drop";

const req = async (method, path, { token, json, formData, headers: extraHeaders } = {}) => {
  const headers = {
    Accept: "application/json",
    "x-smoke-test": "1",
  };
  if (json && !formData) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: formData ? formData : json ? JSON.stringify(json) : undefined,
  });

  const bodyText = await response.text();
  let jsonParsed;
  try {
    jsonParsed = bodyText ? JSON.parse(bodyText) : undefined;
  } catch (error) {
    jsonParsed = undefined;
  }

  return {
    status: response.status,
    bodyText,
    json: jsonParsed,
    method,
    path,
  };
};

const buildNewMerchCreateFormData = ({ artistId, suffix }) => {
  const fd = new FormData();
  fd.append("artist_id", artistId);
  fd.append("merch_name", `Catalog Tee ${suffix}`);
  fd.append("merch_story", "Smoke test merch story long enough.");
  fd.append("vendor_pay", "8.00");
  fd.append("our_share", "7.00");
  fd.append("royalty", "4.99");
  fd.append("merch_type", "tshirt");
  fd.append("colors", JSON.stringify(["black"]));

  for (let i = 1; i <= 4; i += 1) {
    const buffer = Buffer.from(TINY_PNG_BASE64, "base64");
    const blob = new Blob([buffer], { type: "image/png" });
    fd.append(`listing_photo_${i}`, blob, `smoke-listing-${i}.png`);
  }

  return fd;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logSkip = (name, reason) => {
  console.log(`SKIP - ${name} (${reason})`);
  reportEntries.push({
    name,
    result: "SKIP",
    status: "",
    notes: reason,
    body: "",
  });
};

const formatRequestContext = (error) => {
  if (!error?.method && !error?.url) return "";
  const parts = [];
  if (error.method && error.url) {
    parts.push(`${error.method} ${error.url}`);
  }
  if (error?.status) {
    parts.push(`status=${error.status}`);
  }
  if (error?.body) {
    parts.push(`body=${error.body}`);
  }
  return parts.length ? `[${parts.join(" | ")}]` : "";
};

const runStep = async (name, fn) => {
  try {
    const data = await fn();
    console.log(`PASS - ${name}`);
    reportEntries.push({
      name,
      result: "PASS",
      status: data?.status ?? "",
      notes: data?.notes ?? "",
      body: data?.body ?? "",
    });
    return true;
  } catch (error) {
    const status = error?.status ?? "<unknown>";
    const message = error?.message ?? "failed";
    const body = error?.body ?? error?.bodyText ?? "";
    console.error(
      `FAIL - ${name} (${message}) ${formatRequestContext(error)} body=${body}`
    );
    reportEntries.push({
      name,
      result: "FAIL",
      status,
      notes: message,
      body,
    });
    return false;
  }
};

const writeReport = () => {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const lines = [
    "# Smoke Test Phase 1–3",
    `Generated: ${new Date().toISOString()}`,
    `API Base: ${BASE_URL}`,
    "",
    "| Step | Result | Status | Notes |",
    "| --- | --- | --- | --- |",
    ...reportEntries.map(
      ({ name, result, status, notes }) =>
        `| ${name} | ${result} | ${status} | ${notes || ""} |`
    ),
  ];

  const failedEntries = reportEntries.filter((entry) => entry.result === "FAIL");
  if (failedEntries.length) {
    lines.push("");
    failedEntries.forEach((entry) => {
      const snippet = entry.body ? entry.body.slice(0, 2000) : "(no body)";
      lines.push(`<details>`);
      lines.push(`<summary>${entry.name} response</summary>`);
      lines.push("");
      lines.push("```");
      lines.push(snippet);
      lines.push("```");
      lines.push("</details>");
    });
  }

  fs.writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");
};

const extractPaymentState = (json) => {
  if (!json) return null;
  const statusCandidates = [
    json.payment?.status,
    json.paymentStatus,
    json.order?.paymentStatus,
    json.payment?.paymentStatus,
  ];
  for (const candidate of statusCandidates) {
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  const booleanCandidates = [
    json.payment?.is_paid,
    json.order?.is_paid,
    json.is_paid,
  ];
  for (const candidate of booleanCandidates) {
    if (typeof candidate === "boolean") {
      return candidate ? "paid" : "unpaid";
    }
  }
  return null;
};

const ensurePaymentState = (res, expected) => {
  const state = extractPaymentState(res.json);
  if (!state) {
    throw {
      status: res.status,
      body: res.bodyText,
      message: "payment state missing",
    };
  }
  if (state !== expected) {
    throw {
      status: res.status,
      body: res.bodyText,
      message: `expected payment ${expected} got ${state}`,
    };
  }
};

(async () => {
  let adminToken;
  let buyerToken;
  let labelToken;
  let artistToken;
  let artistId;
  let labelId;
  let productId;
  let variantId;
      let orderId;
      let paidOrderId;
      let firstOrderId;
  let paymentConfirmPath;
  let paymentId;
  let paymentAttemptId;
  let unpaidOrderId;
  let dropHandle;
  let foreignDropHandle;
  let seededArtistDropKey;
  let dropPublished = false;
  let requestorEmail;
  let requestorPassword;
  let requestorToken;
  let pendingArtistRequestId;
  let pendingArtistRequestHandle;
  let pendingArtistRequestEmail;
  let adminLeadsBeforeArtistRequest = null;
  const stepResults = [];
  let labelSummaryBody;

  const throwRes = (res, message = `status=${res.status}`) => {
    throw {
      status: res.status,
      body: res.bodyText,
      message,
      method: res.method,
      url: res.path,
    };
  };

  stepResults.push(
    await runStep("Admin login", async () => {
      const res = await req("POST", "/api/auth/login", {
        json: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      });
      if (res.status !== 200) {
        throwRes(res);
      }
      if (!res.json?.accessToken) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "missing accessToken",
        };
      }
      adminToken = res.json.accessToken;
      return { status: res.status };
    })
  );

  stepResults.push(
    await runStep("Admin partner login", async () => {
      const res = await req("POST", "/api/auth/partner/login", {
        json: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      });
      if (res.status !== 200 || !res.json?.accessToken) {
        throwRes(res, "admin partner login");
      }
      return { status: res.status };
    })
  );

  stepResults.push(
    await runStep("Admin leads baseline before artist request", async () => {
      const res = await req("GET", "/api/admin/leads", { token: adminToken });
      if (res.status !== 200) {
        throwRes(res);
      }
      if (!Array.isArray(res.json)) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "admin leads expected array response shape",
        };
      }
      adminLeadsBeforeArtistRequest = res.json.length;
      return { status: res.status };
    })
  );

  stepResults.push(
    await runStep("Admin probe allowed", async () => {
      const res = await req("GET", "/api/auth/probe", { token: adminToken });
      if (res.status !== 200) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Buyer login", async () => {
      const res = await req("POST", "/api/auth/login", {
        json: { email: BUYER_EMAIL, password: BUYER_PASSWORD },
      });
      if (res.status !== 200) {
        throwRes(res);
      }
      if (!res.json?.accessToken) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "missing accessToken",
        };
      }
      buyerToken = res.json.accessToken;
      return { status: res.status };
    })
  );

  stepResults.push(
    await runStep("Buyer partner login rejected", async () => {
      const res = await req("POST", "/api/auth/partner/login", {
        json: { email: BUYER_EMAIL, password: BUYER_PASSWORD },
      });
      if (res.status !== 401 || res.json?.error !== "fan_account") {
        throwRes(res, "buyer partner login must be fan_account");
      }
      return { status: res.status };
    })
  );

  stepResults.push(
    await runStep("Register smoke requester", async () => {
      const suffix = uniqueSuffix();
      requestorEmail = `artist-${suffix}@example.com`;
      requestorPassword = `Pass1234-${suffix}`;
      const res = await req("POST", "/api/auth/register", {
        json: {
          email: requestorEmail,
          password: requestorPassword,
        },
      });
      if (res.status !== 200) {
        throwRes(res);
      }
      requestorToken = res.json?.accessToken;
      if (!requestorToken) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "missing requester token",
        };
      }
      return { status: res.status };
    })
  );

  stepResults.push(
    await runStep("Requestor submits artist request", async () => {
      const stamp = Date.now();
      const requestEmail = `smoke.requestor.${stamp}@example.invalid`;
      const handle = `smoke-requestor-${stamp}`;
      const phone = `999${String(stamp).slice(-7)}`;
      const res = await req("POST", "/api/artist-access-requests", {
        token: requestorToken,
        json: {
          artistName: `Smoke Requestor ${stamp}`,
          handle,
          contactEmail: requestEmail,
          phone,
          pitch: "Smoke test request",
          socials: [],
        },
      });
      if (res.status !== 201) {
        throwRes(res);
      }
      const id = res.json?.request_id || res.json?.id;
      if (!id) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "missing request id",
        };
      }
      pendingArtistRequestId = id;
      pendingArtistRequestHandle = handle;
      pendingArtistRequestEmail = requestEmail;
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Artist request does not create lead", async () => {
      const res = await req("GET", "/api/admin/leads", { token: adminToken });
      if (res.status !== 200) {
        throwRes(res);
      }
      if (!Array.isArray(res.json)) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "admin leads expected array response shape",
        };
      }
      const leads = res.json;
      const foundLead = leads.find(
        (lead) =>
          typeof lead?.email === "string" &&
          typeof pendingArtistRequestEmail === "string" &&
          lead.email.toLowerCase() === pendingArtistRequestEmail.toLowerCase()
      );
      if (foundLead) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "artist access request unexpectedly created lead",
        };
      }

      const leadCountAfter = leads.length;
      const countUnchanged =
        typeof adminLeadsBeforeArtistRequest === "number" &&
        leadCountAfter === adminLeadsBeforeArtistRequest;
      const note = countUnchanged
        ? `lead count unchanged (${leadCountAfter})`
        : `lead count changed ${adminLeadsBeforeArtistRequest} -> ${leadCountAfter} (no lead for request email)`;

      return { status: res.status, notes: note };
    })
  );

  stepResults.push(
    await runStep("Buyer probe forbidden (403)", async () => {
      const res = await req("GET", "/api/auth/probe", { token: buyerToken });
      if (res.status !== 403) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Label login", async () => {
      const res = await req("POST", "/api/auth/login", {
        json: { email: LABEL_EMAIL, password: LABEL_PASSWORD },
      });
      if (res.status !== 200) {
        throwRes(res);
      }
      if (!res.json?.accessToken) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "missing accessToken",
        };
      }
      labelToken = res.json.accessToken;
      return { status: res.status };
    })
  );

  stepResults.push(
    await runStep("Label partner login", async () => {
      const res = await req("POST", "/api/auth/partner/login", {
        json: { email: LABEL_EMAIL, password: LABEL_PASSWORD },
      });
      if (res.status !== 200 || !res.json?.accessToken) {
        throwRes(res, "label partner login");
      }
      return { status: res.status };
    })
  );

  stepResults.push(
    await runStep("Dashboards meta", async () => {
      const res = await req("GET", "/api/_meta/dashboards");
      if (res.status !== 200) {
        throwRes(res);
      }
      const body = res.json || {};
      const expected = ["artist", "label", "admin", "buyer"];
      for (const key of expected) {
        if (!Array.isArray(body[key])) {
          throw {
            status: res.status,
            body: res.bodyText,
            message: `missing meta ${key}`,
          };
        }
      }
      return { status: res.status };
    })
  );

  stepResults.push(
    await runStep("Label read allowed", async () => {
      const res = await req("GET", "/api/auth/label-read", { token: labelToken });
      if (res.status !== 200) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Label mutate forbidden (403)", async () => {
      const res = await req("GET", "/api/auth/label-mutate", { token: labelToken });
      if (res.status !== 403) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Admin create artist", async () => {
      const res = await req("POST", "/api/admin/provisioning/create-artist", {
        token: adminToken,
        json: {
          handle: "taalpatar-shepai",
          name: "Taalpatar Shepai",
          theme: {},
        },
      });
      if (res.status === 200) {
        artistId = res.json?.artist?.id;
        if (!artistId) {
          throw {
            status: res.status,
            body: res.bodyText,
            message: "missing artist id",
          };
        }
        return { status: res.status, body: res.bodyText };
      }
      if (res.status === 409) {
        const row = res.json?.artist;
        artistId = row?.id || artistId;
        return {
          status: res.status,
          body: res.bodyText,
          notes: "handle already exists",
        };
      }
      throwRes(res);
    })
  );

  stepResults.push(
    await runStep("Artist page loads", async () => {
      const res = await req("GET", "/api/artists/taalpatar-shepai");
      if (res.status !== 200) {
        throwRes(res);
      }
      if (res.json?.artist?.handle !== "taalpatar-shepai") {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "unexpected handle",
        };
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Artist shelf loads", async () => {
      const res = await req("GET", "/api/artists/taalpatar-shepai/shelf");
      if (res.status !== 200) {
        throwRes(res);
      }
      if (!Array.isArray(res.json?.shelf)) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "shelf missing",
        };
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Admin create label", async () => {
      const res = await req("POST", "/api/admin/provisioning/create-label", {
        token: adminToken,
        json: {
          handle: "test-label",
          name: "Test Label",
        },
      });
      if (![200, 409].includes(res.status)) {
        throwRes(res);
      }
      const row = res.json?.label;
      if (!row?.id) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "missing label id",
        };
      }
      labelId = row.id;
      if (res.status === 409) {
        return {
          status: res.status,
          body: res.bodyText,
          notes: "handle already exists",
        };
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Link label to artist", async () => {
      const res = await req("POST", "/api/admin/provisioning/link-label-artist", {
        token: adminToken,
        json: { labelId, artistId },
      });
      if (res.status !== 200) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Label sales probe allowed", async () => {
      const res = await req(
        "GET",
        `/api/labels/${labelId}/artists/${artistId}/sales-probe`,
        { token: labelToken }
      );
      if (res.status !== 200) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Label sales probe forbidden (403)", async () => {
      const res = await req(
        "GET",
        `/api/labels/${labelId}/artists/00000000-0000-0000-0000-000000000009/sales-probe`,
        { token: labelToken }
      );
      if (res.status !== 403) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Link artist user to artist", async () => {
      const res = await req("POST", `/api/admin/artists/${artistId}/link-user`, {
        token: adminToken,
        json: {
          userId: "00000000-0000-0000-0000-000000000003",
          email: ARTIST_EMAIL,
        },
      });
      if (res.status !== 200) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Buyer cannot create product", async () => {
      const res = await req("POST", "/api/products", {
        token: buyerToken,
        json: {
          title: "Illegal Tee",
          description: "Should be forbidden",
          variants: [
            {
              sku: "ILLEGAL",
              size: "M",
              color: "Red",
              priceCents: 999,
              stock: 1,
            },
          ],
        },
      });
      if (res.status !== 403) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Artist login", async () => {
      const res = await req("POST", "/api/auth/login", {
        json: { email: ARTIST_EMAIL, password: ARTIST_PASSWORD },
      });
      if (res.status !== 200) {
        throwRes(res);
      }
      if (!res.json?.accessToken) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "missing accessToken",
        };
      }
      artistToken = res.json.accessToken;
      return { status: res.status };
    })
  );

  stepResults.push(
    await runStep("Artist partner login", async () => {
      const res = await req("POST", "/api/auth/partner/login", {
        json: { email: ARTIST_EMAIL, password: ARTIST_PASSWORD },
      });
      if (res.status !== 200 || !res.json?.accessToken) {
        throwRes(res, "artist partner login");
      }
      return { status: res.status };
    })
  );

  stepResults.push(
    await runStep("Artist cannot create product", async () => {
      const res = await req("POST", "/api/products", {
        token: artistToken,
        json: {
          title: "Catalog Tee",
          description: "Smoke test product",
          price: "19.99",
          stock: 25,
        },
      });
      if (res.status !== 403) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Admin creates product", async () => {
      const createSuffix = uniqueSuffix();
      const formData = buildNewMerchCreateFormData({ artistId, suffix: createSuffix });
      const res = await req("POST", "/api/admin/products", {
        token: adminToken,
        formData,
      });
      if (res.status !== 201) {
        throwRes(res);
      }
      productId = res.json?.product_id || res.json?.productId || res.json?.product?.id;
      if (!productId) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "missing productId",
        };
      }

      const listingPhotoUrls = Array.isArray(res.json?.listingPhotoUrls)
        ? res.json.listingPhotoUrls
        : [];
      if (listingPhotoUrls.length !== 4) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: `expected 4 listingPhotoUrls, got ${listingPhotoUrls.length}`,
        };
      }
      if (
        !listingPhotoUrls.every((entry) =>
          toUploadsProductsPath(entry).startsWith("/uploads/products/")
        )
      ) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "listingPhotoUrls path mismatch",
        };
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Admin manages variants", async () => {
      if (!productId) {
        throw {
          status: 400,
          body: "",
          message: "missing productId",
        };
      }

      const initialReadRes = await req("GET", `/api/admin/products/${productId}/variants`, {
        token: adminToken,
      });
      if (initialReadRes.status !== 200) {
        throwRes(initialReadRes);
      }

      const initialVariants = Array.isArray(initialReadRes.json?.items)
        ? initialReadRes.json.items
        : Array.isArray(initialReadRes.json?.variants)
        ? initialReadRes.json.variants
        : Array.isArray(initialReadRes.json)
        ? initialReadRes.json
        : [];
      if (initialVariants.length < 1) {
        throw {
          status: initialReadRes.status,
          body: initialReadRes.bodyText,
          message: "expected at least one default variant after create",
        };
      }

      const baseVariant = initialVariants[0] || {};
      const uniqueSku = String(baseVariant.sku || `ADM-${Date.now()}`);
      const targetPriceCents = 2199;
      const targetStock = 11;

      const writeRes = await req("PUT", `/api/admin/products/${productId}/variants`, {
        token: adminToken,
        json: {
          variants: [
            {
              id: baseVariant.id,
              sku: uniqueSku,
              size: baseVariant.size || "default",
              color: baseVariant.color || "default",
              priceCents: targetPriceCents,
              stock: targetStock,
            },
          ],
        },
      });
      if (writeRes.status !== 200) {
        throwRes(writeRes);
      }
      const writtenVariants = Array.isArray(writeRes.json?.items)
        ? writeRes.json.items
        : Array.isArray(writeRes.json?.variants)
        ? writeRes.json.variants
        : Array.isArray(writeRes.json)
        ? writeRes.json
        : [];
      if (writtenVariants.length === 0) {
        throw {
          status: writeRes.status,
          body: writeRes.bodyText,
          message: "no variants after admin update",
        };
      }
      const writtenVariant =
        writtenVariants.find((row) => row.id === baseVariant.id) ||
        writtenVariants.find((row) => row.sku === uniqueSku) ||
        writtenVariants[0];
      variantId = writtenVariant?.id;
      if (!variantId) {
        throw {
          status: writeRes.status,
          body: writeRes.bodyText,
          message: "missing variant id after admin update",
        };
      }
      const readRes = await req("GET", `/api/admin/products/${productId}/variants`, {
        token: adminToken,
      });
      if (readRes.status !== 200) {
        throwRes(readRes);
      }
      const persistedVariants = Array.isArray(readRes.json?.items)
        ? readRes.json.items
        : Array.isArray(readRes.json?.variants)
        ? readRes.json.variants
        : Array.isArray(readRes.json)
        ? readRes.json
        : [];
      const persisted =
        persistedVariants.find((row) => row.id === variantId) ||
        persistedVariants.find((row) => row.sku === uniqueSku);
      if (!persisted) {
        throw {
          status: readRes.status,
          body: readRes.bodyText,
          message: "admin variant readback missing",
        };
      }
      if (Number(persisted.priceCents) !== targetPriceCents) {
        throw {
          status: readRes.status,
          body: readRes.bodyText,
          message: `variant price not persisted (${persisted.priceCents})`,
        };
      }
      if (Number(persisted.stock) !== targetStock) {
        throw {
          status: readRes.status,
          body: readRes.bodyText,
          message: `variant stock not persisted (${persisted.stock})`,
        };
      }
      return { status: writeRes.status, body: writeRes.bodyText };
    })
  );

  stepResults.push(
    await runStep("Artist seeded drop has products in list", async () => {
      const readArtistDrops = async () => {
        const res = await req("GET", "/api/artist/drops", { token: artistToken });
        if (res.status !== 200) {
          throwRes(res);
        }
        const items = Array.isArray(res.json?.items)
          ? res.json.items
          : Array.isArray(res.json)
          ? res.json
          : [];
        return { res, items };
      };

      let { res, items } = await readArtistDrops();
      let seededDrop =
        items.find((item) => item?.handle === SEEDED_DROP_HANDLE) ||
        items.find((item) => Number(item?.product_count ?? item?.productCount ?? 0) > 0);

      if (!seededDrop) {
        if (!artistId || !productId) {
          throw {
            status: res.status,
            body: res.bodyText,
            message: "seeded artist drop not found and cannot create fallback",
          };
        }
        const fallbackHandle = `${SEEDED_DROP_HANDLE}-${uniqueSuffix()}`;
        const createDropRes = await req("POST", "/api/admin/drops", {
          token: adminToken,
          json: {
            handle: fallbackHandle,
            title: "Seeded Artist Publish Drop",
            artistId,
          },
        });
        if (![200, 201].includes(createDropRes.status)) {
          throwRes(createDropRes);
        }
        const attachRes = await req("POST", `/api/admin/drops/${fallbackHandle}/products`, {
          token: adminToken,
          json: { productId },
        });
        if (attachRes.status !== 200) {
          throwRes(attachRes);
        }
        ({ res, items } = await readArtistDrops());
        seededDrop =
          items.find((item) => item?.handle === fallbackHandle) ||
          items.find((item) => Number(item?.product_count ?? item?.productCount ?? 0) > 0);
      }

      const productCount = Number(seededDrop?.product_count ?? seededDrop?.productCount ?? 0);
      if (productCount < 1) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "seeded artist drop has no products",
        };
      }

      seededArtistDropKey = seededDrop?.handle || seededDrop?.id;
      if (!seededArtistDropKey) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "seeded artist drop key missing",
        };
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Artist publishes seeded drop successfully", async () => {
      if (!seededArtistDropKey) {
        throw {
          status: 400,
          body: "",
          message: "missing seededArtistDropKey",
        };
      }

      const unpublishRes = await req(
        "POST",
        `/api/artist/drops/${encodeURIComponent(seededArtistDropKey)}/unpublish`,
        { token: artistToken }
      );
      if (unpublishRes.status !== 200) {
        throwRes(unpublishRes);
      }

      const publishRes = await req(
        "POST",
        `/api/artist/drops/${encodeURIComponent(seededArtistDropKey)}/publish`,
        { token: artistToken }
      );
      if (publishRes.status !== 200) {
        throwRes(publishRes);
      }
      if (publishRes.json?.drop?.status !== "published") {
        throw {
          status: publishRes.status,
          body: publishRes.bodyText,
          message: "seeded drop not published",
        };
      }
      return { status: publishRes.status, body: publishRes.bodyText };
    })
  );

  stepResults.push(
    await runStep("Artist cannot edit product fields", async () => {
      if (!productId) {
        throw {
          status: 400,
          body: "",
          message: "missing productId",
        };
      }
      const res = await req("PATCH", `/api/products/${productId}`, {
        token: artistToken,
        json: { title: "Illegal Artist Edit" },
      });
      if (res.status !== 403) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Artist can toggle product status", async () => {
      if (!productId) {
        throw {
          status: 400,
          body: "",
          message: "missing productId",
        };
      }
      const res = await req("PATCH", `/api/products/${productId}`, {
        token: artistToken,
        json: { isActive: true },
      });
      if (res.status !== 200) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Artist cannot manage variants", async () => {
      if (!productId) {
        throw {
          status: 400,
          body: "",
          message: "missing productId",
        };
      }
      const res = await req("PUT", `/api/products/${productId}/variants`, {
        token: artistToken,
        json: {
          variants: [
            {
              sku: "ILLEGAL-SKU",
              size: "L",
              color: "Black",
              priceCents: 1999,
              stock: 10,
            },
          ],
        },
      });
      if (res.status !== 403) {
        throwRes(res);
      }
      const adminPathRes = await req("PUT", `/api/admin/products/${productId}/variants`, {
        token: artistToken,
        json: {
          variants: [
            {
              sku: "ILLEGAL-SKU-2",
              size: "M",
              color: "White",
              priceCents: 1599,
              stock: 5,
            },
          ],
        },
      });
      if (adminPathRes.status !== 403) {
        throwRes(adminPathRes);
      }
      return { status: adminPathRes.status, body: adminPathRes.bodyText };
    })
  );

  if (productId) {
    stepResults.push(
      await runStep("Buyer views products", async () => {
        const res = await req("GET", "/api/products", { token: buyerToken });
        if (res.status !== 200) {
          throwRes(res);
        }
        if (!Array.isArray(res.json?.items) || res.json.items.length === 0) {
          throw {
            status: res.status,
            body: res.bodyText,
            message: "no products",
          };
        }
        return { status: res.status, body: res.bodyText };
      })
    );

    stepResults.push(
      await runStep("Buyer views product detail", async () => {
        const res = await req("GET", `/api/products/${productId}`);
        if (res.status !== 200) {
          throwRes(res);
        }
        const product = res.json?.product || {};
        const photos = Array.isArray(product?.photos)
          ? product.photos
          : Array.isArray(product?.listingPhotoUrls)
          ? product.listingPhotoUrls
          : Array.isArray(res.json?.photos)
          ? res.json.photos
          : [];
        if (photos.length !== 4) {
          throw {
            status: res.status,
            body: res.bodyText,
            message: `expected photos length 4, got ${photos.length}`,
          };
        }

        const primaryPhotoUrl =
          (typeof product?.primaryPhotoUrl === "string" && product.primaryPhotoUrl) ||
          (typeof res.json?.primaryPhotoUrl === "string" && res.json.primaryPhotoUrl) ||
          photos[0] ||
          "";
        if (!toUploadsProductsPath(primaryPhotoUrl).startsWith("/uploads/products/")) {
          throw {
            status: res.status,
            body: res.bodyText,
            message: "primaryPhotoUrl path mismatch",
          };
        }

        if (!Array.isArray(res.json?.variants) || res.json.variants.length === 0) {
          throw {
            status: res.status,
            body: res.bodyText,
            message: "no variants",
          };
        }
        const productPriceCents = Number(product?.priceCents);
        if (!Number.isFinite(productPriceCents) || productPriceCents <= 0) {
          throw {
            status: res.status,
            body: res.bodyText,
            message: "product priceCents missing from variants",
          };
        }
        if (!variantId) {
          variantId = res.json.variants[0]?.id;
        }
        if (!variantId) {
          throw {
            status: res.status,
            body: res.bodyText,
            message: "missing variant id",
          };
        }
        return { status: res.status, body: res.bodyText };
      })
    );

    stepResults.push(
      await runStep("Concurrent orders prevent oversell", async () => {
        if (!artistId) {
          throw {
            status: 400,
            body: "",
            message: "missing artistId",
          };
        }

        const suffix = uniqueSuffix();
        const createProductRes = await req("POST", "/api/admin/products", {
          token: adminToken,
          json: {
            artistId,
            title: `Race Stock Product ${suffix}`,
            description: "Smoke race safety check",
            price: "9.99",
            stock: 1,
          },
        });
        if (createProductRes.status !== 201) {
          throwRes(createProductRes);
        }
        const raceProductId = createProductRes.json?.product?.id;
        if (!raceProductId) {
          throw {
            status: createProductRes.status,
            body: createProductRes.bodyText,
            message: "missing race product id",
          };
        }

        const raceSku = `RACE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const writeVariantRes = await req("PUT", `/api/admin/products/${raceProductId}/variants`, {
          token: adminToken,
          json: {
            variants: [
              {
                sku: raceSku,
                size: "M",
                color: "Race",
                priceCents: 999,
                stock: 1,
              },
            ],
          },
        });
        if (writeVariantRes.status !== 200) {
          throwRes(writeVariantRes);
        }
        const raceVariantId = writeVariantRes.json?.variants?.[0]?.id;
        if (!raceVariantId) {
          throw {
            status: writeVariantRes.status,
            body: writeVariantRes.bodyText,
            message: "missing race variant id",
          };
        }

        const createOrderBody = {
          productId: raceProductId,
          productVariantId: raceVariantId,
          quantity: 1,
        };
        const [attemptA, attemptB] = await Promise.allSettled([
          req("POST", "/api/orders", { token: buyerToken, json: createOrderBody }),
          req("POST", "/api/orders", { token: buyerToken, json: createOrderBody }),
        ]);

        const fulfilled = [attemptA, attemptB]
          .filter((item) => item.status === "fulfilled")
          .map((item) => item.value);
        if (fulfilled.length !== 2) {
          throw {
            status: 500,
            body: JSON.stringify([attemptA, attemptB]),
            message: "concurrent requests did not both settle successfully",
          };
        }

        const successful = fulfilled.filter((res) => [200, 201].includes(res.status));
        const failed = fulfilled.filter((res) => ![200, 201].includes(res.status));
        if (successful.length !== 1 || failed.length !== 1) {
          throw {
            status: 500,
            body: JSON.stringify(
              fulfilled.map((res) => ({ status: res.status, body: res.bodyText }))
            ),
            message: "expected exactly one success and one failure",
          };
        }

        const successOrderId = successful[0]?.json?.order?.id || successful[0]?.json?.id || null;
        if (!successOrderId) {
          throw {
            status: successful[0].status,
            body: successful[0].bodyText,
            message: "successful concurrent order missing id",
          };
        }

        const failedRes = failed[0];
        if (![400, 409, 422].includes(failedRes.status)) {
          throw {
            status: failedRes.status,
            body: failedRes.bodyText,
            message: "unexpected failure status for concurrent order",
          };
        }
        const failedMessage = JSON.stringify(failedRes.json || {}).toLowerCase() || failedRes.bodyText.toLowerCase();
        if (!/(stock|out|insufficient)/i.test(failedMessage)) {
          throw {
            status: failedRes.status,
            body: failedRes.bodyText,
            message: "concurrent failure did not indicate stock exhaustion",
          };
        }

        const readProductRes = await req("GET", `/api/products/${raceProductId}`);
        if (readProductRes.status !== 200) {
          throwRes(readProductRes);
        }
        const variants = Array.isArray(readProductRes.json?.variants)
          ? readProductRes.json.variants
          : Array.isArray(readProductRes.json?.product?.variants)
          ? readProductRes.json.product.variants
          : [];
        const raceVariant = variants.find((variant) => variant.id === raceVariantId);
        if (!raceVariant) {
          throw {
            status: readProductRes.status,
            body: readProductRes.bodyText,
            message: "race variant missing in readback",
          };
        }
        const stockValue =
          typeof raceVariant.stock === "number"
            ? raceVariant.stock
            : typeof raceVariant.stock === "string"
            ? Number(raceVariant.stock)
            : typeof raceVariant.stockQuantity === "number"
            ? raceVariant.stockQuantity
            : typeof raceVariant.stock_quantity === "number"
            ? raceVariant.stock_quantity
            : NaN;
        if (!Number.isFinite(stockValue)) {
          throw {
            status: readProductRes.status,
            body: readProductRes.bodyText,
            message: "race variant stock missing in readback",
          };
        }
        if (stockValue < 0) {
          throw {
            status: readProductRes.status,
            body: readProductRes.bodyText,
            message: `stock below zero (${stockValue})`,
          };
        }
        if (stockValue !== 0) {
          throw {
            status: readProductRes.status,
            body: readProductRes.bodyText,
            message: `expected stock 0 after concurrent race, got ${stockValue}`,
          };
        }

        return {
          status: 200,
          notes: `success=${successful[0].status} failure=${failedRes.status} stock=${stockValue}`,
        };
      })
    );

      stepResults.push(
        await runStep("Buyer creates order", async () => {
          if (!variantId) {
            throw {
              status: 400,
              body: "",
              url: "/api/orders",
              method: "POST",
              message: "missing variantId",
            };
          }
          const attempt = async () =>
            req("POST", "/api/orders", {
              token: buyerToken,
              json: {
                productId,
                productVariantId: variantId,
                quantity: 1,
              },
              headers: {
                "x-smoke-test": "1",
              },
            });
          let res = await attempt();
          if (res.status === 429 && typeof res.json?.retryAfter === "number") {
            await sleep((res.json.retryAfter + 1) * 1000);
            res = await attempt();
          }
          if (res.status !== 200) {
            throwRes(res);
          }
          orderId = res.json?.order?.id;
          if (!orderId) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "missing order id",
            };
          }
          firstOrderId = orderId;
          paidOrderId = orderId;
          return { status: res.status, body: res.bodyText };
        })
      );
    if (orderId) {
      stepResults.push(
        await runStep("Buyer order detail shows unpaid payment", async () => {
          if (!paidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing paid order id",
            };
          }
          const res = await req("GET", `/api/orders/${paidOrderId}`, { token: buyerToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          ensurePaymentState(res, "unpaid");
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer lists my orders", async () => {
          if (!paidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing paid order id",
            };
          }
          const res = await req("GET", "/api/orders/my", { token: buyerToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (!Array.isArray(res.json?.items) || !res.json.items.some((item) => item.id === paidOrderId)) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "order not listed",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer gets order detail", async () => {
          const res = await req("GET", `/api/orders/${orderId}`, { token: buyerToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (
            !Array.isArray(res.json?.items) ||
            !res.json.items.some((item) => item.productVariantId === variantId)
          ) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "order detail missing variant",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer cancels order", async () => {
          const res = await req("POST", `/api/orders/${orderId}/cancel`, {
            token: buyerToken,
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (res.json?.status !== "cancelled") {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "order not cancelled",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer order events include cancelled", async () => {
          if (!firstOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing firstOrderId",
            };
          }
          const res = await req("GET", `/api/orders/${firstOrderId}/events`, {
            token: buyerToken,
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (!Array.isArray(res.json?.items) || !res.json.items.some((event) => event.type === "cancelled")) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "cancelled event missing",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer cannot cancel twice", async () => {
          const res = await req("POST", `/api/orders/${orderId}/cancel`, {
            token: buyerToken,
          });
          if (res.status !== 400) {
            throwRes(res);
          }
          const allowedErrors = ["order_not_cancellable", "order_already_cancelled"];
          if (!allowedErrors.includes(res.json?.error)) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "unexpected error",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer reorders after cancel", async () => {
          const res = await req("POST", "/api/orders", {
            token: buyerToken,
            json: {
              productId,
              productVariantId: variantId,
              quantity: 1,
            },
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          orderId = res.json?.order?.id;
          if (!orderId) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "missing order id",
            };
          }
          paidOrderId = orderId;
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin lists orders", async () => {
          const res = await req("GET", "/api/admin/orders", { token: adminToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (!paidOrderId) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "missing paid order id",
            };
          }
          if (!Array.isArray(res.json?.items) || !res.json.items.some((item) => item.id === paidOrderId)) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "order not in admin list",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin gets order detail", async () => {
          if (!paidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing paid order id",
            };
          }
          const res = await req("GET", `/api/admin/orders/${paidOrderId}`, { token: adminToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (
            !Array.isArray(res.json?.items) ||
            !res.json.items.some((item) => item.productVariantId === variantId)
          ) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "admin detail missing variant",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer pays order", async () => {
          if (!paidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing paid order id",
            };
          }
          const res = await req("POST", `/api/orders/${paidOrderId}/pay`, {
            token: buyerToken,
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          const body = res.json || {};
          const resolvedPaymentId =
            body.paymentId || body.payment?.id || body.order?.paymentId || null;
          const attemptId =
            body.attemptId || body.paymentAttemptId || resolvedPaymentId;
          const confirmPath = body.confirmPath || body.mock?.confirmPath;
          if (!attemptId || !confirmPath) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: `invalid payment response ${JSON.stringify(body)}`,
            };
          }
          paymentId = resolvedPaymentId || attemptId;
          paymentAttemptId = attemptId;
          paymentConfirmPath = confirmPath;
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Confirm payment attempt", async () => {
          if (!paymentConfirmPath) {
            throw {
              status: 400,
              body: "",
              message: "missing confirm path",
            };
          }
          const res = await req("POST", paymentConfirmPath, { token: buyerToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (!res.json?.ok && res.json?.status !== "paid") {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "confirm failed",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Payment confirm is idempotent", async () => {
          if (!paymentConfirmPath) {
            throw {
              status: 400,
              body: "",
              message: "missing confirm path",
            };
          }
          if (!paidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing paid order id",
            };
          }

          const db = getDb();
          const targetPaymentId = paymentId || paymentAttemptId || null;
          let attemptsBefore = null;
          if (targetPaymentId) {
            const [{ count: beforeCount = 0 } = {}] = await db("payment_attempts")
              .where({ payment_id: targetPaymentId })
              .count({ count: "id" });
            attemptsBefore = Number(beforeCount);
          }

          const secondConfirmRes = await req("POST", paymentConfirmPath, { token: buyerToken });
          if (secondConfirmRes.status === 200) {
            const secondBodyText = secondConfirmRes.bodyText.toLowerCase();
            const secondBody = secondConfirmRes.json || {};
            const hasPaidSemantic =
              secondBody?.status === "paid" ||
              secondBody?.ok === true ||
              /paid|already|confirm/.test(secondBodyText);
            if (!hasPaidSemantic) {
              throw {
                status: secondConfirmRes.status,
                body: secondConfirmRes.bodyText,
                message: "second confirm missing paid/already semantic",
              };
            }
          } else if ([409, 422].includes(secondConfirmRes.status)) {
            const secondBodyText = secondConfirmRes.bodyText.toLowerCase();
            if (!/paid|already|confirm/.test(secondBodyText)) {
              throw {
                status: secondConfirmRes.status,
                body: secondConfirmRes.bodyText,
                message: "second confirm conflict missing already-paid semantic",
              };
            }
          } else {
            throwRes(secondConfirmRes, "unexpected second confirm status");
          }

          const paidCheckRes = await req("GET", `/api/orders/${paidOrderId}`, { token: buyerToken });
          if (paidCheckRes.status !== 200) {
            throwRes(paidCheckRes);
          }
          ensurePaymentState(paidCheckRes, "paid");

          if (targetPaymentId) {
            const [{ count: afterCount = 0 } = {}] = await db("payment_attempts")
              .where({ payment_id: targetPaymentId })
              .count({ count: "id" });
            const attemptsAfter = Number(afterCount);
            if (attemptsBefore == null) {
              attemptsBefore = attemptsAfter;
            }
            if (attemptsAfter !== attemptsBefore) {
              throw {
                status: 500,
                body: JSON.stringify({ attemptsBefore, attemptsAfter, targetPaymentId }),
                message: "duplicate payment_attempts detected after idempotent confirm",
              };
            }
          }

          return { status: secondConfirmRes.status, body: secondConfirmRes.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer order detail shows paid payment", async () => {
          if (!paidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing paid order id",
            };
          }
          const res = await req("GET", `/api/orders/${paidOrderId}`, { token: buyerToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          ensurePaymentState(res, "paid");
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin fulfills order", async () => {
          if (!paidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing paid order id",
            };
          }
          const res = await req("POST", `/api/admin/orders/${paidOrderId}/fulfill`, {
            token: adminToken,
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (res.json?.status !== "fulfilled") {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "order not fulfilled",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin refunds order", async () => {
          if (!paidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing paid order id",
            };
          }
          const res = await req("POST", `/api/admin/orders/${paidOrderId}/refund`, {
            token: adminToken,
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (!res.json?.ok) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "refund failed",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer order detail shows refunded payment", async () => {
          if (!paidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing paid order id",
            };
          }
          const res = await req("GET", `/api/orders/${paidOrderId}`, { token: buyerToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          ensurePaymentState(res, "refunded");
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer creates unpaid order", async () => {
          if (!variantId) {
            throw {
              status: 400,
              body: "",
              message: "missing variantId",
            };
          }
          const res = await req("POST", "/api/orders", {
            token: buyerToken,
            json: {
              productId,
              productVariantId: variantId,
              quantity: 1,
            },
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          unpaidOrderId = res.json?.order?.id;
          if (!unpaidOrderId) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "missing unpaid order id",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin cannot fulfill unpaid order", async () => {
          if (!unpaidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing unpaid order id",
            };
          }
          const res = await req("POST", `/api/admin/orders/${unpaidOrderId}/fulfill`, {
            token: adminToken,
          });
          if (res.status !== 400 || res.json?.error !== "order_not_paid") {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "unexpected unpaid fulfill result",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin order events include paid/fulfilled/refunded", async () => {
          if (!paidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing paid order id",
            };
          }
          const res = await req("GET", `/api/admin/orders/${paidOrderId}/events`, { token: adminToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          const types = new Set((res.json?.items || []).map((event) => event.type));
          if (!types.has("paid") || !types.has("fulfilled") || !types.has("refunded")) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "admin lifecycle events missing",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin dashboard summary", async () => {
          const res = await req("GET", "/api/admin/dashboard/summary", { token: adminToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          const body = res.json || {};
          if (
            !body.orders ||
            typeof body.orders.total !== "number" ||
            typeof body.orders.placed !== "number" ||
            typeof body.orders.cancelled !== "number" ||
            typeof body.orders.fulfilled !== "number"
          ) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "invalid orders summary",
            };
          }
          if (body.orders.total < 1) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "orders total too small",
            };
          }
          if (typeof body.gmvCents !== "number" || body.gmvCents < 0) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "gmv invalid",
            };
          }
          if (!body.buyers || typeof body.buyers.total !== "number" || body.buyers.total < 1) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "buyers invalid",
            };
          }
          if (!Array.isArray(body.last7Days) || body.last7Days.length !== 7) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "last7Days missing",
            };
          }
          for (const dayRow of body.last7Days) {
            if (
              !dayRow ||
              typeof dayRow.day !== "string" ||
              typeof dayRow.fulfilledCount !== "number" ||
              typeof dayRow.gmvCents !== "number"
            ) {
              throw {
                status: res.status,
                body: res.bodyText,
                message: "last7Days entry invalid",
              };
            }
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer cannot access admin dashboard summary", async () => {
          const res = await req("GET", "/api/admin/dashboard/summary", { token: buyerToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Artist cannot access admin dashboard summary", async () => {
          const res = await req("GET", "/api/admin/dashboard/summary", { token: artistToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Label cannot access admin dashboard summary", async () => {
          const res = await req("GET", "/api/admin/dashboard/summary", { token: labelToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer order events include paid/fulfilled/refunded", async () => {
          if (!paidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing paid order id",
            };
          }
          const res = await req("GET", `/api/orders/${paidOrderId}/events`, { token: buyerToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          const types = new Set((res.json?.items || []).map((event) => event.type));
          if (!types.has("placed") || !types.has("paid") || !types.has("fulfilled") || !types.has("refunded")) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "event timeline incomplete",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Artist dashboard summary", async () => {
          const res = await req("GET", "/api/artist/dashboard/summary", {
            token: artistToken,
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          const body = res.json || {};
          if (
            typeof body.totalOrders !== "number" ||
            typeof body.totalUnits !== "number" ||
            typeof body.grossCents !== "number"
          ) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "missing numeric totals",
            };
          }
          if (body.totalOrders < 1 || body.totalUnits < 1 || body.grossCents < 1) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "insufficient totals",
            };
          }
          const byStatus = body.byStatus || {};
          if (
            typeof byStatus.placed !== "number" ||
            typeof byStatus.cancelled !== "number" ||
            typeof byStatus.fulfilled !== "number"
          ) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "missing status counts",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer cannot access artist summary", async () => {
          const res = await req("GET", "/api/artist/dashboard/summary", {
            token: buyerToken,
          });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Label cannot access artist summary", async () => {
          const res = await req("GET", "/api/artist/dashboard/summary", {
            token: labelToken,
          });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin cannot access artist summary", async () => {
          const res = await req("GET", "/api/artist/dashboard/summary", {
            token: adminToken,
          });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Artist dashboard orders", async () => {
          const res = await req("GET", "/api/artist/dashboard/orders", {
            token: artistToken,
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (!Array.isArray(res.json?.items) || res.json.items.length === 0) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "orders missing",
            };
          }
          const matching = res.json.items.filter((order) =>
            Array.isArray(order.items) &&
            order.items.some((item) => item.productId === productId)
          );
          if (!matching.length) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "orders missing product",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer cannot access artist orders", async () => {
          const res = await req("GET", "/api/artist/dashboard/orders", {
            token: buyerToken,
          });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Label cannot access artist orders", async () => {
          const res = await req("GET", "/api/artist/dashboard/orders", {
            token: labelToken,
          });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin cannot access artist orders", async () => {
          const res = await req("GET", "/api/artist/dashboard/orders", {
            token: adminToken,
          });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin leads alias parity (status + shape)", async () => {
          const canonicalRes = await req("GET", "/api/admin/leads", { token: adminToken });
          const aliasRes = await req("GET", "/api/partner/admin/leads", { token: adminToken });

          if (canonicalRes.status !== 200) {
            throwRes(canonicalRes, "canonical admin leads status");
          }
          if (aliasRes.status !== 200) {
            throwRes(aliasRes, "alias admin leads status");
          }

          if (!Array.isArray(canonicalRes.json) || !Array.isArray(aliasRes.json)) {
            throw {
              status: canonicalRes.status,
              body: canonicalRes.bodyText,
              message: "admin leads expected array response shape",
            };
          }

          const canonicalFirst = canonicalRes.json[0];
          const aliasFirst = aliasRes.json[0];
          if (canonicalFirst || aliasFirst) {
            const requiredKeys = ["id", "status", "created_at"];
            const canonicalKeys = canonicalFirst ? Object.keys(canonicalFirst) : [];
            const aliasKeys = aliasFirst ? Object.keys(aliasFirst) : [];
            const canonicalHasKeys = requiredKeys.every((k) => canonicalKeys.includes(k));
            const aliasHasKeys = requiredKeys.every((k) => aliasKeys.includes(k));
            if (!canonicalHasKeys || !aliasHasKeys) {
              throw {
                status: canonicalRes.status,
                body: canonicalRes.bodyText,
                message: "admin leads item shape keys missing",
              };
            }
          }

          return {
            status: canonicalRes.status,
            body: canonicalRes.bodyText,
            notes: `canonical=${canonicalRes.status}, alias=${aliasRes.status}`,
          };
        })
      );

      stepResults.push(
        await runStep("Buyer cannot access admin dashboard summary", async () => {
          const res = await req("GET", "/api/admin/dashboard/summary", { token: buyerToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Artist cannot access admin dashboard summary", async () => {
          const res = await req("GET", "/api/admin/dashboard/summary", { token: artistToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Label cannot access admin dashboard summary", async () => {
          const res = await req("GET", "/api/admin/dashboard/summary", { token: labelToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin dashboard orders", async () => {
          const res = await req("GET", "/api/admin/dashboard/orders", { token: adminToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (!Array.isArray(res.json?.items) || res.json.items.length === 0) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "items missing",
            };
          }
          const item = res.json.items[0];
          if (
            !item ||
            !item.orderId ||
            !item.status ||
            item.totalCents == null ||
            !item.createdAt ||
            !item.buyerUserId ||
            typeof item.itemsCount !== "number"
          ) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "order fields missing",
            };
          }
          if (item.itemsCount < 0) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "invalid itemsCount",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer cannot access admin dashboard orders", async () => {
          const res = await req("GET", "/api/admin/dashboard/orders", { token: buyerToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Artist cannot access admin dashboard orders", async () => {
          const res = await req("GET", "/api/admin/dashboard/orders", { token: artistToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Label cannot access admin dashboard orders", async () => {
          const res = await req("GET", "/api/admin/dashboard/orders", { token: labelToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer cannot cancel fulfilled order", async () => {
          if (!paidOrderId) {
            throw {
              status: 400,
              body: "",
              message: "missing paid order id",
            };
          }
          const res = await req("POST", `/api/orders/${paidOrderId}/cancel`, {
            token: buyerToken,
          });
          if (res.status !== 400) {
            throwRes(res);
          }
          if (res.json?.error !== "order_not_cancellable") {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "unexpected error",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Label dashboard summary", async () => {
          const res = await req("GET", "/api/labels/dashboard/summary", { token: labelToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          const body = res.json || {};
          if (
            typeof body.totalArtists !== "number" ||
            typeof body.activeArtists30d !== "number" ||
            typeof body.inactiveArtists !== "number"
          ) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "missing portfolio counts",
            };
          }
          const grossValue =
            typeof body.grossCents === "number"
              ? body.grossCents
              : typeof body.totalGross === "number"
              ? body.totalGross
              : null;
          if (grossValue === null) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "missing gross total",
            };
          }
          if (!Array.isArray(body.artists)) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "missing artists array",
            };
          }
          if (body.artists.length > 0) {
            const firstArtist = body.artists[0] || {};
            if (
              !firstArtist.artistId ||
              typeof firstArtist.artistName !== "string" ||
              typeof firstArtist.orders30d !== "number" ||
              typeof firstArtist.gross30d !== "number" ||
              typeof firstArtist.units30d !== "number" ||
              typeof firstArtist.activeProductsCount !== "number"
            ) {
              throw {
                status: res.status,
                body: res.bodyText,
                message: "invalid artist portfolio row",
              };
            }
          }
          labelSummaryBody = body;
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Label dashboard summary alias (/api/label)", async () => {
          const res = await req("GET", "/api/label/dashboard/summary", { token: labelToken });
          if (res.status !== 200) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Label summary alias parity (status + shape)", async () => {
          const canonical = await req("GET", "/api/labels/dashboard/summary", {
            token: labelToken,
          });
          if (canonical.status !== 200) {
            throwRes(canonical);
          }

          const alias = await req("GET", "/api/label/dashboard/summary", {
            token: labelToken,
          });
          if (alias.status !== 200) {
            throwRes(alias);
          }

          const canonicalBody = canonical.json || {};
          const aliasBody = alias.json || {};
          const requiredKeys = ["totalArtists", "activeArtists30d", "inactiveArtists", "artists"];
          for (const key of requiredKeys) {
            if (!(key in canonicalBody)) {
              throw {
                status: canonical.status,
                body: canonical.bodyText,
                message: `canonical response missing ${key}`,
              };
            }
            if (!(key in aliasBody)) {
              throw {
                status: alias.status,
                body: alias.bodyText,
                message: `alias response missing ${key}`,
              };
            }
          }

          return { status: alias.status, body: alias.bodyText };
        })
      );

      stepResults.push(
        await runStep("Label artist detail summary", async () => {
          if (!artistId) {
            throw {
              status: 500,
              body: null,
              message: "missing artistId",
            };
          }
          const res = await req("GET", `/api/labels/artists/${artistId}/summary`, {
            token: labelToken,
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          const body = res.json || {};
          if (
            body.artistId !== artistId ||
            typeof body.artistName !== "string" ||
            typeof body.orders30d !== "number" ||
            typeof body.gross30d !== "number" ||
            typeof body.units30d !== "number" ||
            typeof body.activeProductsCount !== "number"
          ) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "invalid label artist detail payload",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Label artist detail summary alias (/api/label)", async () => {
          if (!artistId) {
            throw {
              status: 500,
              body: null,
              message: "missing artistId",
            };
          }
          const res = await req("GET", `/api/label/artists/${artistId}/summary`, {
            token: labelToken,
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Label artist detail unmapped forbidden", async () => {
          const res = await req(
            "GET",
            "/api/labels/artists/00000000-0000-0000-0000-000000000009/summary",
            { token: labelToken }
          );
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer cannot access label summary", async () => {
          const res = await req("GET", "/api/labels/dashboard/summary", { token: buyerToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Artist cannot access label summary", async () => {
          const res = await req("GET", "/api/labels/dashboard/summary", { token: artistToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin cannot access label summary", async () => {
          const res = await req("GET", "/api/labels/dashboard/summary", { token: adminToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Label dashboard orders", async () => {
          const res = await req(
            "GET",
            "/api/labels/dashboard/orders?status=all&range=30d&sort=default&limit=10",
            { token: labelToken }
          );
          if (res.status !== 200) {
            throwRes(res);
          }
          const orders = Array.isArray(res.json?.orders)
            ? res.json.orders
            : Array.isArray(res.json?.items)
            ? res.json.items
            : [];
          const artists = Array.isArray(labelSummaryBody?.artists)
            ? labelSummaryBody.artists
            : [];
          const hasRecentPortfolioActivity =
            Number(labelSummaryBody?.activeArtists30d ?? 0) > 0 ||
            artists.some((artist) => Number(artist?.orders30d ?? 0) > 0);
          if (orders.length === 0) {
            if (hasRecentPortfolioActivity) {
              throw {
                status: res.status,
                body: res.bodyText,
                message: "orders missing while summary reports recent activity",
              };
            }
            return { status: res.status, body: res.bodyText };
          }
          const linkedArtistIds = [artistId].filter(Boolean);
          for (const order of orders) {
            if (!Array.isArray(order.items)) {
              throw {
                status: res.status,
                body: res.bodyText,
                message: "items missing",
              };
            }
            const hasLinkedArtist = order.items.some((item) =>
              linkedArtistIds.includes(item.artistId)
            );
            if (!hasLinkedArtist) {
              throw {
                status: res.status,
                body: res.bodyText,
                message: "order contains unlinked artist",
              };
            }
          }
          const matching = orders.filter((order) =>
            order.items.some(
              (item) =>
                item.productId === productId && linkedArtistIds.includes(item.artistId)
            )
          );
          if (!matching.length) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "link orders missing product",
            };
          }
          for (const order of orders) {
            const orderIdValue = order.orderId ?? order.id;
            if (!orderIdValue || !order.status || order.totalCents == null || !order.createdAt || !order.buyerUserId) {
              throw {
                status: res.status,
                body: res.bodyText,
                message: "order missing fields",
              };
            }
            if (!Array.isArray(order.items)) {
              throw {
                status: res.status,
                body: res.bodyText,
                message: "items missing",
              };
            }
            for (const item of order.items) {
              if (
                !item.productId ||
                !item.productVariantId ||
                typeof item.quantity !== "number" ||
                typeof item.priceCents !== "number" ||
                !item.artistId
              ) {
                throw {
                  status: res.status,
                  body: res.bodyText,
                  message: "item missing fields",
                };
              }
            }
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin finds pending artist request", async () => {
          const res = await req("GET", "/api/admin/artist-access-requests?status=pending", {
            token: adminToken,
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          const items = Array.isArray(res.json?.items)
            ? res.json.items
            : Array.isArray(res.json)
            ? res.json
            : [];
          const match = items.find(
            (item) =>
              (item.handle && item.handle.toLowerCase() === pendingArtistRequestHandle?.toLowerCase()) ||
              (item.contactEmail && item.contactEmail.toLowerCase() === pendingArtistRequestEmail?.toLowerCase())
          );
          if (!match) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "pending request not found",
            };
          }
          pendingArtistRequestId = match.id;
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin approves artist request", async () => {
          if (!pendingArtistRequestId) {
            throw {
              status: 500,
              body: "",
              message: "missing pending request id",
            };
          }
          const res = await req(
            "POST",
            `/api/admin/artist-access-requests/${pendingArtistRequestId}/approve`,
            { token: adminToken }
          );
          if (res.status !== 200) {
            throwRes(res);
          }
          if (res.json?.status !== "approved" || !res.json?.artistId) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "approval response invalid",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Requestor re-login after approval", async () => {
          const res = await req("POST", "/api/auth/login", {
            json: { email: requestorEmail, password: requestorPassword },
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (!res.json?.accessToken) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "missing accessToken after approval",
            };
          }
          requestorToken = res.json.accessToken;
          return { status: res.status };
        })
      );

      stepResults.push(
        await runStep("Buyer cannot access label orders", async () => {
          const res = await req("GET", "/api/labels/dashboard/orders", { token: buyerToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Artist cannot access label orders", async () => {
          const res = await req("GET", "/api/labels/dashboard/orders", { token: artistToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin cannot access label orders", async () => {
          const res = await req("GET", "/api/labels/dashboard/orders", { token: adminToken });
          if (res.status !== 403) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );
    } else {
      logSkip("Buyer order detail shows unpaid payment", "order creation failed");
      logSkip("Buyer lists my orders", "order creation failed");
      logSkip("Buyer gets order detail", "order creation failed");
    }
  } else {
    logSkip("Buyer views products", "no productId");
    logSkip("Buyer views product detail", "no productId");
  }

  stepResults.push(
    await runStep("Artist cannot list orders", async () => {
      const res = await req("GET", "/api/orders/my", { token: artistToken });
      if (res.status !== 403) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Admin creates artist drop draft", async () => {
      if (!artistId) {
        throw {
          status: 400,
          message: "missing artistId",
          body: "",
          method: "POST",
          url: "/api/admin/drops",
        };
      }
      const suffix = uniqueSuffix();
      dropHandle = `smoke-drop-${suffix}`;
      const res = await req("POST", "/api/admin/drops", {
        token: adminToken,
        json: {
          handle: dropHandle,
          title: "Smoke Drop",
          artistId,
        },
      });
      if (![200, 201].includes(res.status)) {
        throwRes(res);
      }
      if (!res.json?.drop?.handle) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "drop handle missing",
        };
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Artist scoped drops list includes own drop", async () => {
      if (!dropHandle || !artistId) {
        throw {
          status: 400,
          body: "",
          message: "missing drop context",
        };
      }
      const res = await req("GET", "/api/artist/drops", { token: artistToken });
      if (res.status !== 200) {
        throwRes(res);
      }
      const items = Array.isArray(res.json?.items)
        ? res.json.items
        : Array.isArray(res.json)
        ? res.json
        : [];
      const match = items.find(
        (item) => item?.handle === dropHandle || item?.id === dropHandle
      );
      if (!match) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "artist drops list missing own drop",
        };
      }
      if ((match?.artistId && match.artistId !== artistId) || (match?.artist_id && match.artist_id !== artistId)) {
        throw {
          status: res.status,
          body: res.bodyText,
          message: "artist drops list returned mismatched artist",
        };
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Artist cannot create drop via artist scope", async () => {
      const suffix = uniqueSuffix();
      const res = await req("POST", "/api/artist/drops", {
        token: artistToken,
        json: {
          handle: `artist-forbidden-${suffix}`,
          title: "Forbidden Artist Create",
          artistId,
        },
      });
      if (res.status !== 403) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  stepResults.push(
    await runStep("Buyer cannot see draft drop", async () => {
      if (!dropHandle) {
        throw {
          status: 400,
          body: "",
          message: "missing dropHandle",
        };
      }
      const res = await req("GET", `/api/drops/${dropHandle}`);
      if (res.status !== 404) {
        throwRes(res);
      }
      return { status: res.status, body: res.bodyText };
    })
  );

  const dropProductStep = async () => {
    if (!productId || !dropHandle) {
      logSkip("Admin attaches product to drop", "missing productId or dropHandle");
      logSkip("Artist cannot attach product in artist scope", "missing productId or dropHandle");
      logSkip("Artist cannot publish foreign drop (403)", "dependent on foreign drop creation");
      logSkip("Artist cannot unpublish foreign drop (403)", "dependent on foreign drop creation");
      logSkip("Artist publishes own drop via artist scope", "dependent on drop creation");
      logSkip("Buyer views published drop", "dependent on publish");
      logSkip("Buyer views drop products", "dependent on publish");
      logSkip("Buyer sees featured drops", "dependent on publish");
      return;
    }

    stepResults.push(
      await runStep("Admin attaches product to drop", async () => {
        const res = await req("POST", `/api/admin/drops/${dropHandle}/products`, {
          token: adminToken,
          json: { productId },
        });
        if (res.status !== 200) {
          throwRes(res);
        }
        return { status: res.status, body: res.bodyText };
      })
    );

    stepResults.push(
      await runStep("Artist cannot attach product in artist scope", async () => {
        const res = await req("POST", `/api/artist/drops/${dropHandle}/products`, {
          token: artistToken,
          json: { productId },
        });
        if (res.status !== 403) {
          throwRes(res);
        }
        return { status: res.status, body: res.bodyText };
      })
    );

    stepResults.push(
      await runStep("Admin creates foreign artist drop", async () => {
        const suffix = uniqueSuffix();
        const foreignArtistHandle = `foreign-artist-${suffix}`;
        const createArtistRes = await req("POST", "/api/admin/provisioning/create-artist", {
          token: adminToken,
          json: {
            handle: foreignArtistHandle,
            name: `Foreign Artist ${suffix}`,
            theme: {},
          },
        });
        if (![200, 409].includes(createArtistRes.status)) {
          throwRes(createArtistRes);
        }
        const foreignArtistId = createArtistRes.json?.artist?.id;
        if (!foreignArtistId) {
          throw {
            status: createArtistRes.status,
            body: createArtistRes.bodyText,
            message: "missing foreign artist id",
          };
        }
        foreignDropHandle = `foreign-drop-${suffix}`;
        const createDropRes = await req("POST", "/api/admin/drops", {
          token: adminToken,
          json: {
            handle: foreignDropHandle,
            title: "Foreign Artist Drop",
            artistId: foreignArtistId,
          },
        });
        if (![200, 201].includes(createDropRes.status)) {
          throwRes(createDropRes);
        }
        return { status: createDropRes.status, body: createDropRes.bodyText };
      })
    );

    stepResults.push(
      await runStep("Artist cannot publish foreign drop (403)", async () => {
        if (!foreignDropHandle) {
          throw {
            status: 400,
            body: "",
            message: "missing foreignDropHandle",
          };
        }
        const res = await req("POST", `/api/artist/drops/${foreignDropHandle}/publish`, {
          token: artistToken,
        });
        if (res.status !== 403) {
          throwRes(res);
        }
        return { status: res.status, body: res.bodyText };
      })
    );

    stepResults.push(
      await runStep("Artist cannot unpublish foreign drop (403)", async () => {
        if (!foreignDropHandle) {
          throw {
            status: 400,
            body: "",
            message: "missing foreignDropHandle",
          };
        }
        const res = await req("POST", `/api/artist/drops/${foreignDropHandle}/unpublish`, {
          token: artistToken,
        });
        if (res.status !== 403) {
          throwRes(res);
        }
        return { status: res.status, body: res.bodyText };
      })
    );

    stepResults.push(
      await runStep("Buyer order events include placed", async () => {
        if (!firstOrderId) {
          throw {
            status: 400,
            body: "",
            message: "missing firstOrderId",
          };
        }
        const res = await req("GET", `/api/orders/${firstOrderId}/events`, { token: buyerToken });
        if (res.status !== 200) {
          throwRes(res);
        }
        if (!Array.isArray(res.json?.items) || !res.json.items.some((event) => event.type === "placed")) {
          throw {
            status: res.status,
            body: res.bodyText,
            message: "placed event missing",
          };
        }
        return { status: res.status, body: res.bodyText };
      })
    );

    stepResults.push(
      await runStep("Artist publishes own drop via artist scope", async () => {
        const res = await req("POST", `/api/artist/drops/${dropHandle}/publish`, {
          token: artistToken,
        });
        if (res.status !== 200) {
          throwRes(res);
        }
        if (res.json?.drop?.status !== "published") {
          throw {
            status: res.status,
            body: res.bodyText,
            message: "drop not published",
          };
        }
        dropPublished = true;
        return { status: res.status, body: res.bodyText };
      })
    );

    stepResults.push(
      await runStep("Buyer views published drop", async () => {
        const res = await req("GET", `/api/drops/${dropHandle}`);
        if (res.status !== 200) {
          throwRes(res);
        }
        if (res.json?.drop?.status !== "published") {
          throw {
            status: res.status,
            body: res.bodyText,
            message: "drop not published",
          };
        }
        return { status: res.status, body: res.bodyText };
      })
    );

    stepResults.push(
      await runStep("Buyer views drop products", async () => {
        const res = await req("GET", `/api/drops/${dropHandle}/products`);
        if (res.status !== 200) {
          throwRes(res);
        }
        if (
          !Array.isArray(res.json?.items) ||
          !res.json.items.some((item) => item.id === productId)
        ) {
          throw {
            status: res.status,
            body: res.bodyText,
            message: "product not listed",
          };
        }
        return { status: res.status, body: res.bodyText };
      })
    );

    stepResults.push(
      await runStep("Buyer sees featured drops", async () => {
        const res = await req("GET", "/api/drops/featured");
        if (res.status !== 200) {
          throwRes(res);
        }
        if (!Array.isArray(res.json?.items)) {
          throw {
            status: res.status,
            body: res.bodyText,
            message: "missing featured list",
          };
        }
        return { status: res.status, body: res.bodyText };
      })
    );

    if (dropPublished) {
      stepResults.push(
        await runStep("Artist unpublishes own drop via artist scope", async () => {
          const res = await req("POST", `/api/artist/drops/${dropHandle}/unpublish`, {
            token: artistToken,
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (res.json?.drop?.status !== "draft") {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "drop not draft",
            };
          }
          dropPublished = false;
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer cannot see draft drop", async () => {
          const res = await req("GET", `/api/drops/${dropHandle}`);
          if (res.status !== 404) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Admin archives drop", async () => {
          const res = await req("POST", `/api/admin/drops/${dropHandle}/archive`, {
            token: adminToken,
          });
          if (res.status !== 200) {
            throwRes(res);
          }
          if (res.json?.drop?.status !== "archived") {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "drop not archived",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer cannot see archived drop", async () => {
          const res = await req("GET", `/api/drops/${dropHandle}`);
          if (res.status !== 404) {
            throwRes(res);
          }
          return { status: res.status, body: res.bodyText };
        })
      );

      stepResults.push(
        await runStep("Buyer sees featured drops without archived", async () => {
          const res = await req("GET", "/api/drops/featured");
          if (res.status !== 200) {
            throwRes(res);
          }
          if (!Array.isArray(res.json?.items)) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "missing featured list",
            };
          }
          if (res.json.items.some((item) => item.handle === dropHandle)) {
            throw {
              status: res.status,
              body: res.bodyText,
              message: "archived drop still featured",
            };
          }
          return { status: res.status, body: res.bodyText };
        })
      );
    } else {
      logSkip("Artist unpublishes own drop via artist scope", "drop not published");
      logSkip("Buyer cannot see draft drop", "drop not published");
      logSkip("Admin archives drop", "drop not published");
      logSkip("Buyer cannot see archived drop", "drop not published");
      logSkip("Buyer sees featured drops without archived", "drop not published");
    }
  };

  await dropProductStep();

  const failed = stepResults.some((result) => result === false);
  writeReport();
  process.exit(failed ? 1 : 0);
})();


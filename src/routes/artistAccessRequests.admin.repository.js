const { randomUUID } = require("crypto");
const {
  ADMIN_REQUEST_LIST_COLUMNS,
  normalizeRequestedPlanType,
  pickExistingColumns,
  slugifyHandle,
  trim,
} = require("./artistAccessRequests.admin.validators");
const {
  assertArtistAccessRequestAdminSchema,
  assertArtistAccessRequestMediaSchema,
  assertAdminArtistSubscriptionSchema,
} = require("../core/db/schemaContract");

const pad2 = (value) => String(value).padStart(2, "0");
const toLocalDateString = (value) =>
  `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;

const getSubscriptionDateWindow = () => {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() + 7);
  return {
    startDate: toLocalDateString(start),
    endDate: toLocalDateString(end),
  };
};

const getRequestById = async (trx, id) => trx("artist_access_requests").where({ id }).first();

const updateRequestById = async (trx, id, updates) =>
  trx("artist_access_requests").where({ id }).update(updates);

const getRequestColumns = async (trx) =>
  (await assertArtistAccessRequestAdminSchema(trx)).requestColumns;

const getArtistColumns = async (trx) => (await assertArtistAccessRequestAdminSchema(trx)).artistColumns;

const findUserByEmail = async (trx, email) =>
  trx("users")
    .whereRaw("lower(trim(email)) = lower(trim(?))", [email])
    .first("id", "email", "role");

const upsertArtistRoleUser = async ({ trx, email, passwordHash }) => {
  const existing = await findUserByEmail(trx, email);
  if (existing?.id) {
    await trx("users").where({ id: existing.id }).update({
      role: "artist",
      password_hash: passwordHash,
    });
    return { id: existing.id, email: existing.email || email, created: false };
  }

  const id = randomUUID();
  await trx("users").insert({
    id,
    email,
    password_hash: passwordHash,
    role: "artist",
    created_at: trx.fn.now(),
  });
  return { id, email, created: true };
};

const ensureUniqueHandle = async (trx, base) => {
  let suffix = 0;
  let candidate = base;
  while (
    await trx("artists")
      .whereRaw("lower(handle) = lower(?)", [candidate])
      .first("id")
  ) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
};

const resolveLabelIdForRequestor = async (trx, requestorUserId) => {
  const normalizedRequestorUserId = trim(requestorUserId);
  if (!normalizedRequestorUserId) return null;

  const row = await trx("label_users_map")
    .where({ user_id: normalizedRequestorUserId })
    .first("label_id");
  return row?.label_id || null;
};

const createArtistFromRequest = async ({ trx, request, userId }) => {
  const requestedName = trim(request.artist_name || request.name) || "Unknown Artist";
  const requestedHandle = trim(request.handle || request.handle_suggestion);
  const handleBase = slugifyHandle(requestedHandle || requestedName);
  const handle = await ensureUniqueHandle(trx, handleBase);

  const artistColumns = await getArtistColumns(trx);
  const insertPayload = {
    id: randomUUID(),
    handle,
    name: requestedName,
    created_at: trx.fn.now(),
  };

  if (Object.prototype.hasOwnProperty.call(artistColumns, "email")) {
    insertPayload.email = trim(request.email || request.contact_email) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "phone")) {
    insertPayload.phone = trim(request.phone || request.contact_phone) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "about_me")) {
    insertPayload.about_me = trim(request.about_me || request.pitch) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "profile_photo_url")) {
    insertPayload.profile_photo_url =
      trim(request.profile_photo_url || request.profile_photo_path) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "message_for_fans")) {
    insertPayload.message_for_fans = trim(request.message_for_fans) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "socials")) {
    insertPayload.socials = request.socials ?? [];
  }

  const [artistRow] = await trx("artists")
    .insert(insertPayload)
    .returning(["id", "handle", "name"]);

  const artistUpdates = {};
  if (Object.prototype.hasOwnProperty.call(artistColumns, "phone")) {
    artistUpdates.phone = trim(request.phone || request.contact_phone) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "about_me")) {
    artistUpdates.about_me = trim(request.about_me || request.pitch) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "message_for_fans")) {
    artistUpdates.message_for_fans = trim(request.message_for_fans) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "socials")) {
    artistUpdates.socials = request.socials ?? [];
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "email")) {
    artistUpdates.email = trim(request.email || request.contact_email) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "updated_at")) {
    artistUpdates.updated_at = trx.fn.now();
  }
  if (Object.keys(artistUpdates).length > 0) {
    await trx("artists").where({ id: artistRow.id }).update(artistUpdates);
  }

  await trx("artist_user_map")
    .insert({
      id: randomUUID(),
      artist_id: artistRow.id,
      user_id: userId,
    })
    .onConflict(["artist_id", "user_id"])
    .ignore();

  const labelIdCandidate = await resolveLabelIdForRequestor(
    trx,
    request.requestor_user_id || request.requestorUserId || null
  );
  if (labelIdCandidate) {
    await trx("label_artist_map")
      .insert({
        id: randomUUID(),
        label_id: labelIdCandidate,
        artist_id: artistRow.id,
      })
      .onConflict(["label_id", "artist_id"])
      .ignore();
  }

  return artistRow;
};

const createArtistSubscription = async ({
  trx,
  artistId,
  request,
  approvalPayload,
  adminId,
}) => {
  const existingActiveSubscription = await trx("artist_subscriptions")
    .where({ artist_id: artistId, status: "active" })
    .first("id");
  if (existingActiveSubscription?.id) {
    return { conflict: true, subscriptionId: existingActiveSubscription.id };
  }

  const { startDate, endDate } = getSubscriptionDateWindow();
  const now = trx.fn.now();
  const { artist_subscriptions: subscriptionColumns } = await assertAdminArtistSubscriptionSchema(
    trx
  );
  const subscriptionInsert = {
    artist_id: artistId,
    requested_plan_type: normalizeRequestedPlanType(request),
    approved_plan_type: approvalPayload.final_plan_type,
    start_date: startDate,
    end_date: endDate,
    payment_mode: approvalPayload.payment_mode,
    transaction_id: approvalPayload.transaction_id,
    status: "active",
  };

  if (Object.prototype.hasOwnProperty.call(subscriptionColumns, "approved_by_admin_id")) {
    subscriptionInsert.approved_by_admin_id = adminId || null;
  }
  if (Object.prototype.hasOwnProperty.call(subscriptionColumns, "approved_at")) {
    subscriptionInsert.approved_at = now;
  }
  if (Object.prototype.hasOwnProperty.call(subscriptionColumns, "created_at")) {
    subscriptionInsert.created_at = now;
  }
  if (Object.prototype.hasOwnProperty.call(subscriptionColumns, "updated_at")) {
    subscriptionInsert.updated_at = now;
  }

  const inserted = await trx("artist_subscriptions").insert(subscriptionInsert).returning(["id"]);
  return { conflict: false, id: inserted?.[0]?.id || null };
};

const listRequests = async ({ db, status, page, pageSize }) => {
  const requestSchema = await assertArtistAccessRequestAdminSchema(db);
  await assertArtistAccessRequestMediaSchema(db);
  const requestColumnInfo = requestSchema.requestColumns;
  const offset = (page - 1) * pageSize;
  const [{ total = 0 } = {}] = await db("artist_access_requests")
    .where("status", status)
    .count({ total: "id" });

  const selectColumns = pickExistingColumns(requestColumnInfo, ADMIN_REQUEST_LIST_COLUMNS);
  const baseSelections = selectColumns.map(
    (column) => `artist_access_requests.${column} as ${column}`
  );
  const rowsQuery = db("artist_access_requests")
    .where("artist_access_requests.status", status)
    .orderBy("artist_access_requests.created_at", "desc")
    .orderBy("artist_access_requests.id", "desc")
    .limit(pageSize)
    .offset(offset)
    .select(baseSelections);

  rowsQuery
    .leftJoin("entity_media_links", function () {
      this.on("entity_media_links.entity_id", "=", "artist_access_requests.id")
        .andOnVal("entity_media_links.entity_type", "=", "artist_access_request")
        .andOnVal("entity_media_links.role", "=", "profile_photo");
    })
    .leftJoin("media_assets", "media_assets.id", "entity_media_links.media_asset_id")
    .select("media_assets.public_url as profile_photo_media_url");

  const rows = await rowsQuery;
  return { rows, total: Number(total) };
};

const countPendingRequests = async (db) => {
  const [{ count = 0 } = {}] = await db("artist_access_requests")
    .where({ status: "pending" })
    .count({ count: "id" });
  return Number(count);
};

module.exports = {
  getSubscriptionDateWindow,
  getRequestById,
  updateRequestById,
  getRequestColumns,
  findUserByEmail,
  upsertArtistRoleUser,
  createArtistFromRequest,
  createArtistSubscription,
  listRequests,
  countPendingRequests,
};

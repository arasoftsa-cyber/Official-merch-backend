const express = require("express");
const { requireAuth } = require("../core/http/auth.middleware");
const { requirePolicy } = require("../core/http/policy.middleware");
const { isUuid } = require("./artistAccessRequests.admin.validators");
const {
  normalizeAdminArtistAccessApprovalPayload,
  validateAdminArtistAccessApprovalPayload,
  normalizeAdminArtistAccessRejectionPayload,
  validateAdminArtistAccessRejectionPayload,
  normalizeAdminArtistAccessListQuery,
} = require("../contracts/artistAccessRequest.contract");
const { logLegacyContractUse } = require("../contracts/shared");
const {
  approveArtistRequestAction,
  processApproval,
  processRejection,
  listAdminArtistAccessRequests,
  getPendingCount,
  sendApprovalEmail,
  sendRejectionEmail,
  getSubscriptionDateWindow,
  mapRow,
  ADMIN_REQUEST_LIST_COLUMNS,
} = require("./artistAccessRequests.admin.service");

const ROUTER = express.Router();
const readPolicy = requirePolicy("admin_dashboard:read", "artist_access_requests");
const writePolicy = requirePolicy("admin_dashboard:write", "artist_access_requests");

ROUTER.get("/", requireAuth, readPolicy, async (req, res) => {
  try {
    const { dto } = normalizeAdminArtistAccessListQuery(req.query || {});
    const result = await listAdminArtistAccessRequests({ query: dto });
    return res.status(result.httpStatus).json(result.payload);
  } catch (err) {
    console.error("artist-access-requests admin list error", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

ROUTER.get("/pending-count", requireAuth, readPolicy, async (_req, res) => {
  try {
    const result = await getPendingCount();
    return res.status(result.httpStatus).json(result.payload);
  } catch (err) {
    console.error("pending-count failed", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

ROUTER.post("/:id/approve", requireAuth, writePolicy, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: "validation_error", message: "Invalid id" });
    }

    const { dto, meta } = normalizeAdminArtistAccessApprovalPayload(req.body || {});
    validateAdminArtistAccessApprovalPayload(dto);
    logLegacyContractUse({
      workflow: "artist_access_requests.admin.approve",
      legacyKeys: meta.legacyKeys,
    });

    const approval = await approveArtistRequestAction({
      id: req.params.id,
      adminId: req.user?.id || null,
      body: dto,
    });
    if (approval.httpStatus !== 200) {
      return res.status(approval.httpStatus).json(approval.payload);
    }

    const result = approval.result;
    void sendApprovalEmail({
      email: result.email,
      artistName: result.artistName,
    });

    return res.status(200).json({
      ok: true,
      status: "approved",
      requestId: req.params.id,
      artistId: result.artist?.id ?? null,
      userId: result.user?.id ?? null,
    });
  } catch (err) {
    if (err?.status === 400) {
      return res.status(400).json({
        error: err.code || "validation_error",
        message: err.message || "Invalid approval payload",
      });
    }
    console.error("[approve_artist_request]", err?.stack || err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

ROUTER.post("/:id/reject", requireAuth, writePolicy, express.json(), async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: "validation_error", message: "Invalid id" });
    }

    const { dto, meta } = normalizeAdminArtistAccessRejectionPayload(req.body || {});
    validateAdminArtistAccessRejectionPayload(dto);
    logLegacyContractUse({
      workflow: "artist_access_requests.admin.reject",
      legacyKeys: meta.legacyKeys,
    });

    const result = await processRejection({
      id: req.params.id,
      adminId: req.user?.id || null,
      comment: dto.comment,
    });

    if (result.notFound) {
      return res.status(404).json({ error: "not_found", message: "Request not found" });
    }
    if (result.invalidTransition) {
      return res.status(409).json({
        error: "invalid_transition",
        message: `Cannot transition from ${result.currentStatus} to rejected`,
      });
    }

    if (result.email) {
      void sendRejectionEmail({
        email: result.email,
        artistName: result.artistName,
        comment: dto.comment,
      });
    }

    return res.status(200).json({ status: "rejected" });
  } catch (err) {
    if (err?.status === 400) {
      return res.status(400).json({
        error: err.code || "validation_error",
        message: err.message || "Invalid rejection payload",
      });
    }
    console.error("[reject_artist_request]", err?.stack || err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

module.exports = ROUTER;
module.exports.__test = {
  processApproval,
  approveArtistRequestAction,
  getSubscriptionDateWindow,
  mapRow,
  ADMIN_REQUEST_LIST_COLUMNS,
};

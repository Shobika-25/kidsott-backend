"use strict";

// KIDSOTT_REELS_READ_API_V1

const express = require("express");
const authenticate = require("../middleware/auth.middleware");
const requireAdmin = require("../middleware/admin.middleware");

const {
  getPublishedReels,
  getAdminReels,
  createCatalogDraftReel
} = require("../controllers/reels.controller");

const {
  requireHostedAiven,
  createUploadedReelDraft
} = require("../controllers/reels-upload.controller");
const reelsDb = require("../config/db");
const router = express.Router();

// KIDSOTT_REELS_HOSTED_ONLY_V1
// Fail closed before any Reels authentication or database query.
// Existing non-Reels APIs are not modified.
router.use((req, res, next) => {
  const pool = reelsDb.pool || reelsDb;
  const config = pool?.config?.connectionConfig;

  const approved =
    config &&
    config.host ===
      "kidsott-mysql-shobi5002-05dc.i.aivencloud.com" &&
    Number(config.port) === 10111 &&
    config.database === "kidsott_db_v2" &&
    Boolean(config.ssl) &&
    config.ssl.rejectUnauthorized !== false;

  if (!approved) {
    return res.status(503).json({
      success: false,
      message: "Approved hosted Reels database required."
    });
  }

  next();
});

// KIDSOTT_REELS_CATALOG_DRAFT_V1
router.post(
  "/admin/catalog-draft",
  authenticate,
  requireAdmin,
  createCatalogDraftReel
);

router.get(
  "/admin/all",
  authenticate,
  requireAdmin,
  getAdminReels
);

router.get(
  "/",
  getPublishedReels
);

// KIDSOTT_REELS_UPLOAD_DRAFT_V1
// Disabled unless explicitly enabled for hosted Aiven testing.
router.post(
  "/admin/upload-draft",
  requireHostedAiven,
  authenticate,
  requireAdmin,
  createUploadedReelDraft
);
// KIDSOTT_REELS_ACTIONS_API_05F_V1
// Registration after all specific /admin paths; no public write endpoints.
router.patch("/admin/:id", authenticate, requireAdmin,
  require("../controllers/reels.controller").updateAdminReel);
router.post("/admin/:id/visibility", authenticate, requireAdmin,
  require("../controllers/reels.controller").changeReelVisibility);

// KIDSOTT_REELS_ENGAGEMENT_B1
const reelsEngagement = require("../controllers/reels-engagement.controller");

router.get(
  "/admin/engagement",
  authenticate,
  requireAdmin,
  reelsEngagement.getAdminEngagement
);

router.get(
  "/:id/engagement",
  reelsEngagement.getEngagement
);

router.get(
  "/:id/my-like",
  authenticate,
  reelsEngagement.getMyLike
);

router.put(
  "/:id/like",
  authenticate,
  reelsEngagement.putLike
);

router.delete(
  "/:id/like",
  authenticate,
  reelsEngagement.deleteLike
);

// KIDSOTT_REELS_SAVES_39D
// Opt-in: protected per-user saves; DB schema must be manually approved first.
const reelSaves = require("../controllers/reels-saves.controller");
router.get("/me/saved", authenticate, reelSaves.getSavedReels);
router.get("/:id/my-save", authenticate, reelSaves.getMySave);
router.put("/:id/save", authenticate, reelSaves.putSave);
router.delete("/:id/save", authenticate, reelSaves.deleteSave);
// KIDSOTT_REELS_COMMENTS_READONLY_B2A
const reelComments = require("../controllers/reels-comments.controller");

router.get(
  "/admin/comments",
  authenticate,
  requireAdmin,
  reelComments.getAdminComments
);

router.get(
  "/:id/comments",
  reelComments.getPublicComments
);
// KIDSOTT_REELS_MODERATED_SUBMISSION_FINAL_V1
router.post(
  "/:id/comments",
  authenticate,
  reelComments.submitComment
);

// KIDSOTT_REELS_COMMENTS_MODERATION_B2B
router.patch(
  "/admin/comments/:id/moderate",
  authenticate,
  requireAdmin,
  reelComments.moderateComment
);
module.exports = router;
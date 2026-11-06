const express =
  require("express");

const authenticate =
  require(
    "../middleware/auth.middleware"
  );

const requireAdmin =
  require(
    "../middleware/admin.middleware"
  );

const {
  getVideos,
  getVideoById,
  getAdminVideos,
  createVideo,
  updateVideo,
  deleteVideo,
} = require(
  "../controllers/video.controller"
);

const {
  getVideoRatingSummary,
  getMyVideoRating,
  upsertMyVideoRating,
} = require('../controllers/video-rating.controller');
const router =
  express.Router();

router.get(
  "/",
  getVideos
);

router.get(
  "/admin/all",
  authenticate,
  requireAdmin,
  getAdminVideos
);

// KIDSOTT_DB_RATINGS_V1: local-only API routes. No hosted migration/deploy here.
router.get('/:id/ratings', getVideoRatingSummary);
router.get('/:id/my-rating', authenticate, getMyVideoRating);
router.put('/:id/rating', authenticate, upsertMyVideoRating);
router.get(
  "/:id",
  getVideoById
);

router.post(
  "/",
  authenticate,
  requireAdmin,
  createVideo
);

router.put(
  "/:id",
  authenticate,
  requireAdmin,
  updateVideo
);

router.delete(
  "/:id",
  authenticate,
  requireAdmin,
  deleteVideo
);

module.exports = router;

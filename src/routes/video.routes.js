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

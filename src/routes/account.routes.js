const express =
  require("express");

const authenticate =
  require(
    "../middleware/auth.middleware"
  );

const {
  getProfile,
  updateProfile,
  getSettings,
  updateSettings,
} = require(
  "../controllers/account.controller"
);

const router =
  express.Router();

router.use(
  authenticate
);

router.get(
  "/profile",
  getProfile
);

router.put(
  "/profile",
  updateProfile
);

router.get(
  "/settings",
  getSettings
);

router.put(
  "/settings",
  updateSettings
);

module.exports =
  router;

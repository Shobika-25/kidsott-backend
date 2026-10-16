const express =
  require("express");

const authenticate =
  require(
    "../middleware/auth.middleware"
  );

const {
  getFavorites,
  addFavorite,
  removeFavorite,
  getHistory,
  saveHistory,
  removeHistory,
  clearHistory,
  syncLibrary,
} = require(
  "../controllers/library.controller"
);

const router =
  express.Router();

router.use(
  authenticate
);

router.get(
  "/favorites",
  getFavorites
);

router.put(
  "/favorites/:videoId",
  addFavorite
);

router.delete(
  "/favorites/:videoId",
  removeFavorite
);

router.get(
  "/history",
  getHistory
);

router.put(
  "/history/:videoId",
  saveHistory
);

router.delete(
  "/history/:videoId",
  removeHistory
);

router.delete(
  "/history",
  clearHistory
);

router.post(
  "/sync",
  syncLibrary
);

module.exports =
  router;

const express =
  require("express");

const {
  getHomeSections,
} = require(
  "../controllers/home.controller"
);

const router =
  express.Router();

router.get(
  "/",
  getHomeSections,
);

router.get(
  "/sections",
  getHomeSections,
);

module.exports =
  router;

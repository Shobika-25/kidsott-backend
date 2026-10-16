const express =
  require("express");

const {
  getPublicHome,
} =
  require(
    "../controllers/home-public.controller"
  );


const router =
  express.Router();


router.get(
  "/",
  getPublicHome
);


module.exports =
  router;

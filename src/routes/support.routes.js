const express =
  require("express");

const authenticate =
  require(
    "../middleware/auth.middleware"
  );

const {
  getTickets,
  createTicket,
  removeTicket,
} = require(
  "../controllers/support.controller"
);

const router =
  express.Router();

router.use(
  authenticate
);

router.get(
  "/tickets",
  getTickets
);

router.post(
  "/tickets",
  createTicket
);

router.delete(
  "/tickets/:ticketId",
  removeTicket
);

module.exports =
  router;

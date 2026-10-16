// KidsOTT parent verification controller.
const {
  verifyParent,
} = require("../controllers/parent.controller");
const express =
  require("express");

const {
  register,
  login,
  me,
} = require(
  "../controllers/auth.controller"
);

const authenticate =
  require(
    "../middleware/auth.middleware"
  );

const requireAdmin =
  require(
    "../middleware/admin.middleware"
  );

const router =
  express.Router();

router.post(
  "/register",
  register
);

router.post(
  "/login",
  login
);

router.get(
  "/me",
  authenticate,
  me
);

router.get(
  "/admin-check",
  authenticate,
  requireAdmin,
  (req, res) => {
    res.status(200).json({
      success: true,
      message:
        "Admin authentication successful.",
      user: req.user,
    });
  }
);

// KIDSOTT_PARENT_VERIFY_ROUTE_V1
// The regular login JWT is required first.
// Password re-verification creates a short-lived grant.
// This endpoint does not activate a subscription.
router.post(
  "/verify-parent",
  authenticate,
  verifyParent
);
module.exports = router;

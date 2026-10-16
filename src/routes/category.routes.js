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
  getCategories,
  getAdminCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require(
  "../controllers/category.controller"
);

const router =
  express.Router();

router.get(
  "/",
  getCategories
);

router.get(
  "/admin/all",
  authenticate,
  requireAdmin,
  getAdminCategories
);

router.post(
  "/",
  authenticate,
  requireAdmin,
  createCategory
);

router.put(
  "/:id",
  authenticate,
  requireAdmin,
  updateCategory
);

router.delete(
  "/:id",
  authenticate,
  requireAdmin,
  deleteCategory
);

module.exports = router;

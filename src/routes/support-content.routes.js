const express =
  require("express");

const jwt =
  require("jsonwebtoken");

const {
  getContent,
  updateContact,
  replaceTypes,
  replaceFaqs,
} =
  require(
    "../controllers/support-content.controller"
  );


const router =
  express.Router();


function requireAdmin(
  req,
  res,
  next
) {
  try {

    const header =
      String(
        req.headers.authorization ||
        ""
      );


    const token =
      header.startsWith("Bearer ")
        ? header.slice(7)
        : "";


    if (!token) {

      return res.status(401).json({
        success: false,
        message:
          "Authentication required.",
      });
    }


    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );


    if (
      decoded?.role !== "admin"
    ) {

      return res.status(403).json({
        success: false,
        message:
          "Admin access required.",
      });
    }


    req.user =
      decoded;


    next();

  } catch {

    return res.status(401).json({
      success: false,
      message:
        "Invalid or expired token.",
    });
  }
}


router.get(
  "/",
  getContent
);


router.put(
  "/admin/contact",
  requireAdmin,
  updateContact
);


router.put(
  "/admin/types",
  requireAdmin,
  replaceTypes
);


router.put(
  "/admin/faqs",
  requireAdmin,
  replaceFaqs
);


module.exports =
  router;

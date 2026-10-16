const jwt = require("jsonwebtoken");

const db = require("../config/db");

async function authenticate(
  req,
  res,
  next
) {
  try {
    const header =
      req.headers.authorization;

    if (
      !header ||
      !header.startsWith("Bearer ")
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication token is required.",
      });
    }

    const token =
      header.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication token is required.",
      });
    }

    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    const [users] =
      await db.query(
        `
          SELECT
            id,
            name,
            email,
            role,
            is_active,
            created_at,
            updated_at
          FROM users
          WHERE id = ?
          LIMIT 1
        `,
        [decoded.id]
      );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message:
          "User account was not found.",
      });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message:
          "This account is disabled.",
      });
    }

    req.user = {
      id: Number(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      isActive:
        Boolean(user.is_active),
      createdAt:
        user.created_at,
      updatedAt:
        user.updated_at,
    };

    next();
  } catch (error) {
    if (
      error.name ===
        "JsonWebTokenError" ||
      error.name ===
        "TokenExpiredError"
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid or expired token.",
      });
    }

    console.error(
      "AUTH MIDDLEWARE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Authentication failed.",
    });
  }
}

module.exports =
  authenticate;

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../config/db");

function createToken(user) {
  return jwt.sign(
    {
      id: Number(user.id),
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
}

function sanitizeUser(user) {
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: Boolean(user.is_active),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

async function register(req, res) {
  try {
    const name = String(
      req.body.name || ""
    ).trim();

    const email = String(
      req.body.email || ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      req.body.password || ""
    );

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Name, email and password are required.",
      });
    }

    if (name.length < 2) {
      return res.status(400).json({
        success: false,
        message:
          "Name must contain at least 2 characters.",
      });
    }

    const emailPattern =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      return res.status(400).json({
        success: false,
        message:
          "Please enter a valid email address.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password must contain at least 6 characters.",
      });
    }

    const [existingUsers] =
      await db.query(
        `
          SELECT id
          FROM users
          WHERE email = ?
          LIMIT 1
        `,
        [email]
      );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          "An account with this email already exists.",
      });
    }

    const passwordHash =
      await bcrypt.hash(
        password,
        12
      );

    const [result] =
      await db.query(
        `
          INSERT INTO users (
            name,
            email,
            password_hash,
            role,
            is_active
          )
          VALUES (?, ?, ?, 'user', 1)
        `,
        [
          name,
          email,
          passwordHash,
        ]
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
        [result.insertId]
      );

    const user = users[0];

    const token =
      createToken(user);

    return res.status(201).json({
      success: true,
      message:
        "Account created successfully.",
      token,
      user:
        sanitizeUser(user),
    });
  } catch (error) {
    console.error(
      "REGISTER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to create account.",
    });
  }
}

async function login(req, res) {
  try {
    const email = String(
      req.body.email || ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      req.body.password || ""
    );

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Email and password are required.",
      });
    }

    const [users] =
      await db.query(
        `
          SELECT
            id,
            name,
            email,
            password_hash,
            role,
            is_active,
            created_at,
            updated_at
          FROM users
          WHERE email = ?
          LIMIT 1
        `,
        [email]
      );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid email or password.",
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

    const passwordMatches =
      await bcrypt.compare(
        password,
        user.password_hash
      );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid email or password.",
      });
    }

    const token =
      createToken(user);

    // KIDSOTT_LAST_LOGIN_TRACKING_V1
    // Run only after password verification and JWT creation.
    // Do not change the profile's updated_at timestamp.
    const [loginTracking] = await db.query(
      `UPDATE users
       SET last_login_at = CURRENT_TIMESTAMP(3),
           updated_at = updated_at
       WHERE id = ?
         AND is_active = 1`,
      [user.id]
    );

    if (Number(loginTracking.affectedRows) !== 1) {
      return res.status(403).json({
        success: false,
        message: "Account is no longer available."
      });
    }
    return res.status(200).json({
      success: true,
      message:
        "Login successful.",
      token,
      user:
        sanitizeUser(user),
    });
  } catch (error) {
    console.error(
      "LOGIN ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to login.",
    });
  }
}

async function me(req, res) {
  return res.status(200).json({
    success: true,
    user: req.user,
  });
}

module.exports = {
  register,
  login,
  me,
};

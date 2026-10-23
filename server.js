const homePublicRoutes = require("./src/routes/home-public.routes");
const homeRoutes = require("./src/routes/home.routes");
const supportContentRoutes = require("./src/routes/support-content.routes");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

const db = require("./src/config/db");
// KIDSOTT_SUBSCRIPTION_ROUTER_MOUNT_V1
const subscriptionRoutes = require("./src/routes/subscription.routes");
const authRoutes = require("./src/routes/auth.routes");
const categoryRoutes = require("./src/routes/category.routes");
const videoRoutes = require("./src/routes/video.routes");
const libraryRoutes = require("./src/routes/library.routes");
const accountRoutes = require("./src/routes/account.routes");
const supportRoutes = require("./src/routes/support.routes");

dotenv.config();

const app = express();

const PORT = Number(
  process.env.PORT || 5000
);

app.use(cors());

app.use(
  express.json({
    limit: "10mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);


/* =========================================================
   ROOT
========================================================= */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message:
      "Kids Stream Backend API is running",
  });
});


/* =========================================================
   API HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.status(200).json({
      success: true,
      service:
        "Kids Stream Backend",
      status: "healthy",
      timestamp:
        new Date().toISOString(),
    });
  },
);


/* =========================================================
   DATABASE HEALTH
========================================================= */

app.get(
  "/api/db-health",
  async (req, res) => {
    try {
      const [rows] =
        await db.query(
          "SELECT 1 AS connected"
        );

      res.status(200).json({
        success: true,
        database: "connected",
        result: rows[0],
      });
    } catch (error) {
      console.error(
        "DATABASE CONNECTION ERROR:",
        error.message
      );

      res.status(500).json({
        success: false,
        database:
          "not connected",
        message:
          error.message,
      });
    }
  },
);


/* =========================================================
   AUTH ROUTES
========================================================= */

app.use(
  "/api/auth",
  authRoutes
);


/* =========================================================
   CONTENT ROUTES
========================================================= */

app.use(
  "/api/categories",
  categoryRoutes
);

app.use(
  "/api/videos",
  videoRoutes
);


/* =========================================================
   404
========================================================= */

app.use(
  "/api/library",
  libraryRoutes
);

app.use(
  "/api/account",
  accountRoutes
);

app.use(
  "/api/support",
  supportRoutes
);

app.use(
  "/api/support-content",
  supportContentRoutes
);

app.use(
  "/api/home",
  homePublicRoutes
);

app.use(
  "/api/home",
  homeRoutes
);

/* =========================================================
   ADMIN API ROUTES
========================================================= */

app.use("/api/admin/home", require("./src/routes/admin-home.routes"));
app.use("/api/admin/users", require("./src/routes/admin-users.routes"));
app.use("/api/admin/subscriptions", require("./src/routes/admin-subscriptions.routes"));
app.use("/api/admin/support", require("./src/routes/admin-support.routes"));
app.use("/api/admin/settings", require("./src/routes/admin-settings.routes"));
app.use("/api/admin/dashboard", require("./src/routes/admin-dashboard.routes"));
app.use("/api/admin/reports", require("./src/routes/admin-reports.routes"));

/* =========================================================
   SUBSCRIPTION READ-ONLY API
========================================================= */

// GET /subscriptions/plans
// GET /subscriptions/me
// Actual purchases remain disabled.
app.use("/subscriptions", subscriptionRoutes);
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message:
      "API route not found",
  });
});


/* =========================================================
   SERVER
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log(
      "===================================="
    );

    console.log(
      " KIDS STREAM BACKEND"
    );

    console.log(
      "===================================="
    );

    console.log(
      `Server : http://localhost:${PORT}`
    );

    console.log(
      `Health : http://localhost:${PORT}/api/health`
    );

    console.log(
      `DB     : http://localhost:${PORT}/api/db-health`
    );

    console.log(
      "===================================="
    );

    console.log("");
  },
);










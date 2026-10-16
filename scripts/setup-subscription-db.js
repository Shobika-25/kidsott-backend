"use strict";

// KIDSOTT_SUBSCRIPTION_DATABASE_SETUP_V1
//
// Creates subscription database tables.
// Safe to rerun: CREATE TABLE IF NOT EXISTS and
// INSERT IGNORE are used.
//
// Important:
// - Does not activate Premium.
// - Does not create payments.
// - Does not verify store purchases.
// - Store product IDs must be configured later.

const db = require("../src/config/db");

const tables = [
  {
    name: "subscription_plans",
    sql: `
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

        plan_code VARCHAR(30) NOT NULL,
        display_name VARCHAR(100) NOT NULL,

        billing_period ENUM(
          'monthly',
          'yearly'
        ) NOT NULL,

        apple_product_id VARCHAR(190) NULL,

        google_product_id VARCHAR(190) NULL,
        google_base_plan_id VARCHAR(120) NULL,

        is_enabled TINYINT(1)
          NOT NULL DEFAULT 0,

        created_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP,

        updated_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),

        UNIQUE KEY uq_subscription_plan_code
          (plan_code),

        UNIQUE KEY uq_subscription_apple_product
          (apple_product_id),

        UNIQUE KEY uq_subscription_google_product
          (google_product_id, google_base_plan_id)

      ) ENGINE=InnoDB
        DEFAULT CHARSET=utf8mb4
        COLLATE=utf8mb4_unicode_ci
    `,
  },

  {
    name: "subscription_purchases",
    sql: `
      CREATE TABLE IF NOT EXISTS subscription_purchases (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

        user_id BIGINT UNSIGNED NOT NULL,
        plan_id BIGINT UNSIGNED NOT NULL,

        store ENUM(
          'google_play',
          'app_store'
        ) NOT NULL,

        environment ENUM(
          'sandbox',
          'production'
        ) NOT NULL,

        store_reference VARCHAR(190) NOT NULL,

        store_order_id VARCHAR(190) NULL,

        purchase_token_hash CHAR(64) NULL,

        encrypted_purchase_token TEXT NULL,

        status ENUM(
          'pending',
          'active',
          'grace_period',
          'billing_retry',
          'on_hold',
          'paused',
          'canceled',
          'expired',
          'revoked'
        ) NOT NULL DEFAULT 'pending',

        auto_renewing TINYINT(1)
          NOT NULL DEFAULT 0,

        period_start_at DATETIME(3) NULL,
        expires_at DATETIME(3) NULL,

        last_verified_at DATETIME(3) NULL,

        created_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP,

        updated_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),

        UNIQUE KEY uq_subscription_store_reference
          (store, environment, store_reference),

        KEY idx_subscription_purchase_user
          (user_id),

        KEY idx_subscription_purchase_status
          (status, expires_at),

        KEY idx_subscription_purchase_token
          (purchase_token_hash),

        CONSTRAINT fk_subscription_purchase_user
          FOREIGN KEY (user_id)
          REFERENCES users(id)
          ON DELETE RESTRICT,

        CONSTRAINT fk_subscription_purchase_plan
          FOREIGN KEY (plan_id)
          REFERENCES subscription_plans(id)
          ON DELETE RESTRICT

      ) ENGINE=InnoDB
        DEFAULT CHARSET=utf8mb4
        COLLATE=utf8mb4_unicode_ci
    `,
  },

  {
    name: "subscription_entitlements",
    sql: `
      CREATE TABLE IF NOT EXISTS subscription_entitlements (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

        user_id BIGINT UNSIGNED NOT NULL,

        entitlement_code VARCHAR(40)
          NOT NULL DEFAULT 'premium',

        purchase_id BIGINT UNSIGNED NULL,

        status ENUM(
          'inactive',
          'active',
          'grace_period',
          'expired',
          'revoked'
        ) NOT NULL DEFAULT 'inactive',

        expires_at DATETIME(3) NULL,

        last_verified_at DATETIME(3) NULL,

        created_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP,

        updated_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),

        UNIQUE KEY uq_subscription_user_entitlement
          (user_id, entitlement_code),

        KEY idx_subscription_entitlement_status
          (status, expires_at),

        CONSTRAINT fk_subscription_entitlement_user
          FOREIGN KEY (user_id)
          REFERENCES users(id)
          ON DELETE RESTRICT,

        CONSTRAINT fk_subscription_entitlement_purchase
          FOREIGN KEY (purchase_id)
          REFERENCES subscription_purchases(id)
          ON DELETE SET NULL

      ) ENGINE=InnoDB
        DEFAULT CHARSET=utf8mb4
        COLLATE=utf8mb4_unicode_ci
    `,
  },

  {
    name: "subscription_store_events",
    sql: `
      CREATE TABLE IF NOT EXISTS subscription_store_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

        store ENUM(
          'google_play',
          'app_store'
        ) NOT NULL,

        environment ENUM(
          'sandbox',
          'production'
        ) NOT NULL,

        event_id VARCHAR(190) NOT NULL,

        event_type VARCHAR(100) NOT NULL,

        store_reference VARCHAR(190) NULL,

        processing_status ENUM(
          'received',
          'processed',
          'failed'
        ) NOT NULL DEFAULT 'received',

        payload_hash CHAR(64) NULL,

        processing_error VARCHAR(500) NULL,

        received_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP,

        processed_at DATETIME(3) NULL,

        PRIMARY KEY (id),

        UNIQUE KEY uq_subscription_store_event
          (store, environment, event_id),

        KEY idx_subscription_event_processing
          (processing_status, received_at)

      ) ENGINE=InnoDB
        DEFAULT CHARSET=utf8mb4
        COLLATE=utf8mb4_unicode_ci
    `,
  },
];

async function setupSubscriptionDatabase() {
  console.log(
    "\n===== KIDSOTT SUBSCRIPTION DATABASE ====="
  );

  for (const table of tables) {
    console.log(
      `Creating/checking table: ${table.name}`
    );

    await db.query(table.sql);

    console.log(`OK: ${table.name}`);
  }

  console.log("\n===== DEFAULT SUBSCRIPTION PLANS =====");

  const starterPlans = [
    ["monthly", "KidsOTT Monthly", "monthly"],
    ["yearly", "KidsOTT Yearly", "yearly"],
  ];

  for (const [
    code,
    displayName,
    billingPeriod,
  ] of starterPlans) {
    await db.query(
      `
        INSERT IGNORE INTO subscription_plans (
          plan_code,
          display_name,
          billing_period,
          is_enabled
        )
        VALUES (?, ?, ?, 0)
      `,
      [code, displayName, billingPeriod]
    );
  }

  const [plans] = await db.query(
    `
      SELECT
        plan_code,
        display_name,
        billing_period,
        is_enabled,
        apple_product_id,
        google_product_id,
        google_base_plan_id
      FROM subscription_plans
      WHERE plan_code IN ('monthly', 'yearly')
      ORDER BY FIELD(plan_code, 'monthly', 'yearly')
    `
  );

  console.table(plans);

  console.log(
    "\nSubscription tables ready."
  );

  console.log(
    "Plans are disabled until store billing is configured."
  );

  console.log(
    "No subscriptions or Premium entitlements were activated."
  );
}

async function main() {
  let failed = false;

  try {
    await setupSubscriptionDatabase();
  } catch (error) {
    failed = true;

    console.error(
      "\nSUBSCRIPTION DATABASE SETUP FAILED:",
      error.message
    );
  } finally {
    try {
      if (typeof db.end === "function") {
        await db.end();
      }
    } catch (error) {
      console.error(
        "Database connection cleanup error:",
        error.message
      );

      failed = true;
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main();
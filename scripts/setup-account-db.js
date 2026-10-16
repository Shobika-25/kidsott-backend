const mysql =
  require("mysql2/promise");

const dotenv =
  require("dotenv");

dotenv.config();

async function main() {
  let db;

  try {
    db =
      await mysql.createConnection({
        host:
          process.env.DB_HOST ||
          "127.0.0.1",

        port:
          Number(
            process.env.DB_PORT ||
            3306
          ),

        user:
          process.env.DB_USER ||
          "root",

        password:
          process.env.DB_PASSWORD ||
          "",

        database:
          process.env.DB_NAME ||
          "kidsott_db",
      });

    const databaseName =
      process.env.DB_NAME ||
      "kidsott_db";

    const [columns] =
      await db.query(
        `
          SELECT COLUMN_TYPE AS type
          FROM information_schema.COLUMNS
          WHERE
            TABLE_SCHEMA = ?
            AND TABLE_NAME = 'users'
            AND COLUMN_NAME = 'id'
          LIMIT 1
        `,
        [databaseName]
      );

    if (!columns.length) {
      throw new Error(
        "users.id not found."
      );
    }

    const userIdType =
      String(
        columns[0].type
      );

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id ${userIdType}
          NOT NULL,

        autoplay TINYINT(1)
          NOT NULL DEFAULT 1,

        wifi_only TINYINT(1)
          NOT NULL DEFAULT 0,

        sound_effects TINYINT(1)
          NOT NULL DEFAULT 1,

        push_notifications TINYINT(1)
          NOT NULL DEFAULT 1,

        safe_mode TINYINT(1)
          NOT NULL DEFAULT 1,

        parental_controls TINYINT(1)
          NOT NULL DEFAULT 0,

        created_at TIMESTAMP
          NOT NULL
          DEFAULT CURRENT_TIMESTAMP,

        updated_at TIMESTAMP
          NOT NULL
          DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (user_id),

        CONSTRAINT fk_user_settings_user
          FOREIGN KEY (user_id)
          REFERENCES users(id)
          ON DELETE CASCADE
          ON UPDATE CASCADE
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);

    console.log(
      "user_settings table ready"
    );

    const [rows] =
      await db.query(`
        SELECT COUNT(*) AS total
        FROM user_settings
      `);

    console.log(
      "Current settings rows:",
      Number(rows[0].total)
    );

    console.log("");
    console.log(
      "===== ACCOUNT DATABASE READY ====="
    );

  } catch (error) {

    console.error(
      "ACCOUNT DATABASE SETUP FAILED:"
    );

    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    process.exitCode = 1;

  } finally {

    if (db) {
      await db.end();
    }
  }
}

main();

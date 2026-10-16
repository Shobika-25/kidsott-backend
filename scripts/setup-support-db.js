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


    await db.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id BIGINT UNSIGNED
          NOT NULL
          AUTO_INCREMENT,

        user_id BIGINT UNSIGNED
          NOT NULL,

        type ENUM(
          'Playback',
          'Account',
          'Favorites',
          'Other'
        )
          NOT NULL,

        message TEXT
          NOT NULL,

        status ENUM(
          'open',
          'in_progress',
          'resolved',
          'closed'
        )
          NOT NULL
          DEFAULT 'open',

        created_at TIMESTAMP
          NOT NULL
          DEFAULT CURRENT_TIMESTAMP,

        updated_at TIMESTAMP
          NOT NULL
          DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),

        INDEX idx_support_user (
          user_id
        ),

        INDEX idx_support_status (
          status
        ),

        CONSTRAINT fk_support_tickets_user
          FOREIGN KEY (user_id)
          REFERENCES users(id)
          ON DELETE CASCADE
          ON UPDATE CASCADE
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);


    const [rows] =
      await db.query(`
        SELECT COUNT(*) AS total
        FROM support_tickets
      `);


    console.log(
      "support_tickets table ready"
    );

    console.log(
      "Current rows:",
      Number(
        rows[0].total
      )
    );


    console.log("");
    console.log(
      "===== SUPPORT DATABASE READY ====="
    );

  } catch (error) {

    console.error(
      "SUPPORT DATABASE SETUP FAILED:"
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

const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config();

async function setupDatabase() {
  let connection;

  try {
    const {
      DB_HOST = "127.0.0.1",
      DB_PORT = "3306",
      DB_USER = "root",
      DB_PASSWORD = "",
      DB_NAME = "kidsott_db",
    } = process.env;

    if (
      !/^[a-zA-Z0-9_]+$/.test(
        DB_NAME
      )
    ) {
      throw new Error(
        "Invalid DB_NAME"
      );
    }

    console.log("");
    console.log(
      "===================================="
    );
    console.log(
      " KIDS STREAM DATABASE SETUP"
    );
    console.log(
      "===================================="
    );

    connection =
      await mysql.createConnection({
        host: DB_HOST,
        port: Number(DB_PORT),
        user: DB_USER,
        password: DB_PASSWORD,
      });

    console.log(
      "MySQL connected"
    );

    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
       CHARACTER SET utf8mb4
       COLLATE utf8mb4_unicode_ci`
    );

    console.log(
      `Database ready: ${DB_NAME}`
    );

    await connection.query(
      `USE \`${DB_NAME}\``
    );

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

        name VARCHAR(120) NOT NULL,

        email VARCHAR(190) NOT NULL,

        password_hash VARCHAR(255) NOT NULL,

        role ENUM(
          'user',
          'admin'
        ) NOT NULL DEFAULT 'user',

        is_active TINYINT(1)
          NOT NULL DEFAULT 1,

        created_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP,

        updated_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),

        UNIQUE KEY
          uq_users_email (email),

        KEY
          idx_users_role (role),

        KEY
          idx_users_active (is_active)
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);

    console.log(
      "users table ready"
    );

    const [columns] =
      await connection.query(`
        SHOW COLUMNS
        FROM users
      `);

    console.table(
      columns.map(
        column => ({
          Field: column.Field,
          Type: column.Type,
          Null: column.Null,
          Key: column.Key,
          Default:
            column.Default,
        })
      )
    );

    console.log("");
    console.log(
      "===== DATABASE SETUP SUCCESS ====="
    );
    console.log("");
  } catch (error) {
    console.error("");
    console.error(
      "DATABASE SETUP FAILED:"
    );

    console.error(
      error.message
    );

    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

setupDatabase();

const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config();

async function createAdmin() {
  let connection;

  try {
    const name =
      String(
        process.env.ADMIN_NAME ||
          "Kids Stream Admin"
      ).trim();

    const email =
      String(
        process.env.ADMIN_EMAIL || ""
      )
        .trim()
        .toLowerCase();

    const password =
      String(
        process.env.ADMIN_PASSWORD || ""
      );

    if (!email) {
      throw new Error(
        "ADMIN_EMAIL is required."
      );
    }

    if (password.length < 8) {
      throw new Error(
        "Admin password must contain at least 8 characters."
      );
    }

    connection =
      await mysql.createConnection({
        host:
          process.env.DB_HOST ||
          "127.0.0.1",

        port: Number(
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

    const passwordHash =
      await bcrypt.hash(
        password,
        12
      );

    const [existing] =
      await connection.query(
        `
          SELECT id
          FROM users
          WHERE email = ?
          LIMIT 1
        `,
        [email]
      );

    let userId;

    if (existing.length > 0) {
      userId =
        existing[0].id;

      await connection.query(
        `
          UPDATE users
          SET
            name = ?,
            password_hash = ?,
            role = 'admin',
            is_active = 1
          WHERE id = ?
        `,
        [
          name,
          passwordHash,
          userId,
        ]
      );

      console.log(
        "Existing account upgraded to admin."
      );
    } else {
      const [result] =
        await connection.query(
          `
            INSERT INTO users (
              name,
              email,
              password_hash,
              role,
              is_active
            )
            VALUES (
              ?,
              ?,
              ?,
              'admin',
              1
            )
          `,
          [
            name,
            email,
            passwordHash,
          ]
        );

      userId =
        result.insertId;

      console.log(
        "New admin account created."
      );
    }

    const [users] =
      await connection.query(
        `
          SELECT
            id,
            name,
            email,
            role,
            is_active,
            created_at
          FROM users
          WHERE id = ?
          LIMIT 1
        `,
        [userId]
      );

    console.log("");
    console.log(
      "===== ADMIN READY ====="
    );

    console.table(
      users.map(
        user => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          active:
            Boolean(
              user.is_active
            ),
        })
      )
    );
  } catch (error) {
    console.error(
      "CREATE ADMIN FAILED:"
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

createAdmin();

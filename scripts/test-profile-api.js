const mysql =
  require("mysql2/promise");

const jwt =
  require("jsonwebtoken");

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


    const [users] =
      await db.query(`
        SELECT
          id,
          name,
          email,
          role

        FROM users

        WHERE is_active = 1

        ORDER BY id DESC

        LIMIT 1
      `);


    if (!users.length) {

      throw new Error(
        "No active user found."
      );
    }


    const user =
      users[0];


    const token =
      jwt.sign(
        {
          id:
            Number(
              user.id
            ),

          role:
            user.role,
        },

        process.env.JWT_SECRET,

        {
          expiresIn:
            "10m",
        }
      );


    const headers = {
      Accept:
        "application/json",

      "Content-Type":
        "application/json",

      Authorization:
        `Bearer ${token}`,
    };


    const base =
      `http://127.0.0.1:${process.env.PORT || 5000}/api/account`;


    // =====================================================
    // GET PROFILE
    // =====================================================

    console.log("");
    console.log(
      "===== PROFILE GET ====="
    );


    let response =
      await fetch(
        `${base}/profile`,
        {
          headers,
        }
      );


    console.log(
      "STATUS:",
      response.status
    );


    let body =
      await response.json();


    console.dir(
      body,
      {
        depth: 10,
      }
    );


    if (!response.ok) {

      throw new Error(
        "Profile GET failed."
      );
    }


    // =====================================================
    // PUT SAME VALUES
    // NON-DESTRUCTIVE TEST
    // =====================================================

    console.log("");
    console.log(
      "===== PROFILE PUT ====="
    );


    response =
      await fetch(
        `${base}/profile`,
        {
          method:
            "PUT",

          headers,

          body:
            JSON.stringify({
              name:
                user.name,

              email:
                user.email,
            }),
        }
      );


    console.log(
      "STATUS:",
      response.status
    );


    body =
      await response.json();


    console.dir(
      body,
      {
        depth: 10,
      }
    );


    if (!response.ok) {

      throw new Error(
        "Profile PUT failed."
      );
    }


    // =====================================================
    // MYSQL VERIFY
    // =====================================================

    const [rows] =
      await db.query(
        `
          SELECT
            id,
            name,
            email,
            role,
            is_active AS isActive,
            updated_at AS updatedAt

          FROM users

          WHERE id = ?

          LIMIT 1
        `,
        [
          user.id,
        ]
      );


    console.log("");
    console.log(
      "===== MYSQL USER ====="
    );


    console.table(
      rows
    );


    if (!rows.length) {

      throw new Error(
        "User row missing after profile update."
      );
    }


    if (
      rows[0].name !==
        user.name ||
      rows[0].email !==
        user.email
    ) {

      throw new Error(
        "Profile values do not match MySQL."
      );
    }


    console.log("");
    console.log(
      "===== PROFILE API SUCCESS ====="
    );

  } catch (error) {

    console.error("");
    console.error(
      "PROFILE API TEST FAILED:"
    );


    console.error(
      error instanceof Error
        ? error.message
        : error
    );


    process.exitCode =
      1;

  } finally {

    if (db) {

      await db.end();
    }
  }
}


main();

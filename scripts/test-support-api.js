const mysql =
  require("mysql2/promise");

const jwt =
  require("jsonwebtoken");

const dotenv =
  require("dotenv");

dotenv.config();

async function main() {
  let db;
  let createdId = null;

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
          role

        FROM users

        WHERE is_active = 1

        ORDER BY id DESC

        LIMIT 1
      `);


    if (!users.length) {
      throw new Error(
        "No active user."
      );
    }


    const user =
      users[0];


    const token =
      jwt.sign(
        {
          id:
            Number(user.id),

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
      `http://127.0.0.1:${process.env.PORT || 5000}/api/support`;


    console.log("");
    console.log(
      "===== CREATE SUPPORT TICKET ====="
    );


    let response =
      await fetch(
        `${base}/tickets`,
        {
          method:
            "POST",

          headers,

          body:
            JSON.stringify({
              type:
                "Playback",

              message:
                "Automated backend support API test.",
            }),
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


    if (
      !response.ok ||
      !body.ticket
    ) {
      throw new Error(
        "Support POST failed."
      );
    }


    createdId =
      Number(
        body.ticket.id
      );


    console.log("");
    console.log(
      "===== GET SUPPORT TICKETS ====="
    );


    response =
      await fetch(
        `${base}/tickets`,
        {
          headers,
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


    if (
      !response.ok ||
      !Array.isArray(
        body.tickets
      )
    ) {
      throw new Error(
        "Support GET failed."
      );
    }


    const [rows] =
      await db.query(
        `
          SELECT
            id,
            user_id AS userId,
            type,
            message,
            status

          FROM support_tickets

          WHERE id = ?

          LIMIT 1
        `,
        [
          createdId,
        ]
      );


    console.log("");
    console.log(
      "===== MYSQL SUPPORT TICKET ====="
    );


    console.table(
      rows
    );


    if (
      rows.length !== 1
    ) {
      throw new Error(
        "Support ticket not found in MySQL."
      );
    }


    console.log("");
    console.log(
      "===== DELETE TEST TICKET ====="
    );


    response =
      await fetch(
        `${base}/tickets/${createdId}`,
        {
          method:
            "DELETE",

          headers,
        }
      );


    console.log(
      "STATUS:",
      response.status
    );


    console.dir(
      await response.json(),
      {
        depth: 10,
      }
    );


    if (!response.ok) {
      throw new Error(
        "Support DELETE failed."
      );
    }


    createdId =
      null;


    console.log("");
    console.log(
      "===== SUPPORT API SUCCESS ====="
    );

  } catch (error) {

    console.error("");
    console.error(
      "SUPPORT API TEST FAILED:"
    );

    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    process.exitCode = 1;

  } finally {

    if (
      db &&
      createdId
    ) {

      await db.query(
        `
          DELETE FROM support_tickets
          WHERE id = ?
        `,
        [
          createdId,
        ]
      );
    }


    if (db) {
      await db.end();
    }
  }
}

main();

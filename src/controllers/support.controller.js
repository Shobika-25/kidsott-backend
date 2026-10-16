const db =
  require("../config/db");



const mysql =
  require("mysql2/promise");


const supportTypeDb =
  mysql.createPool({
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

    waitForConnections:
      true,

    connectionLimit:
      3,

    queueLimit:
      0,
  });


async function isAllowedSupportType(
  value
) {

  const type =
    String(
      value ||
      ""
    ).trim();


  if (!type) {
    return false;
  }


  const [
    rows,
  ] =
    await supportTypeDb.execute(
      `
        SELECT
          id

        FROM support_types

        WHERE
          name = ?
          AND is_active = 1

        LIMIT 1
      `,
      [
        type,
      ]
    );


  return rows.length > 0;
}

function mapTicket(
  row
) {
  return {
    id:
      Number(row.id),

    type:
      row.type,

    message:
      row.message,

    status:
      row.status,

    createdAt:
      new Date(
        row.created_at
      ).getTime(),
  };
}

async function getTickets(
  req,
  res
) {
  try {

    const [rows] =
      await db.query(
        `
          SELECT
            id,
            type,
            message,
            status,
            created_at

          FROM support_tickets

          WHERE user_id = ?

          ORDER BY
            created_at DESC,
            id DESC

          LIMIT 100
        `,
        [
          req.user.id,
        ]
      );


    return res.json({
      success: true,

      tickets:
        rows.map(
          mapTicket
        ),
    });

  } catch (error) {

    console.error(
      "GET SUPPORT TICKETS ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to load support tickets.",
      });
  }
}


async function createTicket(
  req,
  res
) {
  try {

    const type =
      String(
        req.body.type ||
        ""
      ).trim();


    const message =
      String(
        req.body.message ||
        ""
      ).trim();


    if (
      !(await isAllowedSupportType(type))
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Invalid support type.",
        });
    }


    if (
      message.length < 5
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Please describe the problem.",
        });
    }


    if (
      message.length > 2000
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Support message is too long.",
        });
    }


    const [result] =
      await db.query(
        `
          INSERT INTO support_tickets (
            user_id,
            type,
            message,
            status
          )

          VALUES (
            ?, ?, ?, 'open'
          )
        `,
        [
          req.user.id,
          type,
          message,
        ]
      );


    const [rows] =
      await db.query(
        `
          SELECT
            id,
            type,
            message,
            status,
            created_at

          FROM support_tickets

          WHERE
            id = ?
            AND user_id = ?

          LIMIT 1
        `,
        [
          result.insertId,
          req.user.id,
        ]
      );


    return res
      .status(201)
      .json({
        success: true,

        message:
          "Support ticket submitted.",

        ticket:
          mapTicket(
            rows[0]
          ),
      });

  } catch (error) {

    console.error(
      "CREATE SUPPORT TICKET ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to submit support ticket.",
      });
  }
}


async function removeTicket(
  req,
  res
) {
  try {

    const ticketId =
      Number(
        req.params.ticketId
      );


    if (
      !Number.isInteger(
        ticketId
      ) ||
      ticketId <= 0
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Invalid ticket id.",
        });
    }


    await db.query(
      `
        DELETE FROM support_tickets

        WHERE
          id = ?
          AND user_id = ?
      `,
      [
        ticketId,
        req.user.id,
      ]
    );


    return res.json({
      success: true,
      message:
        "Support ticket removed.",
      ticketId,
    });

  } catch (error) {

    console.error(
      "REMOVE SUPPORT TICKET ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to remove support ticket.",
      });
  }
}


module.exports = {
  getTickets,
  createTicket,
  removeTicket,
};

const mysql =
  require("mysql2/promise");

const dotenv =
  require("dotenv");

dotenv.config();


const db =
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
      5,

    queueLimit:
      0,
  });


function parseKeywords(
  value
) {

  try {

    const parsed =
      JSON.parse(
        value || "[]"
      );


    if (!Array.isArray(parsed)) {
      return [];
    }


    return parsed
      .map(item =>
        String(item || "")
          .trim()
      )
      .filter(Boolean);

  } catch {

    return [];
  }
}


function normalizeTypes(
  value
) {

  if (!Array.isArray(value)) {
    return [];
  }


  return Array.from(
    new Set(
      value
        .map(item =>
          String(item || "")
            .trim()
            .slice(0, 80)
        )
        .filter(Boolean)
    )
  );
}


async function getContent(
  req,
  res
) {

  try {

    const [
      contactRows,
    ] =
      await db.query(`
        SELECT
          email,
          phone
        FROM support_contact
        WHERE id = 1
        LIMIT 1
      `);


    const [
      typeRows,
    ] =
      await db.query(`
        SELECT
          name
        FROM support_types
        WHERE is_active = 1
        ORDER BY
          sort_order ASC,
          id ASC
      `);


    const [
      faqRows,
    ] =
      await db.query(`
        SELECT
          id,
          question,
          answer,
          keywords_json
        FROM support_faqs
        WHERE is_active = 1
        ORDER BY
          sort_order ASC,
          id ASC
      `);


    const contact =
      contactRows[0] || {
        email: "",
        phone: "",
      };


    return res.json({
      success: true,

      content: {
        email:
          String(
            contact.email || ""
          ).trim(),

        phone:
          String(
            contact.phone || ""
          ).trim(),

        types:
          typeRows
            .map(row =>
              String(
                row.name || ""
              ).trim()
            )
            .filter(Boolean),

        faqs:
          faqRows.map(row => ({
            id:
              Number(row.id),

            question:
              String(
                row.question || ""
              ).trim(),

            answer:
              String(
                row.answer || ""
              ).trim(),

            keywords:
              parseKeywords(
                row.keywords_json
              ),
          })),
      },
    });

  } catch (error) {

    console.error(
      "SUPPORT CONTENT GET ERROR:"
    );

    console.error(
      error instanceof Error
        ? error.stack ||
          error.message
        : error
    );


    return res.status(500).json({
      success: false,

      message:
        error instanceof Error
          ? error.message
          : "Unable to load support content.",
    });
  }
}


async function updateContact(
  req,
  res
) {

  try {

    const email =
      String(
        req.body?.email ||
        ""
      ).trim();


    const phone =
      String(
        req.body?.phone ||
        ""
      ).trim();


    if (
      !email ||
      !phone
    ) {

      return res.status(400).json({
        success: false,
        message:
          "Email and phone are required.",
      });
    }


    await db.execute(
      `
        INSERT INTO support_contact (
          id,
          email,
          phone
        )
        VALUES (
          1,
          ?,
          ?
        )
        ON DUPLICATE KEY UPDATE
          email = ?,
          phone = ?
      `,
      [
        email,
        phone,
        email,
        phone,
      ]
    );


    return res.json({
      success: true,
      email,
      phone,
    });

  } catch (error) {

    console.error(
      "SUPPORT CONTACT UPDATE ERROR:",
      error
    );


    return res.status(500).json({
      success: false,
      message:
        "Unable to update support contact.",
    });
  }
}


async function replaceTypes(
  req,
  res
) {

  const types =
    normalizeTypes(
      req.body?.types
    );


  if (!types.length) {

    return res.status(400).json({
      success: false,
      message:
        "At least one support type is required.",
    });
  }


  const connection =
    await db.getConnection();


  try {

    await connection.beginTransaction();


    await connection.query(
      "DELETE FROM support_types"
    );


    for (
      let index = 0;
      index < types.length;
      index += 1
    ) {

      await connection.execute(
        `
          INSERT INTO support_types (
            name,
            sort_order,
            is_active
          )
          VALUES (
            ?,
            ?,
            1
          )
        `,
        [
          types[index],
          index + 1,
        ]
      );
    }


    await connection.commit();


    return res.json({
      success: true,
      types,
    });

  } catch (error) {

    try {
      await connection.rollback();
    } catch {
    }


    console.error(
      "SUPPORT TYPES UPDATE ERROR:",
      error
    );


    return res.status(500).json({
      success: false,
      message:
        "Unable to update support types.",
    });

  } finally {

    connection.release();
  }
}


async function replaceFaqs(
  req,
  res
) {

  const source =
    Array.isArray(
      req.body?.faqs
    )
      ? req.body.faqs
      : [];


  const faqs =
    source
      .map(item => {

        const question =
          String(
            item?.question ||
            ""
          ).trim();


        const answer =
          String(
            item?.answer ||
            ""
          ).trim();


        const keywords =
          Array.isArray(
            item?.keywords
          )
            ? item.keywords
                .map(value =>
                  String(
                    value ||
                    ""
                  ).trim()
                )
                .filter(Boolean)
            : [];


        return {
          question,
          answer,
          keywords,
        };
      })
      .filter(
        item =>
          item.question &&
          item.answer
      );


  const connection =
    await db.getConnection();


  try {

    await connection.beginTransaction();


    await connection.query(
      "DELETE FROM support_faqs"
    );


    for (
      let index = 0;
      index < faqs.length;
      index += 1
    ) {

      const faq =
        faqs[index];


      await connection.execute(
        `
          INSERT INTO support_faqs (
            question,
            answer,
            keywords_json,
            sort_order,
            is_active
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            1
          )
        `,
        [
          faq.question,
          faq.answer,
          JSON.stringify(
            faq.keywords
          ),
          index + 1,
        ]
      );
    }


    await connection.commit();


    return res.json({
      success: true,
      total:
        faqs.length,
    });

  } catch (error) {

    try {
      await connection.rollback();
    } catch {
    }


    console.error(
      "SUPPORT FAQ UPDATE ERROR:",
      error
    );


    return res.status(500).json({
      success: false,
      message:
        "Unable to update support FAQs.",
    });

  } finally {

    connection.release();
  }
}


module.exports = {
  getContent,
  updateContact,
  replaceTypes,
  replaceFaqs,
};

const mysql =
  require("mysql2/promise");

const dotenv =
  require("dotenv");

dotenv.config();

async function setup() {
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
      CREATE TABLE IF NOT EXISTS support_contact (
        id TINYINT UNSIGNED
          NOT NULL
          PRIMARY KEY,

        email VARCHAR(190)
          NOT NULL,

        phone VARCHAR(60)
          NOT NULL,

        updated_at TIMESTAMP
          NOT NULL
          DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);


    await db.query(`
      CREATE TABLE IF NOT EXISTS support_types (
        id BIGINT UNSIGNED
          NOT NULL
          AUTO_INCREMENT
          PRIMARY KEY,

        name VARCHAR(80)
          NOT NULL,

        sort_order INT
          NOT NULL
          DEFAULT 0,

        is_active TINYINT(1)
          NOT NULL
          DEFAULT 1,

        created_at TIMESTAMP
          NOT NULL
          DEFAULT CURRENT_TIMESTAMP,

        updated_at TIMESTAMP
          NOT NULL
          DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uq_support_type_name (name),

        INDEX idx_support_type_order (
          is_active,
          sort_order
        )
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);


    await db.query(`
      CREATE TABLE IF NOT EXISTS support_faqs (
        id BIGINT UNSIGNED
          NOT NULL
          AUTO_INCREMENT
          PRIMARY KEY,

        question VARCHAR(255)
          NOT NULL,

        answer TEXT
          NOT NULL,

        keywords_json TEXT
          NOT NULL,

        sort_order INT
          NOT NULL
          DEFAULT 0,

        is_active TINYINT(1)
          NOT NULL
          DEFAULT 1,

        created_at TIMESTAMP
          NOT NULL
          DEFAULT CURRENT_TIMESTAMP,

        updated_at TIMESTAMP
          NOT NULL
          DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uq_support_faq_question (
          question
        ),

        INDEX idx_support_faq_order (
          is_active,
          sort_order
        )
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);


    await db.execute(
      `
        INSERT IGNORE INTO support_contact (
          id,
          email,
          phone
        )
        VALUES (
          1,
          ?,
          ?
        )
      `,
      [
        "support@kidsstream.com",
        "+911234567890",
      ]
    );


    const types = [
      "Playback",
      "Account",
      "Favorites",
      "Other",
    ];


    for (
      let index = 0;
      index < types.length;
      index += 1
    ) {

      await db.execute(
        `
          INSERT IGNORE INTO support_types (
            name,
            sort_order,
            is_active
          )
          VALUES (?, ?, 1)
        `,
        [
          types[index],
          index + 1,
        ]
      );
    }


    const faqs = [
      {
        question:
          "How do I watch a video?",

        answer:
          "Open any video from Home, Categories, Search, All Videos or Favorites and tap the play button. Your progress is saved automatically while you watch.",

        keywords: [
          "watch",
          "play",
          "video",
          "player",
        ],
      },
      {
        question:
          "How does Continue Watching work?",

        answer:
          "When you start a video and leave before it is completed, Kids Stream saves the playback position. Open Continue Watching to resume from that position.",

        keywords: [
          "continue",
          "resume",
          "progress",
          "history",
        ],
      },
      {
        question:
          "How do I add a video to Favorites?",

        answer:
          "Tap the heart icon on a video card, Video Details or Video Player. The video will immediately appear in Favorites.",

        keywords: [
          "favorite",
          "heart",
          "save",
          "library",
        ],
      },
      {
        question:
          "Can I remove a video from Favorites?",

        answer:
          "Yes. Tap the active heart icon again from Favorites or any screen where the video appears.",

        keywords: [
          "favorite",
          "remove",
          "delete",
        ],
      },
      {
        question:
          "Why is a video not playing?",

        answer:
          "Check your internet connection first. Then reopen the video. If playback still fails, restart the app and try again.",

        keywords: [
          "error",
          "playback",
          "internet",
          "video",
        ],
      },
      {
        question:
          "Can I download videos?",

        answer:
          "Offline downloads are not active yet. Real download support requires the backend, video storage and offline media system to be connected.",

        keywords: [
          "download",
          "offline",
          "storage",
        ],
      },
      {
        question:
          "How does Watch History work?",

        answer:
          "Started and completed videos are saved in Watch History. You can remove individual records or clear the complete history.",

        keywords: [
          "history",
          "watched",
          "completed",
        ],
      },
      {
        question:
          "What is Safe Mode?",

        answer:
          "Safe Mode is a viewing preference available in Settings. Its current status is also shown on this Help & Support page.",

        keywords: [
          "safe",
          "parent",
          "settings",
        ],
      },
    ];


    for (
      let index = 0;
      index < faqs.length;
      index += 1
    ) {

      const faq =
        faqs[index];


      await db.execute(
        `
          INSERT IGNORE INTO support_faqs (
            question,
            answer,
            keywords_json,
            sort_order,
            is_active
          )
          VALUES (?, ?, ?, ?, 1)
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


    // Allow future backend-managed support types.
    const [ticketColumns] =
      await db.query(`
        SELECT
          DATA_TYPE AS dataType
        FROM information_schema.COLUMNS
        WHERE
          TABLE_SCHEMA = ?
          AND TABLE_NAME = 'support_tickets'
          AND COLUMN_NAME = 'type'
        LIMIT 1
      `,
      [
        process.env.DB_NAME ||
          "kidsott_db",
      ]);


    if (
      ticketColumns.length > 0 &&
      String(
        ticketColumns[0].dataType
      ).toLowerCase() === "enum"
    ) {

      await db.query(`
        ALTER TABLE support_tickets
        MODIFY COLUMN type
          VARCHAR(80)
          NOT NULL
      `);
    }


    const [contactRows] =
      await db.query(`
        SELECT
          email,
          phone
        FROM support_contact
        WHERE id = 1
      `);


    const [typeRows] =
      await db.query(`
        SELECT
          name
        FROM support_types
        WHERE is_active = 1
        ORDER BY
          sort_order ASC,
          id ASC
      `);


    const [faqRows] =
      await db.query(`
        SELECT
          id,
          question
        FROM support_faqs
        WHERE is_active = 1
        ORDER BY
          sort_order ASC,
          id ASC
      `);


    console.log("");
    console.log(
      "===== SUPPORT CONTENT DATABASE READY ====="
    );

    console.log(
      "Contact :",
      contactRows[0]
    );

    console.log(
      "Types   :",
      typeRows.length
    );

    console.log(
      "FAQs    :",
      faqRows.length
    );

  } catch (error) {

    console.error(
      "SUPPORT CONTENT SETUP FAILED:"
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


setup();

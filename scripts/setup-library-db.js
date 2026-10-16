const mysql =
  require("mysql2/promise");

const dotenv =
  require("dotenv");

dotenv.config();

const databaseName =
  process.env.DB_NAME ||
  "kidsott_db";

function safeIntegerType(
  value,
  label
) {
  const type =
    String(value || "")
      .trim()
      .toLowerCase();

  const valid =
    /^(tinyint|smallint|mediumint|int|bigint)(\(\d+\))?( unsigned)?$/;

  if (!valid.test(type)) {
    throw new Error(
      `Unsupported ${label} type: ${type}`
    );
  }

  return type;
}

async function getIdType(
  connection,
  tableName
) {
  const [rows] =
    await connection.query(
      `
        SELECT
          COLUMN_TYPE AS columnType

        FROM information_schema.COLUMNS

        WHERE
          TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
          AND COLUMN_NAME = 'id'

        LIMIT 1
      `,
      [
        databaseName,
        tableName,
      ]
    );

  if (!rows.length) {
    throw new Error(
      `${tableName}.id column not found.`
    );
  }

  return safeIntegerType(
    rows[0].columnType,
    `${tableName}.id`
  );
}

async function constraintExists(
  connection,
  constraintName
) {
  const [rows] =
    await connection.query(
      `
        SELECT
          CONSTRAINT_NAME

        FROM information_schema.REFERENTIAL_CONSTRAINTS

        WHERE
          CONSTRAINT_SCHEMA = ?
          AND CONSTRAINT_NAME = ?

        LIMIT 1
      `,
      [
        databaseName,
        constraintName,
      ]
    );

  return rows.length > 0;
}

async function addForeignKey(
  connection,
  options
) {
  const {
    table,
    name,
    column,
    referenceTable,
    referenceColumn,
  } = options;

  if (
    await constraintExists(
      connection,
      name
    )
  ) {
    console.log(
      `${name} already exists`
    );

    return;
  }

  await connection.query(`
    ALTER TABLE ${table}

    ADD CONSTRAINT ${name}

    FOREIGN KEY (${column})
    REFERENCES ${referenceTable}(${referenceColumn})

    ON DELETE CASCADE
    ON UPDATE CASCADE
  `);

  console.log(
    `${name} added`
  );
}

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
          databaseName,
      });

    console.log("");
    console.log(
      "===================================="
    );
    console.log(
      " USER LIBRARY DATABASE SETUP"
    );
    console.log(
      "===================================="
    );

    const userIdType =
      await getIdType(
        db,
        "users"
      );

    const videoIdType =
      await getIdType(
        db,
        "videos"
      );

    console.log(
      `users.id  : ${userIdType}`
    );

    console.log(
      `videos.id : ${videoIdType}`
    );


    // =====================================================
    // FAVORITES
    // =====================================================

    await db.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        user_id ${userIdType}
          NOT NULL,

        video_id ${videoIdType}
          NOT NULL,

        created_at TIMESTAMP
          NOT NULL
          DEFAULT CURRENT_TIMESTAMP,

        PRIMARY KEY (
          user_id,
          video_id
        ),

        KEY idx_favorites_video (
          video_id
        )
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);

    console.log(
      "favorites table ready"
    );


    // =====================================================
    // WATCH HISTORY
    // Avoid MariaDB CURRENT_TIME reserved keyword
    // =====================================================

    await db.query(`
      CREATE TABLE IF NOT EXISTS watch_history (
        user_id ${userIdType}
          NOT NULL,

        video_id ${videoIdType}
          NOT NULL,

        position_seconds DOUBLE
          NOT NULL
          DEFAULT 0,

        duration DOUBLE
          NOT NULL
          DEFAULT 0,

        completed TINYINT(1)
          NOT NULL
          DEFAULT 0,

        last_watched_at BIGINT UNSIGNED
          NOT NULL,

        created_at TIMESTAMP
          NOT NULL
          DEFAULT CURRENT_TIMESTAMP,

        updated_at TIMESTAMP
          NOT NULL
          DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (
          user_id,
          video_id
        ),

        KEY idx_history_video (
          video_id
        ),

        KEY idx_history_last_watched (
          user_id,
          last_watched_at
        )
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);

    console.log(
      "watch_history table ready"
    );


    // =====================================================
    // FOREIGN KEYS
    // =====================================================

    await addForeignKey(
      db,
      {
        table:
          "favorites",

        name:
          "fk_favorites_user",

        column:
          "user_id",

        referenceTable:
          "users",

        referenceColumn:
          "id",
      }
    );

    await addForeignKey(
      db,
      {
        table:
          "favorites",

        name:
          "fk_favorites_video",

        column:
          "video_id",

        referenceTable:
          "videos",

        referenceColumn:
          "id",
      }
    );

    await addForeignKey(
      db,
      {
        table:
          "watch_history",

        name:
          "fk_history_user",

        column:
          "user_id",

        referenceTable:
          "users",

        referenceColumn:
          "id",
      }
    );

    await addForeignKey(
      db,
      {
        table:
          "watch_history",

        name:
          "fk_history_video",

        column:
          "video_id",

        referenceTable:
          "videos",

        referenceColumn:
          "id",
      }
    );

    console.log("");
    console.log(
      "===== USER LIBRARY DATABASE READY ====="
    );
  } catch (error) {
    console.error("");
    console.error(
      "LIBRARY DATABASE SETUP FAILED:"
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


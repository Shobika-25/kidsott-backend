const mysql =
  require("mysql2/promise");

const dotenv =
  require("dotenv");

dotenv.config();

async function verify() {
  let db;

  try {
    const databaseName =
      process.env.DB_NAME ||
      "kidsott_db";

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

    const [tables] =
      await db.query(
        `
          SELECT
            TABLE_NAME AS tableName,
            ENGINE AS engine

          FROM information_schema.TABLES

          WHERE
            TABLE_SCHEMA = ?
            AND TABLE_NAME IN (
              'favorites',
              'watch_history'
            )

          ORDER BY TABLE_NAME
        `,
        [
          databaseName,
        ]
      );

    console.table(
      tables
    );

    if (
      tables.length !== 2
    ) {
      throw new Error(
        `Expected 2 library tables, found ${tables.length}.`
      );
    }

    const [columns] =
      await db.query(
        `
          SELECT
            TABLE_NAME AS tableName,
            COLUMN_NAME AS columnName,
            COLUMN_TYPE AS columnType

          FROM information_schema.COLUMNS

          WHERE
            TABLE_SCHEMA = ?
            AND TABLE_NAME IN (
              'favorites',
              'watch_history'
            )

          ORDER BY
            TABLE_NAME,
            ORDINAL_POSITION
        `,
        [
          databaseName,
        ]
      );

    console.table(
      columns
    );

    const positionColumn =
      columns.find(
        column =>
          column.tableName ===
            "watch_history" &&
          column.columnName ===
            "position_seconds"
      );

    if (!positionColumn) {
      throw new Error(
        "watch_history.position_seconds is missing."
      );
    }

    const [foreignKeys] =
      await db.query(
        `
          SELECT
            TABLE_NAME AS tableName,
            CONSTRAINT_NAME AS constraintName

          FROM information_schema.REFERENTIAL_CONSTRAINTS

          WHERE
            CONSTRAINT_SCHEMA = ?
            AND TABLE_NAME IN (
              'favorites',
              'watch_history'
            )

          ORDER BY
            TABLE_NAME,
            CONSTRAINT_NAME
        `,
        [
          databaseName,
        ]
      );

    console.table(
      foreignKeys
    );

    const [favoriteRows] =
      await db.query(
        `
          SELECT
            COUNT(*) AS total
          FROM favorites
        `
      );

    const [historyRows] =
      await db.query(
        `
          SELECT
            COUNT(*) AS total
          FROM watch_history
        `
      );

    console.log(
      `favorites rows     : ${Number(
        favoriteRows[0].total
      )}`
    );

    console.log(
      `watch_history rows : ${Number(
        historyRows[0].total
      )}`
    );

    console.log("");
    console.log(
      "===== LIBRARY DATABASE VERIFIED ====="
    );
  } catch (error) {
    console.error("");
    console.error(
      "LIBRARY VERIFY FAILED:"
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

verify();

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


    const [favorites] =
      await db.query(`
        SELECT
          f.user_id AS userId,
          u.email,
          f.video_id AS videoId,
          v.title,
          f.created_at AS createdAt

        FROM favorites f

        INNER JOIN users u
          ON u.id = f.user_id

        INNER JOIN videos v
          ON v.id = f.video_id

        ORDER BY
          f.created_at DESC

        LIMIT 20
      `);


    const [history] =
      await db.query(`
        SELECT
          h.user_id AS userId,
          u.email,
          h.video_id AS videoId,
          v.title,

          ROUND(
            h.position_seconds,
            2
          ) AS positionSeconds,

          ROUND(
            h.duration,
            2
          ) AS duration,

          h.completed,

          h.last_watched_at
            AS lastWatchedAt

        FROM watch_history h

        INNER JOIN users u
          ON u.id = h.user_id

        INNER JOIN videos v
          ON v.id = h.video_id

        ORDER BY
          h.last_watched_at DESC

        LIMIT 20
      `);


    console.log("");
    console.log(
      "===== FAVORITES FROM MOBILE ====="
    );

    console.table(
      favorites
    );


    console.log("");
    console.log(
      "===== WATCH HISTORY FROM MOBILE ====="
    );

    console.table(
      history
    );


    console.log("");

    if (
      favorites.length > 0 &&
      history.length > 0
    ) {
      console.log(
        "===== MOBILE TO MYSQL SYNC SUCCESS ====="
      );
    } else {
      console.log(
        "===== MOBILE TO MYSQL ROWS MISSING ====="
      );
    }

  } catch (error) {

    console.error(
      "DB VERIFY ERROR:",
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

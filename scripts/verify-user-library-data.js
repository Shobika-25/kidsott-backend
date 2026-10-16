const mysql =
  require("mysql2/promise");

const dotenv =
  require("dotenv");

dotenv.config();

async function verify() {
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


    console.log("");
    console.log(
      "===================================="
    );
    console.log(
      " USER LIBRARY REAL DATA CHECK"
    );
    console.log(
      "===================================="
    );


    const [favorites] =
      await db.query(`
        SELECT
          f.user_id AS userId,
          u.name AS userName,
          u.email,
          f.video_id AS videoId,
          v.title AS videoTitle,
          f.created_at AS createdAt

        FROM favorites f

        INNER JOIN users u
          ON u.id =
            f.user_id

        INNER JOIN videos v
          ON v.id =
            f.video_id

        ORDER BY
          f.created_at DESC

        LIMIT 20
      `);


    console.log("");
    console.log(
      "===== FAVORITES ====="
    );

    console.table(
      favorites
    );


    const [history] =
      await db.query(`
        SELECT
          h.user_id AS userId,
          u.name AS userName,
          u.email,

          h.video_id AS videoId,
          v.title AS videoTitle,

          ROUND(
            h.position_seconds,
            2
          ) AS positionSeconds,

          ROUND(
            h.duration,
            2
          ) AS duration,

          h.completed,

          h.last_watched_at AS lastWatchedAt

        FROM watch_history h

        INNER JOIN users u
          ON u.id =
            h.user_id

        INNER JOIN videos v
          ON v.id =
            h.video_id

        ORDER BY
          h.last_watched_at DESC

        LIMIT 20
      `);


    console.log("");
    console.log(
      "===== WATCH HISTORY ====="
    );

    console.table(
      history
    );


    const [counts] =
      await db.query(`
        SELECT
          u.id AS userId,
          u.name,
          u.email,

          (
            SELECT COUNT(*)
            FROM favorites f
            WHERE
              f.user_id = u.id
          ) AS favorites,

          (
            SELECT COUNT(*)
            FROM watch_history h
            WHERE
              h.user_id = u.id
          ) AS history

        FROM users u

        WHERE
          u.is_active = 1

        ORDER BY
          u.id DESC
      `);


    console.log("");
    console.log(
      "===== USER TOTALS ====="
    );

    console.table(
      counts
    );


    if (
      favorites.length === 0
    ) {
      console.log(
        "WARNING: No favorite rows found."
      );
    }


    if (
      history.length === 0
    ) {
      console.log(
        "WARNING: No watch history rows found."
      );
    }


    if (
      favorites.length > 0 &&
      history.length > 0
    ) {
      console.log("");
      console.log(
        "===== ACCOUNT LIBRARY SYNC SUCCESS ====="
      );

      console.log(
        "Favorite persisted to MySQL."
      );

      console.log(
        "Watch progress persisted to MySQL."
      );
    }

  } catch (error) {

    console.error("");
    console.error(
      "USER LIBRARY VERIFY FAILED:"
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

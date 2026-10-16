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

        ORDER BY id ASC

        LIMIT 1
      `);


    if (!users.length) {
      throw new Error(
        "No active user found."
      );
    }


    const user =
      users[0];

    const videoId =
      606;


    const [oldFavorite] =
      await db.query(
        `
          SELECT *
          FROM favorites
          WHERE
            user_id = ?
            AND video_id = ?
        `,
        [
          user.id,
          videoId,
        ]
      );


    const [oldHistory] =
      await db.query(
        `
          SELECT *
          FROM watch_history
          WHERE
            user_id = ?
            AND video_id = ?
        `,
        [
          user.id,
          videoId,
        ]
      );


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


    const base =
      `http://127.0.0.1:${process.env.PORT || 5000}/api/library`;


    const headers = {
      Accept:
        "application/json",

      "Content-Type":
        "application/json",

      Authorization:
        `Bearer ${token}`,
    };


    console.log("");
    console.log(
      "===== BACKEND LIBRARY API TEST ====="
    );

    console.log(
      `User  : ${user.email}`
    );

    console.log(
      `Video : ${videoId}`
    );


    // =====================================================
    // FAVORITE WRITE
    // =====================================================

    let response =
      await fetch(
        `${base}/favorites/${videoId}`,
        {
          method:
            "PUT",

          headers,
        }
      );


    const favoriteWrite =
      await response.json();


    console.log(
      "Favorite PUT:",
      response.status,
      favoriteWrite
    );


    if (!response.ok) {
      throw new Error(
        `Favorite PUT failed: ${response.status}`
      );
    }


    // =====================================================
    // WATCH HISTORY WRITE
    // =====================================================

    response =
      await fetch(
        `${base}/history/${videoId}`,
        {
          method:
            "PUT",

          headers,

          body:
            JSON.stringify({
              currentTime:
                15,

              duration:
                120,

              completed:
                false,

              lastWatchedAt:
                Date.now(),
            }),
        }
      );


    const historyWrite =
      await response.json();


    console.log(
      "History PUT:",
      response.status,
      historyWrite
    );


    if (!response.ok) {
      throw new Error(
        `History PUT failed: ${response.status}`
      );
    }


    // =====================================================
    // DATABASE VERIFY
    // =====================================================

    const [favoriteRows] =
      await db.query(
        `
          SELECT
            user_id AS userId,
            video_id AS videoId

          FROM favorites

          WHERE
            user_id = ?
            AND video_id = ?
        `,
        [
          user.id,
          videoId,
        ]
      );


    const [historyRows] =
      await db.query(
        `
          SELECT
            user_id AS userId,
            video_id AS videoId,
            position_seconds AS positionSeconds,
            duration,
            completed

          FROM watch_history

          WHERE
            user_id = ?
            AND video_id = ?
        `,
        [
          user.id,
          videoId,
        ]
      );


    console.log("");
    console.log(
      "===== DATABASE WRITE RESULT ====="
    );

    console.table(
      favoriteRows
    );

    console.table(
      historyRows
    );


    if (
      favoriteRows.length !== 1
    ) {
      throw new Error(
        "Favorite row was not stored."
      );
    }


    if (
      historyRows.length !== 1
    ) {
      throw new Error(
        "Watch history row was not stored."
      );
    }


    console.log("");
    console.log(
      "===== BACKEND LIBRARY API SUCCESS ====="
    );


    // =====================================================
    // RESTORE PREVIOUS STATE
    // Test must not change real user data
    // =====================================================

    if (
      oldFavorite.length === 0
    ) {
      await db.query(
        `
          DELETE FROM favorites
          WHERE
            user_id = ?
            AND video_id = ?
        `,
        [
          user.id,
          videoId,
        ]
      );
    }


    if (
      oldHistory.length === 0
    ) {
      await db.query(
        `
          DELETE FROM watch_history
          WHERE
            user_id = ?
            AND video_id = ?
        `,
        [
          user.id,
          videoId,
        ]
      );
    } else {
      const old =
        oldHistory[0];

      await db.query(
        `
          UPDATE watch_history

          SET
            position_seconds = ?,
            duration = ?,
            completed = ?,
            last_watched_at = ?

          WHERE
            user_id = ?
            AND video_id = ?
        `,
        [
          old.position_seconds,
          old.duration,
          old.completed,
          old.last_watched_at,
          user.id,
          videoId,
        ]
      );
    }


    console.log(
      "Test data restored."
    );

  } catch (error) {

    console.error("");
    console.error(
      "BACKEND LIBRARY TEST FAILED:"
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

main();

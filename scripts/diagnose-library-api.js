const mysql =
  require("mysql2/promise");

const jwt =
  require("jsonwebtoken");

const dotenv =
  require("dotenv");

dotenv.config();


const port =
  Number(
    process.env.PORT ||
    5000
  );

const baseUrl =
  `http://127.0.0.1:${port}`;


async function request(
  label,
  url,
  options = {}
) {
  console.log("");
  console.log(
    `===== ${label} =====`
  );

  try {
    const response =
      await fetch(
        url,
        options
      );

    const text =
      await response.text();

    let body =
      text;

    try {
      body =
        text
          ? JSON.parse(text)
          : null;
    } catch {
      // Keep raw response text.
    }

    console.log(
      "STATUS:",
      response.status
    );

    console.log(
      "BODY:"
    );

    console.dir(
      body,
      {
        depth: 10,
      }
    );

    return {
      ok:
        response.ok,

      status:
        response.status,

      body,
    };

  } catch (error) {

    console.log(
      "FETCH ERROR:"
    );

    console.log(
      error instanceof Error
        ? error.message
        : error
    );

    return {
      ok: false,
      status: 0,
      body: null,
    };
  }
}


async function main() {
  let db;

  let user;

  const videoId =
    606;

  let oldFavorite =
    [];

  let oldHistory =
    [];

  let finalSuccess =
    false;


  try {

    console.log("");
    console.log(
      "========================================"
    );

    console.log(
      " KIDS OTT LIBRARY FULL DIAGNOSTIC"
    );

    console.log(
      "========================================"
    );


    // =====================================================
    // ENV
    // =====================================================

    console.log("");
    console.log(
      "===== ENVIRONMENT ====="
    );

    console.log(
      "PORT:",
      port
    );

    console.log(
      "DB_NAME:",
      process.env.DB_NAME
    );

    console.log(
      "JWT_SECRET PRESENT:",
      Boolean(
        process.env.JWT_SECRET
      )
    );

    console.log(
      "JWT_SECRET LENGTH:",
      String(
        process.env.JWT_SECRET ||
        ""
      ).length
    );


    if (
      !process.env.JWT_SECRET
    ) {
      throw new Error(
        "JWT_SECRET is missing."
      );
    }


    // =====================================================
    // DATABASE
    // =====================================================

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


    await db.query(
      "SELECT 1"
    );

    console.log("");
    console.log(
      "DATABASE CONNECTION: OK"
    );


    // =====================================================
    // USER
    // =====================================================

    const [users] =
      await db.query(`
        SELECT
          id,
          name,
          email,
          role,
          is_active AS isActive

        FROM users

        WHERE is_active = 1

        ORDER BY
          CASE
            WHEN role = 'user'
            THEN 0
            ELSE 1
          END,
          id ASC

        LIMIT 1
      `);


    if (!users.length) {
      throw new Error(
        "No active user exists."
      );
    }


    user =
      users[0];


    console.log("");
    console.log(
      "===== TEST USER ====="
    );

    console.table([
      {
        id:
          Number(user.id),

        name:
          user.name,

        email:
          user.email,

        role:
          user.role,
      },
    ]);


    // =====================================================
    // VIDEO
    // =====================================================

    const [videos] =
      await db.query(
        `
          SELECT
            id,
            title,
            status

          FROM videos

          WHERE id = ?

          LIMIT 1
        `,
        [
          videoId,
        ]
      );


    if (!videos.length) {
      throw new Error(
        `Video ${videoId} not found.`
      );
    }


    console.log("");
    console.log(
      "===== TEST VIDEO ====="
    );

    console.table(
      videos
    );


    // =====================================================
    // SNAPSHOT EXISTING TEST ROWS
    // =====================================================

    [oldFavorite] =
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


    [oldHistory] =
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


    // =====================================================
    // DIRECT DATABASE WRITE TEST
    // Transaction will be rolled back.
    // =====================================================

    console.log("");
    console.log(
      "===== DIRECT DATABASE WRITE TEST ====="
    );


    await db.beginTransaction();


    try {

      await db.query(
        `
          INSERT IGNORE
          INTO favorites (
            user_id,
            video_id
          )
          VALUES (?, ?)
        `,
        [
          user.id,
          videoId,
        ]
      );


      await db.query(
        `
          INSERT INTO watch_history (
            user_id,
            video_id,
            position_seconds,
            duration,
            completed,
            last_watched_at
          )

          VALUES (
            ?, ?, ?, ?, ?, ?
          )

          ON DUPLICATE KEY UPDATE

            position_seconds =
              VALUES(position_seconds),

            duration =
              VALUES(duration),

            completed =
              VALUES(completed),

            last_watched_at =
              VALUES(last_watched_at)
        `,
        [
          user.id,
          videoId,
          15,
          120,
          0,
          Date.now(),
        ]
      );


      const [directFavorites] =
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


      const [directHistory] =
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


      console.log(
        "Direct favorite:"
      );

      console.table(
        directFavorites
      );


      console.log(
        "Direct history:"
      );

      console.table(
        directHistory
      );


      await db.rollback();


      console.log(
        "DIRECT DATABASE WRITE: SUCCESS"
      );

    } catch (error) {

      await db.rollback();

      console.log(
        "DIRECT DATABASE WRITE: FAILED"
      );

      console.log(
        error instanceof Error
          ? error.message
          : error
      );

      throw error;
    }


    // =====================================================
    // GENERATE JWT
    // =====================================================

    const token =
      jwt.sign(
        {
          id:
            Number(
              user.id
            ),

          name:
            user.name,

          email:
            user.email,

          role:
            user.role,
        },

        process.env.JWT_SECRET,

        {
          expiresIn:
            "10m",
        }
      );


    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );


    console.log("");
    console.log(
      "===== LOCAL JWT ====="
    );

    console.log(
      "JWT CREATE/VERIFY: SUCCESS"
    );

    console.dir(
      decoded
    );


    const headers = {
      Accept:
        "application/json",

      "Content-Type":
        "application/json",

      Authorization:
        `Bearer ${token}`,
    };


    // =====================================================
    // SERVER HEALTH
    // =====================================================

    const health =
      await request(
        "SERVER HEALTH",

        `${baseUrl}/api/health`
      );


    if (!health.ok) {
      throw new Error(
        "Backend server health check failed."
      );
    }


    // =====================================================
    // AUTH TOKEN TEST
    // =====================================================

    const me =
      await request(
        "AUTH ME WITH BEARER TOKEN",

        `${baseUrl}/api/auth/me`,

        {
          method:
            "GET",

          headers,
        }
      );


    // =====================================================
    // LIBRARY GET
    // =====================================================

    const favoritesBefore =
      await request(
        "LIBRARY FAVORITES GET",

        `${baseUrl}/api/library/favorites`,

        {
          method:
            "GET",

          headers,
        }
      );


    // =====================================================
    // FAVORITE PUT
    // =====================================================

    const favoritePut =
      await request(
        "FAVORITE PUT",

        `${baseUrl}/api/library/favorites/${videoId}`,

        {
          method:
            "PUT",

          headers,
        }
      );


    // =====================================================
    // HISTORY PUT
    // =====================================================

    const historyPut =
      await request(
        "HISTORY PUT",

        `${baseUrl}/api/library/history/${videoId}`,

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


    // =====================================================
    // VERIFY ACTUAL DB AFTER HTTP
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

            position_seconds
              AS positionSeconds,

            duration,
            completed,
            last_watched_at
              AS lastWatchedAt

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
      "===== DB AFTER HTTP REQUESTS ====="
    );


    console.log(
      "Favorites:"
    );

    console.table(
      favoriteRows
    );


    console.log(
      "History:"
    );

    console.table(
      historyRows
    );


    // =====================================================
    // RESULT
    // =====================================================

    console.log("");
    console.log(
      "========================================"
    );

    console.log(
      " DIAGNOSTIC RESULT"
    );

    console.log(
      "========================================"
    );


    console.log(
      "Health:",
      health.status
    );

    console.log(
      "Auth /me:",
      me.status
    );

    console.log(
      "Favorites GET:",
      favoritesBefore.status
    );

    console.log(
      "Favorite PUT:",
      favoritePut.status
    );

    console.log(
      "History PUT:",
      historyPut.status
    );


    if (
      favoritePut.ok &&
      historyPut.ok &&
      favoriteRows.length === 1 &&
      historyRows.length === 1
    ) {

      finalSuccess =
        true;

      console.log("");
      console.log(
        "===== BACKEND LIBRARY API SUCCESS ====="
      );

    } else {

      console.log("");
      console.log(
        "===== BACKEND LIBRARY API FAILED ====="
      );


      if (
        favoritePut.status === 401 ||
        historyPut.status === 401
      ) {
        console.log(
          "CAUSE AREA: JWT / authentication middleware."
        );
      }


      if (
        favoritePut.status === 404 ||
        historyPut.status === 404
      ) {
        console.log(
          "CAUSE AREA: Library route or video lookup."
        );
      }


      if (
        favoritePut.status === 500 ||
        historyPut.status === 500
      ) {
        console.log(
          "CAUSE AREA: Library controller / SQL runtime."
        );
      }
    }

  } catch (error) {

    console.log("");
    console.log(
      "===== DIAGNOSTIC FATAL ERROR ====="
    );

    console.log(
      error instanceof Error
        ? error.message
        : error
    );

  } finally {

    // =====================================================
    // RESTORE TEST DATA
    // =====================================================

    if (
      db &&
      user
    ) {
      try {

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


        console.log("");
        console.log(
          "Diagnostic test data restored."
        );

      } catch (restoreError) {

        console.log(
          "RESTORE ERROR:",
          restoreError instanceof Error
            ? restoreError.message
            : restoreError
        );
      }


      await db.end();
    }


    if (!finalSuccess) {
      process.exitCode = 1;
    }
  }
}


main();

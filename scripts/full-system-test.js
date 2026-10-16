const mysql =
  require("mysql2/promise");

const jwt =
  require("jsonwebtoken");

const dotenv =
  require("dotenv");

dotenv.config();


const PORT =
  Number(
    process.env.PORT ||
    5000
  );


const BASE =
  `http://127.0.0.1:${PORT}/api`;


const requiredTables = [
  "users",
  "categories",
  "videos",
  "favorites",
  "watch_history",
  "user_settings",
  "support_tickets",
];


let db =
  null;


let tempUserId =
  null;


let originalEmail =
  null;


let updatedEmail =
  null;


function pass(
  label,
  value = "",
) {

  console.log(
    `${label.padEnd(42)} : OK${value ? ` - ${value}` : ""}`
  );
}


function fail(
  message
) {

  throw new Error(
    message
  );
}


async function request(
  label,
  path,
  options = {},
  expectedStatuses = [200],
) {

  let response;


  try {

    response =
      await fetch(
        `${BASE}${path}`,
        options
      );

  } catch (error) {

    fail(
      `${label}: fetch failed - ${
        error instanceof Error
          ? error.message
          : error
      }`
    );
  }


  const text =
    await response.text();


  let body =
    null;


  try {

    body =
      text
        ? JSON.parse(text)
        : null;

  } catch {

    body =
      text;
  }


  const valid =
    expectedStatuses.includes(
      response.status
    );


  console.log(
    `${label.padEnd(42)} : ${response.status} ${
      valid
        ? "OK"
        : "FAILED"
    }`
  );


  if (!valid) {

    console.dir(
      body,
      {
        depth: 10,
      }
    );


    fail(
      `${label} returned unexpected HTTP ${response.status}`
    );
  }


  return {
    response,
    body,
  };
}


function authHeaders(
  token
) {

  return {
    Accept:
      "application/json",

    "Content-Type":
      "application/json",

    Authorization:
      `Bearer ${token}`,
  };
}


async function main() {

  try {

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      " BACKEND + DATABASE E2E"
    );

    console.log(
      "=========================================="
    );


    // =====================================================
    // ENV
    // =====================================================

    if (
      !process.env.JWT_SECRET
    ) {

      fail(
        "JWT_SECRET missing."
      );
    }


    pass(
      "Environment"
    );


    // =====================================================
    // MYSQL CONNECTION
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


    pass(
      "MySQL connection"
    );


    // =====================================================
    // REQUIRED TABLES
    // =====================================================

    const placeholders =
      requiredTables
        .map(
          () => "?"
        )
        .join(",");


    const [tableRows] =
      await db.query(
        `
          SELECT
            TABLE_NAME AS tableName,
            ENGINE AS engine

          FROM information_schema.TABLES

          WHERE
            TABLE_SCHEMA = ?
            AND TABLE_NAME IN (
              ${placeholders}
            )
        `,
        [
          process.env.DB_NAME ||
            "kidsott_db",

          ...requiredTables,
        ]
      );


    const foundTables =
      new Set(
        tableRows.map(
          row =>
            row.tableName
        )
      );


    for (
      const table
      of requiredTables
    ) {

      if (
        !foundTables.has(
          table
        )
      ) {

        fail(
          `Missing database table: ${table}`
        );
      }
    }


    pass(
      "Required MySQL tables",
      `${tableRows.length}/${requiredTables.length}`
    );


    // =====================================================
    // DATABASE CONTENT
    // =====================================================

    const [categoryCountRows] =
      await db.query(
        `
          SELECT COUNT(*) AS total
          FROM categories
        `
      );


    const dbCategoryCount =
      Number(
        categoryCountRows[0].total
      );


    if (
      dbCategoryCount !== 6
    ) {

      fail(
        `Expected 6 categories in DB, found ${dbCategoryCount}`
      );
    }


    pass(
      "Database categories",
      "6"
    );


    const [videoCountRows] =
      await db.query(
        `
          SELECT COUNT(*) AS total

          FROM videos

          WHERE status = 'published'
        `
      );


    const dbVideoCount =
      Number(
        videoCountRows[0].total
      );


    if (
      dbVideoCount !== 36
    ) {

      fail(
        `Expected 36 published videos in DB, found ${dbVideoCount}`
      );
    }


    pass(
      "Database published videos",
      "36"
    );


    // =====================================================
    // HEALTH
    // =====================================================

    await request(
      "GET /health",
      "/health"
    );


    // =====================================================
    // CATEGORIES API
    // =====================================================

    const categoryResult =
      await request(
        "GET /categories",
        "/categories"
      );


    const categories =
      Array.isArray(
        categoryResult.body
      )
        ? categoryResult.body
        : categoryResult.body?.categories;


    if (
      !Array.isArray(
        categories
      ) ||
      categories.length !== 6
    ) {

      fail(
        "Categories API did not return exactly 6 categories."
      );
    }


    pass(
      "Categories payload",
      "6 categories"
    );


    // =====================================================
    // VIDEO API
    // =====================================================

    const videosResult =
      await request(
        "GET /videos?limit=100",
        "/videos?limit=100"
      );


    const videos =
      videosResult.body?.videos;


    if (
      !Array.isArray(
        videos
      ) ||
      videos.length !== 36
    ) {

      fail(
        `Videos API expected 36 videos, received ${
          Array.isArray(videos)
            ? videos.length
            : "invalid payload"
        }`
      );
    }


    if (
      Number(
        videosResult.body
          ?.pagination
          ?.total
      ) !== 36
    ) {

      fail(
        "Video pagination total is not 36."
      );
    }


    pass(
      "Published video API",
      "36 videos"
    );


    const expectedCategories =
      [
        "Cartoons",
        "Learning",
        "Stories",
        "Science",
        "Rhymes",
        "Animals",
      ];


    for (
      const category
      of expectedCategories
    ) {

      const count =
        videos.filter(
          video =>
            video.category ===
            category
        ).length;


      if (
        count !== 6
      ) {

        fail(
          `${category} expected 6 videos, found ${count}`
        );
      }


      pass(
        `Catalog ${category}`,
        "6 videos"
      );
    }


    // =====================================================
    // EVERY VIDEO DETAIL
    // =====================================================

    for (
      const video
      of videos
    ) {

      if (
        !video.id ||
        !video.title ||
        !video.category ||
        !video.videoUrl
      ) {

        fail(
          `Invalid video payload for id ${video.id}`
        );
      }


      await request(
        `GET /videos/${video.id}`,
        `/videos/${video.id}`
      );
    }


    pass(
      "All video detail routes",
      "36/36"
    );


    // =====================================================
    // PROTECTED ROUTES WITHOUT JWT
    // =====================================================

    await request(
      "Library rejects guest",
      "/library/favorites",
      {},
      [401]
    );


    await request(
      "Account rejects guest",
      "/account/profile",
      {},
      [401]
    );


    await request(
      "Support rejects guest",
      "/support/tickets",
      {},
      [401]
    );


    // =====================================================
    // REGISTER TEMP TEST USER
    // =====================================================

    const stamp =
      Date.now();


    originalEmail =
      `fullsystem${stamp}@kidsstream.com`;


    updatedEmail =
      `fullsystem${stamp}.updated@kidsstream.com`;


    const password =
      "FullTest@123";


    const registerResult =
      await request(
        "POST /auth/register",
        "/auth/register",
        {
          method:
            "POST",

          headers: {
            Accept:
              "application/json",

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              name:
                "Full System Test",

              email:
                originalEmail,

              password,
            }),
        },
        [
          200,
          201,
        ]
      );


    if (
      !registerResult.body
        ?.user
        ?.id
    ) {

      fail(
        "Register API did not return user."
      );
    }


    tempUserId =
      Number(
        registerResult.body.user.id
      );


    pass(
      "Temporary QA user created",
      `id ${tempUserId}`
    );


    // =====================================================
    // LOGIN
    // =====================================================

    const loginResult =
      await request(
        "POST /auth/login",
        "/auth/login",
        {
          method:
            "POST",

          headers: {
            Accept:
              "application/json",

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              email:
                originalEmail,

              password,
            }),
        }
      );


    const token =
      loginResult.body?.token;


    if (!token) {

      fail(
        "Login API did not return JWT."
      );
    }


    const headers =
      authHeaders(
        token
      );


    // =====================================================
    // LOGIN FAILURE
    // =====================================================

    await request(
      "Wrong password rejected",
      "/auth/login",
      {
        method:
          "POST",

        headers: {
          Accept:
            "application/json",

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            email:
              originalEmail,

            password:
              "WrongPassword999",
          }),
      },
      [
        400,
        401,
      ]
    );


    // =====================================================
    // AUTH ME
    // =====================================================

    const meResult =
      await request(
        "GET /auth/me",
        "/auth/me",
        {
          headers,
        }
      );


    if (
      Number(
        meResult.body
          ?.user
          ?.id
      ) !== tempUserId
    ) {

      fail(
        "/auth/me returned wrong user."
      );
    }


    // =====================================================
    // EXPIRED TOKEN
    // =====================================================

    const expiredToken =
      jwt.sign(
        {
          id:
            tempUserId,

          role:
            "user",
        },

        process.env.JWT_SECRET,

        {
          expiresIn:
            -10,
        }
      );


    await request(
      "Expired JWT rejected",
      "/auth/me",
      {
        headers:
          authHeaders(
            expiredToken
          ),
      },
      [401]
    );


    // =====================================================
    // USER CANNOT ENTER ADMIN
    // =====================================================

    await request(
      "Normal user admin protection",
      "/auth/admin-check",
      {
        headers,
      },
      [403]
    );


    // =====================================================
    // ACTIVE ADMIN JWT CHECK
    // =====================================================

    const [admins] =
      await db.query(
        `
          SELECT
            id,
            role

          FROM users

          WHERE
            role = 'admin'
            AND is_active = 1

          ORDER BY id ASC

          LIMIT 1
        `
      );


    if (!admins.length) {

      fail(
        "No active admin user found for admin protection test."
      );
    }


    const adminToken =
      jwt.sign(
        {
          id:
            Number(
              admins[0].id
            ),

          role:
            "admin",
        },

        process.env.JWT_SECRET,

        {
          expiresIn:
            "10m",
        }
      );


    await request(
      "Admin role verification",
      "/auth/admin-check",
      {
        headers:
          authHeaders(
            adminToken
          ),
      }
    );


    // =====================================================
    // FAVORITES
    // =====================================================

    const testVideoId =
      videos.some(
        video =>
          Number(video.id) === 606
      )
        ? 606
        : Number(
            videos[0].id
          );


    let favoritesResult =
      await request(
        "GET empty favorites",
        "/library/favorites",
        {
          headers,
        }
      );


    if (
      !Array.isArray(
        favoritesResult.body
          ?.favorites
      ) ||
      favoritesResult.body
        .favorites
        .length !== 0
    ) {

      fail(
        "New test user favorites should be empty."
      );
    }


    await request(
      "PUT favorite",
      `/library/favorites/${testVideoId}`,
      {
        method:
          "PUT",

        headers,
      }
    );


    const [favoriteRows] =
      await db.query(
        `
          SELECT
            user_id,
            video_id

          FROM favorites

          WHERE
            user_id = ?
            AND video_id = ?
        `,
        [
          tempUserId,
          testVideoId,
        ]
      );


    if (
      favoriteRows.length !== 1
    ) {

      fail(
        "Favorite was not persisted to MySQL."
      );
    }


    pass(
      "Favorite MySQL persistence"
    );


    // =====================================================
    // WATCH HISTORY
    // =====================================================

    const watchedAt =
      Date.now();


    await request(
      "PUT watch progress",
      `/library/history/${testVideoId}`,
      {
        method:
          "PUT",

        headers,

        body:
          JSON.stringify({
            currentTime:
              22.5,

            duration:
              120,

            completed:
              false,

            lastWatchedAt:
              watchedAt,
          }),
      }
    );


    const [historyRows] =
      await db.query(
        `
          SELECT
            position_seconds,
            duration,
            completed,
            last_watched_at

          FROM watch_history

          WHERE
            user_id = ?
            AND video_id = ?
        `,
        [
          tempUserId,
          testVideoId,
        ]
      );


    if (
      historyRows.length !== 1
    ) {

      fail(
        "Watch history was not persisted to MySQL."
      );
    }


    if (
      Number(
        historyRows[0]
          .position_seconds
      ) !== 22.5
    ) {

      fail(
        "Watch position in MySQL is incorrect."
      );
    }


    pass(
      "Watch history MySQL persistence"
    );


    // =====================================================
    // LIBRARY GET + SYNC
    // =====================================================

    favoritesResult =
      await request(
        "GET favorites after save",
        "/library/favorites",
        {
          headers,
        }
      );


    const historyResult =
      await request(
        "GET history after save",
        "/library/history",
        {
          headers,
        }
      );


    const favoritePayload =
      favoritesResult.body
        ?.favorites;


    if (
      !Array.isArray(
        favoritePayload
      )
    ) {

      fail(
        "Favorites GET payload is not an array."
      );
    }


    console.log(
      "Favorites GET payload:",
      JSON.stringify(
        favoritePayload
      )
    );


    const favoriteIds =
      favoritePayload
        .map(
          item => {

            if (
              typeof item ===
              "number" ||
              typeof item ===
              "string"
            ) {

              return Number(
                item
              );
            }


            if (
              item &&
              typeof item ===
                "object"
            ) {

              return Number(
                item.videoId ??
                item.video_id ??
                item.id ??
                0
              );
            }


            return 0;
          }
        )
        .filter(
          id =>
            Number.isInteger(
              id
            ) &&
            id > 0
        );


    if (
      !favoriteIds.includes(
        testVideoId
      )
    ) {

      fail(
        `Saved favorite ${testVideoId} missing from GET API. Payload: ${JSON.stringify(favoritePayload)}`
      );
    }


    pass(
      "Favorite GET normalization",
      String(testVideoId)
    );


    if (
      !historyResult.body
        ?.history
        ?.some(
          item =>
            Number(
              item.videoId
            ) ===
            testVideoId
        )
    ) {

      fail(
        "Saved history missing from GET API."
      );
    }


    await request(
      "POST library sync",
      "/library/sync",
      {
        method:
          "POST",

        headers,

        body:
          JSON.stringify({
            favorites:
              favoriteIds,

            history:
              historyResult.body
                .history
                .map(
                  item => ({
                    videoId:
                      item.videoId,

                    currentTime:
                      item.currentTime,

                    duration:
                      item.duration,

                    lastWatchedAt:
                      item.lastWatchedAt,

                    completed:
                      item.completed,
                  }),
                ),
          }),
      }
    );


    // =====================================================
    // LIBRARY DELETE
    // =====================================================

    await request(
      "DELETE favorite",
      `/library/favorites/${testVideoId}`,
      {
        method:
          "DELETE",

        headers,
      }
    );


    await request(
      "DELETE history item",
      `/library/history/${testVideoId}`,
      {
        method:
          "DELETE",

        headers,
      }
    );


    const [remainingFavorite] =
      await db.query(
        `
          SELECT COUNT(*) AS total

          FROM favorites

          WHERE user_id = ?
        `,
        [
          tempUserId,
        ]
      );


    const [remainingHistory] =
      await db.query(
        `
          SELECT COUNT(*) AS total

          FROM watch_history

          WHERE user_id = ?
        `,
        [
          tempUserId,
        ]
      );


    if (
      Number(
        remainingFavorite[0]
          .total
      ) !== 0 ||
      Number(
        remainingHistory[0]
          .total
      ) !== 0
    ) {

      fail(
        "Library DELETE did not clear test rows."
      );
    }


    pass(
      "Favorite/history delete"
    );


    // =====================================================
    // PROFILE GET
    // =====================================================

    const profileResult =
      await request(
        "GET account profile",
        "/account/profile",
        {
          headers,
        }
      );


    if (
      profileResult.body
        ?.user
        ?.email !==
      originalEmail
    ) {

      fail(
        "Initial profile email mismatch."
      );
    }


    // =====================================================
    // PROFILE UPDATE
    // =====================================================

    const profileUpdate =
      await request(
        "PUT account profile",
        "/account/profile",
        {
          method:
            "PUT",

          headers,

          body:
            JSON.stringify({
              name:
                "Full System QA",

              email:
                updatedEmail,
            }),
        }
      );


    if (
      profileUpdate.body
        ?.user
        ?.name !==
        "Full System QA" ||
      profileUpdate.body
        ?.user
        ?.email !==
        updatedEmail
    ) {

      fail(
        "Profile update response mismatch."
      );
    }


    const [profileDb] =
      await db.query(
        `
          SELECT
            name,
            email

          FROM users

          WHERE id = ?

          LIMIT 1
        `,
        [
          tempUserId,
        ]
      );


    if (
      profileDb[0]
        ?.name !==
        "Full System QA" ||
      profileDb[0]
        ?.email !==
        updatedEmail
    ) {

      fail(
        "Profile update not persisted in MySQL."
      );
    }


    pass(
      "Profile MySQL persistence"
    );


    // =====================================================
    // LOGIN AFTER EMAIL CHANGE
    // =====================================================

    const relogin =
      await request(
        "Login with updated profile",
        "/auth/login",
        {
          method:
            "POST",

          headers: {
            Accept:
              "application/json",

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              email:
                updatedEmail,

              password,
            }),
        }
      );


    const updatedToken =
      relogin.body?.token;


    if (!updatedToken) {

      fail(
        "Login after profile update did not return JWT."
      );
    }


    const updatedHeaders =
      authHeaders(
        updatedToken
      );


    // =====================================================
    // SETTINGS
    // =====================================================

    const settingsBefore =
      await request(
        "GET initial settings",
        "/account/settings",
        {
          headers:
            updatedHeaders,
        }
      );


    if (
      settingsBefore.body
        ?.settings !== null
    ) {

      fail(
        "New user should initially have null server settings."
      );
    }


    const testSettings = {
      autoplay:
        false,

      wifiOnly:
        true,

      soundEffects:
        false,

      pushNotifications:
        true,

      safeMode:
        true,

      parentalControls:
        false,
    };


    await request(
      "PUT account settings",
      "/account/settings",
      {
        method:
          "PUT",

        headers:
          updatedHeaders,

        body:
          JSON.stringify(
            testSettings
          ),
      }
    );


    const settingsAfter =
      await request(
        "GET saved settings",
        "/account/settings",
        {
          headers:
            updatedHeaders,
        }
      );


    for (
      const [
        key,
        value
      ]
      of Object.entries(
        testSettings
      )
    ) {

      if (
        settingsAfter.body
          ?.settings
          ?.[key] !==
        value
      ) {

        fail(
          `Settings mismatch for ${key}`
        );
      }
    }


    const [settingsDb] =
      await db.query(
        `
          SELECT COUNT(*) AS total

          FROM user_settings

          WHERE user_id = ?
        `,
        [
          tempUserId,
        ]
      );


    if (
      Number(
        settingsDb[0].total
      ) !== 1
    ) {

      fail(
        "Settings row missing in MySQL."
      );
    }


    pass(
      "Settings MySQL persistence"
    );


    // =====================================================
    // SUPPORT
    // =====================================================

    const supportCreate =
      await request(
        "POST support ticket",
        "/support/tickets",
        {
          method:
            "POST",

          headers:
            updatedHeaders,

          body:
            JSON.stringify({
              type:
                "Playback",

              message:
                "Full system automated support test.",
            }),
        },
        [201]
      );


    const ticketId =
      Number(
        supportCreate.body
          ?.ticket
          ?.id
      );


    if (
      !Number.isInteger(
        ticketId
      ) ||
      ticketId <= 0
    ) {

      fail(
        "Support ticket id invalid."
      );
    }


    const supportGet =
      await request(
        "GET support tickets",
        "/support/tickets",
        {
          headers:
            updatedHeaders,
        }
      );


    if (
      !supportGet.body
        ?.tickets
        ?.some(
          item =>
            Number(
              item.id
            ) === ticketId
        )
    ) {

      fail(
        "Created support ticket missing from GET."
      );
    }


    const [ticketDb] =
      await db.query(
        `
          SELECT COUNT(*) AS total

          FROM support_tickets

          WHERE
            id = ?
            AND user_id = ?
        `,
        [
          ticketId,
          tempUserId,
        ]
      );


    if (
      Number(
        ticketDb[0].total
      ) !== 1
    ) {

      fail(
        "Support ticket missing from MySQL."
      );
    }


    pass(
      "Support MySQL persistence"
    );


    await request(
      "DELETE support ticket",
      `/support/tickets/${ticketId}`,
      {
        method:
          "DELETE",

        headers:
          updatedHeaders,
      }
    );


    // =====================================================
    // FINAL USER DATA CHECK
    // =====================================================

    const [supportRemaining] =
      await db.query(
        `
          SELECT COUNT(*) AS total

          FROM support_tickets

          WHERE user_id = ?
        `,
        [
          tempUserId,
        ]
      );


    if (
      Number(
        supportRemaining[0]
          .total
      ) !== 0
    ) {

      fail(
        "Support DELETE left test rows behind."
      );
    }


    pass(
      "Support delete"
    );


    // =====================================================
    // RESULT
    // =====================================================

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      " BACKEND FULL E2E SUCCESS"
    );

    console.log(
      "=========================================="
    );

    console.log(
      "Health               : PASS"
    );

    console.log(
      "Database schema      : PASS"
    );

    console.log(
      "Categories           : PASS"
    );

    console.log(
      "36 video catalog     : PASS"
    );

    console.log(
      "36 detail endpoints  : PASS"
    );

    console.log(
      "Register/Login/JWT   : PASS"
    );

    console.log(
      "Expired JWT          : PASS"
    );

    console.log(
      "Admin role security  : PASS"
    );

    console.log(
      "Favorites            : PASS"
    );

    console.log(
      "Watch history        : PASS"
    );

    console.log(
      "Library sync         : PASS"
    );

    console.log(
      "Profile              : PASS"
    );

    console.log(
      "Settings             : PASS"
    );

    console.log(
      "Support tickets      : PASS"
    );

  } finally {

    if (
      db &&
      (
        tempUserId ||
        originalEmail ||
        updatedEmail
      )
    ) {

      try {

        if (
          tempUserId
        ) {

          await db.query(
            `
              DELETE FROM users
              WHERE id = ?
            `,
            [
              tempUserId,
            ]
          );

        } else {

          await db.query(
            `
              DELETE FROM users

              WHERE
                email = ?
                OR email = ?
            `,
            [
              originalEmail,
              updatedEmail,
            ]
          );
        }


        console.log("");
        console.log(
          "Temporary QA user/data cleaned."
        );

      } catch (cleanupError) {

        console.error(
          "TEST CLEANUP ERROR:",
          cleanupError instanceof Error
            ? cleanupError.message
            : cleanupError
        );
      }
    }


    if (db) {
      await db.end();
    }
  }
}


main()
  .catch(
    error => {

      console.error("");
      console.error(
        "=========================================="
      );

      console.error(
        " FULL BACKEND TEST FAILED"
      );

      console.error(
        "=========================================="
      );

      console.error(
        error instanceof Error
          ? error.message
          : error
      );

      process.exitCode =
        1;
    },
  );


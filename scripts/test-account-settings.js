const mysql =
  require("mysql2/promise");

const jwt =
  require("jsonwebtoken");

const dotenv =
  require("dotenv");

dotenv.config();

const defaults = {
  autoplay: true,
  wifiOnly: false,
  soundEffects: true,
  pushNotifications: true,
  safeMode: true,
  parentalControls: false,
};

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

        ORDER BY id DESC

        LIMIT 1
      `);


    if (!users.length) {
      throw new Error(
        "No active user found."
      );
    }


    const user =
      users[0];


    const token =
      jwt.sign(
        {
          id:
            Number(
              user.id
            ),

          role:
            user.role,
        },

        process.env.JWT_SECRET,

        {
          expiresIn:
            "10m",
        }
      );


    const headers = {
      Accept:
        "application/json",

      "Content-Type":
        "application/json",

      Authorization:
        `Bearer ${token}`,
    };


    const base =
      `http://127.0.0.1:${process.env.PORT || 5000}/api/account`;


    console.log("");
    console.log(
      "===== PROFILE GET ====="
    );


    let response =
      await fetch(
        `${base}/profile`,
        {
          headers,
        }
      );


    console.log(
      "STATUS:",
      response.status
    );


    console.dir(
      await response.json(),
      {
        depth: 10,
      }
    );


    if (!response.ok) {
      throw new Error(
        "Profile GET failed."
      );
    }


    console.log("");
    console.log(
      "===== SETTINGS GET ====="
    );


    response =
      await fetch(
        `${base}/settings`,
        {
          headers,
        }
      );


    console.log(
      "STATUS:",
      response.status
    );


    const settingsBody =
      await response.json();


    console.dir(
      settingsBody,
      {
        depth: 10,
      }
    );


    if (!response.ok) {
      throw new Error(
        "Settings GET failed."
      );
    }


    const settings =
      settingsBody.settings ||
      defaults;


    console.log("");
    console.log(
      "===== SETTINGS PUT ====="
    );


    response =
      await fetch(
        `${base}/settings`,
        {
          method:
            "PUT",

          headers,

          body:
            JSON.stringify(
              settings
            ),
        }
      );


    console.log(
      "STATUS:",
      response.status
    );


    console.dir(
      await response.json(),
      {
        depth: 10,
      }
    );


    if (!response.ok) {
      throw new Error(
        "Settings PUT failed."
      );
    }


    const [rows] =
      await db.query(
        `
          SELECT
            user_id AS userId,
            autoplay,
            wifi_only AS wifiOnly,
            sound_effects AS soundEffects,
            push_notifications AS pushNotifications,
            safe_mode AS safeMode,
            parental_controls AS parentalControls

          FROM user_settings

          WHERE user_id = ?

          LIMIT 1
        `,
        [
          user.id,
        ]
      );


    console.log("");
    console.log(
      "===== MYSQL SETTINGS ====="
    );


    console.table(
      rows
    );


    if (
      rows.length !== 1
    ) {
      throw new Error(
        "Settings row was not stored."
      );
    }


    console.log("");
    console.log(
      "===== ACCOUNT SETTINGS API SUCCESS ====="
    );

  } catch (error) {

    console.error("");
    console.error(
      "ACCOUNT SETTINGS TEST FAILED:"
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

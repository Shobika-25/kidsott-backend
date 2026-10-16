const db =
  require("../config/db");

function sanitizeUser(row) {
  return {
    id:
      Number(row.id),

    name:
      row.name,

    email:
      row.email,

    role:
      row.role,

    isActive:
      Boolean(
        row.is_active
      ),

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at,
  };
}

function mapSettings(row) {
  return {
    autoplay:
      Boolean(
        row.autoplay
      ),

    wifiOnly:
      Boolean(
        row.wifi_only
      ),

    soundEffects:
      Boolean(
        row.sound_effects
      ),

    pushNotifications:
      Boolean(
        row.push_notifications
      ),

    safeMode:
      Boolean(
        row.safe_mode
      ),

    parentalControls:
      Boolean(
        row.parental_controls
      ),
  };
}

async function getProfile(
  req,
  res
) {
  try {
    const [rows] =
      await db.query(
        `
          SELECT
            id,
            name,
            email,
            role,
            is_active,
            created_at,
            updated_at

          FROM users

          WHERE id = ?

          LIMIT 1
        `,
        [
          req.user.id,
        ]
      );

    if (!rows.length) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "User not found.",
        });
    }

    return res.json({
      success: true,

      user:
        sanitizeUser(
          rows[0]
        ),
    });

  } catch (error) {

    console.error(
      "GET PROFILE ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to load profile.",
      });
  }
}

async function updateProfile(
  req,
  res
) {
  try {
    const name =
      String(
        req.body.name ||
        ""
      ).trim();

    const email =
      String(
        req.body.email ||
        ""
      )
        .trim()
        .toLowerCase();

    if (
      !name ||
      !email
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Name and email are required.",
        });
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(email)
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Enter a valid email address.",
        });
    }

    const [existing] =
      await db.query(
        `
          SELECT id

          FROM users

          WHERE
            email = ?
            AND id <> ?

          LIMIT 1
        `,
        [
          email,
          req.user.id,
        ]
      );

    if (existing.length) {
      return res
        .status(409)
        .json({
          success: false,
          message:
            "Email is already in use.",
        });
    }

    await db.query(
      `
        UPDATE users

        SET
          name = ?,
          email = ?

        WHERE id = ?
      `,
      [
        name,
        email,
        req.user.id,
      ]
    );

    const [rows] =
      await db.query(
        `
          SELECT
            id,
            name,
            email,
            role,
            is_active,
            created_at,
            updated_at

          FROM users

          WHERE id = ?

          LIMIT 1
        `,
        [
          req.user.id,
        ]
      );

    return res.json({
      success: true,
      message:
        "Profile updated.",

      user:
        sanitizeUser(
          rows[0]
        ),
    });

  } catch (error) {

    console.error(
      "UPDATE PROFILE ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to update profile.",
      });
  }
}

async function getSettings(
  req,
  res
) {
  try {
    const [rows] =
      await db.query(
        `
          SELECT
            autoplay,
            wifi_only,
            sound_effects,
            push_notifications,
            safe_mode,
            parental_controls

          FROM user_settings

          WHERE user_id = ?

          LIMIT 1
        `,
        [
          req.user.id,
        ]
      );

    /*
     * No server settings yet:
     * mobile can migrate its existing
     * local preferences to MySQL.
     */
    if (!rows.length) {
      return res.json({
        success: true,
        settings: null,
      });
    }

    return res.json({
      success: true,

      settings:
        mapSettings(
          rows[0]
        ),
    });

  } catch (error) {

    console.error(
      "GET SETTINGS ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to load settings.",
      });
  }
}

async function updateSettings(
  req,
  res
) {
  try {
    const input =
      req.body || {};

    const required = [
      "autoplay",
      "wifiOnly",
      "soundEffects",
      "pushNotifications",
      "safeMode",
      "parentalControls",
    ];

    for (
      const key
      of required
    ) {
      if (
        typeof input[key] !==
        "boolean"
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              `Invalid setting: ${key}`,
          });
      }
    }

    await db.query(
      `
        INSERT INTO user_settings (
          user_id,
          autoplay,
          wifi_only,
          sound_effects,
          push_notifications,
          safe_mode,
          parental_controls
        )

        VALUES (
          ?, ?, ?, ?, ?, ?, ?
        )

        ON DUPLICATE KEY UPDATE

          autoplay =
            VALUES(autoplay),

          wifi_only =
            VALUES(wifi_only),

          sound_effects =
            VALUES(sound_effects),

          push_notifications =
            VALUES(push_notifications),

          safe_mode =
            VALUES(safe_mode),

          parental_controls =
            VALUES(parental_controls)
      `,
      [
        req.user.id,

        input.autoplay
          ? 1
          : 0,

        input.wifiOnly
          ? 1
          : 0,

        input.soundEffects
          ? 1
          : 0,

        input.pushNotifications
          ? 1
          : 0,

        input.safeMode
          ? 1
          : 0,

        input.parentalControls
          ? 1
          : 0,
      ]
    );

    return res.json({
      success: true,
      message:
        "Settings updated.",

      settings: {
        autoplay:
          input.autoplay,

        wifiOnly:
          input.wifiOnly,

        soundEffects:
          input.soundEffects,

        pushNotifications:
          input.pushNotifications,

        safeMode:
          input.safeMode,

        parentalControls:
          input.parentalControls,
      },
    });

  } catch (error) {

    console.error(
      "UPDATE SETTINGS ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to update settings.",
      });
  }
}

module.exports = {
  getProfile,
  updateProfile,
  getSettings,
  updateSettings,
};

// KIDSOTT_LIBRARY_VISIBILITY_V1
﻿const db =
  require("../config/db");

function toId(value) {
  const id =
    Number(value);

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return null;
  }

  return id;
}

function toFiniteNumber(
  value,
  fallback = 0,
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return fallback;
  }

  return Math.max(
    number,
    0
  );
}

async function videoExists(
  connection,
  videoId,
) {
  const [rows] =
    await connection.query(
      `
        SELECT v.id
   FROM videos v
   INNER JOIN categories c
     ON c.id = v.category_id
   WHERE v.id = ?
     AND v.status = 'published'
     AND v.is_active = 1
     AND c.is_active = 1
        LIMIT 1
      `,
      [videoId]
    );

  return rows.length > 0;
}

async function fetchFavorites(
  connection,
  userId,
) {
  const [rows] =
    await connection.query(
      `
        SELECT
          v.id AS videoId,
          v.title,
          c.name AS category,
          v.thumbnail_url AS image,
          f.created_at AS createdAt

        FROM favorites f

        INNER JOIN videos v
          ON v.id =
            f.video_id

        INNER JOIN categories c
          ON c.id =
            v.category_id

        WHERE f.user_id = ?
     AND v.status = 'published'
     AND v.is_active = 1
     AND c.is_active = 1

        ORDER BY
          f.created_at DESC
      `,
      [userId]
    );

  return rows.map(
    row => ({
      videoId:
        Number(row.videoId),

      title:
        row.title,

      category:
        row.category,

      image:
        row.image,

      createdAt:
        row.createdAt,
    })
  );
}

async function fetchHistory(
  connection,
  userId,
) {
  const [rows] =
    await connection.query(
      `
        SELECT
          h.video_id AS videoId,
          v.title,
          c.name AS category,
          v.thumbnail_url AS image,

          h.position_seconds AS currentTime,
          h.duration,
          h.completed,
          h.last_watched_at AS lastWatchedAt

        FROM watch_history h

        INNER JOIN videos v
          ON v.id =
            h.video_id

        INNER JOIN categories c
          ON c.id =
            v.category_id

        WHERE h.user_id = ?
     AND v.status = 'published'
     AND v.is_active = 1
     AND c.is_active = 1

        ORDER BY
          h.last_watched_at DESC
      `,
      [userId]
    );

  return rows.map(
    row => ({
      videoId:
        Number(row.videoId),

      title:
        row.title,

      category:
        row.category,

      image:
        row.image,

      currentTime:
        Number(
          row.currentTime ||
          0
        ),

      duration:
        Number(
          row.duration ||
          0
        ),

      lastWatchedAt:
        Number(
          row.lastWatchedAt ||
          0
        ),

      completed:
        Boolean(
          row.completed
        ),
    })
  );
}

async function upsertHistory(
  connection,
  userId,
  record,
) {
  const videoId =
    toId(
      record.videoId
    );

  if (!videoId) {
    return;
  }

  const exists =
    await videoExists(
      connection,
      videoId
    );

  if (!exists) {
    return;
  }

  const currentTime =
    toFiniteNumber(
      record.currentTime
    );

  const duration =
    toFiniteNumber(
      record.duration
    );

  const completed =
    record.completed
      ? 1
      : 0;

  const lastWatchedAt =
    Math.max(
      Math.floor(
        toFiniteNumber(
          record.lastWatchedAt,
          Date.now()
        )
      ),
      1
    );

  await connection.query(
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
          IF(
            VALUES(last_watched_at) >=
              last_watched_at,

            VALUES(position_seconds),

            position_seconds
          ),

        duration =
          IF(
            VALUES(last_watched_at) >=
              last_watched_at,

            VALUES(duration),

            duration
          ),

        completed =
          IF(
            VALUES(last_watched_at) >=
              last_watched_at,

            VALUES(completed),

            completed
          ),

        last_watched_at =
          GREATEST(
            last_watched_at,
            VALUES(last_watched_at)
          )
    `,
    [
      userId,
      videoId,
      currentTime,
      duration,
      completed,
      lastWatchedAt,
    ]
  );
}

async function getFavorites(
  req,
  res
) {
  try {
    const favorites =
      await fetchFavorites(
        db,
        req.user.id
      );

    return res.json({
      success: true,
      favorites,
    });
  } catch (error) {
    console.error(
      "GET FAVORITES ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load favorites.",
    });
  }
}

async function addFavorite(
  req,
  res
) {
  try {
    const videoId =
      toId(
        req.params.videoId
      );

    if (!videoId) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid video id.",
      });
    }

    const exists =
      await videoExists(
        db,
        videoId
      );

    if (!exists) {
      return res.status(404).json({
        success: false,
        message:
          "Video not found.",
      });
    }

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
        req.user.id,
        videoId,
      ]
    );

    return res.json({
      success: true,
      message:
        "Video added to favorites.",
      videoId,
    });
  } catch (error) {
    console.error(
      "ADD FAVORITE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to add favorite.",
    });
  }
}

async function removeFavorite(
  req,
  res
) {
  try {
    const videoId =
      toId(
        req.params.videoId
      );

    if (!videoId) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid video id.",
      });
    }

    await db.query(
      `
        DELETE FROM favorites
        WHERE
          user_id = ?
          AND video_id = ?
      `,
      [
        req.user.id,
        videoId,
      ]
    );

    return res.json({
      success: true,
      message:
        "Video removed from favorites.",
      videoId,
    });
  } catch (error) {
    console.error(
      "REMOVE FAVORITE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to remove favorite.",
    });
  }
}

async function getHistory(
  req,
  res
) {
  try {
    const history =
      await fetchHistory(
        db,
        req.user.id
      );

    return res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error(
      "GET HISTORY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load watch history.",
    });
  }
}

async function saveHistory(
  req,
  res
) {
  try {
    const videoId =
      toId(
        req.params.videoId
      );

    if (!videoId) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid video id.",
      });
    }

    const exists =
      await videoExists(
        db,
        videoId
      );

    if (!exists) {
      return res.status(404).json({
        success: false,
        message:
          "Video not found.",
      });
    }

    await upsertHistory(
      db,
      req.user.id,
      {
        videoId,

        currentTime:
          req.body.currentTime,

        duration:
          req.body.duration,

        completed:
          req.body.completed,

        lastWatchedAt:
          req.body.lastWatchedAt ||
          Date.now(),
      }
    );

    return res.json({
      success: true,
      message:
        "Watch progress saved.",
      videoId,
    });
  } catch (error) {
    console.error(
      "SAVE HISTORY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to save watch progress.",
    });
  }
}

async function removeHistory(
  req,
  res
) {
  try {
    const videoId =
      toId(
        req.params.videoId
      );

    if (!videoId) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid video id.",
      });
    }

    await db.query(
      `
        DELETE FROM watch_history
        WHERE
          user_id = ?
          AND video_id = ?
      `,
      [
        req.user.id,
        videoId,
      ]
    );

    return res.json({
      success: true,
      message:
        "History item removed.",
      videoId,
    });
  } catch (error) {
    console.error(
      "REMOVE HISTORY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to remove history item.",
    });
  }
}

async function clearHistory(
  req,
  res
) {
  try {
    await db.query(
      `
        DELETE FROM watch_history
        WHERE user_id = ?
      `,
      [
        req.user.id,
      ]
    );

    return res.json({
      success: true,
      message:
        "Watch history cleared.",
    });
  } catch (error) {
    console.error(
      "CLEAR HISTORY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to clear watch history.",
    });
  }
}

async function syncLibrary(
  req,
  res
) {
  const connection =
    await db.getConnection();

  try {
    const localFavorites =
      Array.isArray(
        req.body.favorites
      )
        ? req.body.favorites
        : [];

    const localHistory =
      Array.isArray(
        req.body.history
      )
        ? req.body.history
        : [];

    await connection.beginTransaction();

    for (
      const rawId
      of localFavorites
    ) {
      const videoId =
        toId(rawId);

      if (!videoId) {
        continue;
      }

      const exists =
        await videoExists(
          connection,
          videoId
        );

      if (!exists) {
        continue;
      }

      await connection.query(
        `
          INSERT IGNORE
          INTO favorites (
            user_id,
            video_id
          )
          VALUES (?, ?)
        `,
        [
          req.user.id,
          videoId,
        ]
      );
    }

    for (
      const record
      of localHistory
    ) {
      if (
        !record ||
        typeof record !==
          "object"
      ) {
        continue;
      }

      await upsertHistory(
        connection,
        req.user.id,
        record
      );
    }

    await connection.commit();

    const favorites =
      await fetchFavorites(
        connection,
        req.user.id
      );

    const history =
      await fetchHistory(
        connection,
        req.user.id
      );

    return res.json({
      success: true,

      favorites:
        favorites.map(
          item =>
            item.videoId
        ),

      history,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback error.
    }

    console.error(
      "LIBRARY SYNC ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to synchronize library.",
    });
  } finally {
    connection.release();
  }
}

module.exports = {
  getFavorites,
  addFavorite,
  removeFavorite,
  getHistory,
  saveHistory,
  removeHistory,
  clearHistory,
  syncLibrary,
};


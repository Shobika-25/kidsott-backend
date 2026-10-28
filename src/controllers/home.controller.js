

const pool = require("../config/db");

function safeLimit(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 10;
  }

  return Math.min(
    50,
    Math.max(
      1,
      Math.floor(parsed),
    ),
  );
}

function parseManualIds(value) {
  if (!value) {
    return [];
  }

  const text = String(value).trim();

  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) {
      return [
        ...new Set(
          parsed
            .map(Number)
            .filter(
              id =>
                Number.isInteger(id) &&
                id > 0,
            ),
        ),
      ];
    }
  }
  catch {
  }

  return [
    ...new Set(
      text
        .split(",")
        .map(item =>
          Number(
            item.trim(),
          ),
        )
        .filter(
          id =>
            Number.isInteger(id) &&
            id > 0,
        ),
    ),
  ];
}

async function getVideoIdsBySource(
  sourceType,
  sourceValue,
  itemLimit,
) {
  const limit =
    safeLimit(itemLimit);

  if (sourceType === "manual") {
    const requestedIds = parseManualIds(sourceValue);
    if (!requestedIds.length) return [];

    const placeholders = requestedIds.map(() => "?").join(", ");
    const [visibleRows] = await pool.query(
      `SELECT v.id
       FROM videos v
       INNER JOIN categories c ON c.id = v.category_id
       WHERE v.id IN (${placeholders})
         AND v.status = 'published'
         AND v.is_active = 1
         AND c.is_active = 1`,
      requestedIds,
    );

    const visibleIds = new Set(
      visibleRows.map(row => Number(row.id))
    );

    return requestedIds
      .filter(id => visibleIds.has(id))
      .slice(0, limit);
  }

  // KIDSOTT_HOME_VIDEO_VISIBILITY_V1

  let sql = "";
  let params = [];

  switch (sourceType) {

    case "featured": {
      sql = `
        SELECT v.id
        FROM videos v
        WHERE v.status = 'published'
          AND v.is_active = 1
          AND EXISTS (
            SELECT 1
            FROM categories c
            WHERE c.id = v.category_id
              AND c.is_active = 1
          )
          AND v.is_featured = 1
        ORDER BY
          v.updated_at DESC,
          v.id DESC
        LIMIT ?
      `;

      params = [limit];
      break;
    }

    case "all": {
      sql = `
        SELECT v.id
        FROM videos v
        WHERE v.status = 'published'
          AND v.is_active = 1
          AND EXISTS (
            SELECT 1
            FROM categories c
            WHERE c.id = v.category_id
              AND c.is_active = 1
          )
        ORDER BY
          v.updated_at DESC,
          v.id DESC
        LIMIT ?
      `;

      params = [limit];
      break;
    }

    case "recent": {
      sql = `
        SELECT v.id
        FROM videos v
        WHERE v.status = 'published'
          AND v.is_active = 1
          AND EXISTS (
            SELECT 1
            FROM categories c
            WHERE c.id = v.category_id
              AND c.is_active = 1
          )
        ORDER BY
          v.created_at DESC,
          v.id DESC
        LIMIT ?
      `;

      params = [limit];
      break;
    }

    case "trending": {
      sql = `
        SELECT
          v.id
        FROM videos v

        LEFT JOIN watch_history h
          ON h.video_id = v.id
         AND h.updated_at >= DATE_SUB(
           NOW(),
           INTERVAL 30 DAY
         )

        LEFT JOIN favorites f
          ON f.video_id = v.id

        WHERE v.status = 'published'
          AND v.is_active = 1
          AND EXISTS (
            SELECT 1
            FROM categories c
            WHERE c.id = v.category_id
              AND c.is_active = 1
          )

        GROUP BY
          v.id,
          v.is_featured,
          v.updated_at

        ORDER BY
          COUNT(
            DISTINCT h.user_id
          ) DESC,
          COUNT(
            DISTINCT f.user_id
          ) DESC,
          v.is_featured DESC,
          v.updated_at DESC,
          v.id DESC

        LIMIT ?
      `;

      params = [limit];
      break;
    }

    case "popular": {
      sql = `
        SELECT
          v.id
        FROM videos v

        LEFT JOIN watch_history h
          ON h.video_id = v.id

        LEFT JOIN favorites f
          ON f.video_id = v.id

        WHERE v.status = 'published'
          AND v.is_active = 1
          AND EXISTS (
            SELECT 1
            FROM categories c
            WHERE c.id = v.category_id
              AND c.is_active = 1
          )

        GROUP BY
          v.id,
          v.is_featured,
          v.updated_at

        ORDER BY
          COUNT(
            DISTINCT h.user_id
          ) DESC,
          COUNT(
            DISTINCT f.user_id
          ) DESC,
          v.is_featured DESC,
          v.id DESC

        LIMIT ?
      `;

      params = [limit];
      break;
    }

    case "favorites": {
      sql = `
        SELECT
          v.id
        FROM videos v

        LEFT JOIN favorites f
          ON f.video_id = v.id

        WHERE v.status = 'published'
          AND v.is_active = 1
          AND EXISTS (
            SELECT 1
            FROM categories c
            WHERE c.id = v.category_id
              AND c.is_active = 1
          )

        GROUP BY
          v.id,
          v.is_featured,
          v.updated_at

        ORDER BY
          COUNT(
            DISTINCT f.user_id
          ) DESC,
          v.is_featured DESC,
          v.updated_at DESC,
          v.id DESC

        LIMIT ?
      `;

      params = [limit];
      break;
    }

    case "recommended": {
      sql = `
        SELECT
          v.id
        FROM videos v

        LEFT JOIN watch_history h
          ON h.video_id = v.id

        LEFT JOIN favorites f
          ON f.video_id = v.id

        WHERE v.status = 'published'
          AND v.is_active = 1
          AND EXISTS (
            SELECT 1
            FROM categories c
            WHERE c.id = v.category_id
              AND c.is_active = 1
          )

        GROUP BY
          v.id,
          v.is_featured,
          v.updated_at

        ORDER BY
          v.is_featured DESC,
          COUNT(
            DISTINCT h.user_id
          ) DESC,
          COUNT(
            DISTINCT f.user_id
          ) DESC,
          v.updated_at DESC,
          v.id DESC

        LIMIT ?
      `;

      params = [limit];
      break;
    }

    default:
      return [];
  }

  const [rows] =
    await pool.query(
      sql,
      params,
    );

  return rows
    .map(row =>
      Number(row.id),
    )
    .filter(
      id =>
        Number.isInteger(id) &&
        id > 0,
    );
}

async function getHomeSections(
  req,
  res,
) {
  try {
    const [rows] =
      await pool.query(`
        SELECT
          id,
          section_key,
          title,
          layout,
          source_type,
          source_value,
          item_limit,
          sort_order,
          is_active
        FROM home_sections
        WHERE is_active = 1
          AND (start_at IS NULL OR start_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE))
          AND (end_at IS NULL OR end_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE))
        ORDER BY
          sort_order ASC,
          id ASC
      `);

    const sections = [];

    for (
      const row of rows
    ) {
      const sourceType =
        String(
          row.source_type || "",
        )
          .trim()
          .toLowerCase();

      const sourceValue =
        row.source_value == null
          ? ""
          : String(
              row.source_value,
            ).trim();

      const itemLimit =
        safeLimit(
          row.item_limit,
        );

      /*
       * Current React Native Home screen
       * already renders Continue Watching
       * from AppDataContext/watch history.
       *
       * Do not send it again as a normal
       * video row, otherwise it can become
       * a duplicate home section.
       */
      if (
        sourceType ===
        "continue_watching"
      ) {
        continue;
      }

      /*
       * Favorites are personalized for each authenticated user.
       * Return configuration only; do not select globally ranked
       * favorites as if they belonged to the current user.
       * Mobile Home resolves the user's own favorites.
       */
      if (sourceType === "favorites") {
        sections.push({
          id: Number(row.id),
          sectionKey: row.section_key,
          title: row.title,
          layout: row.layout === "portrait"
            ? "portrait"
            : "landscape",
          sourceType: "favorites",
          sourceValue: "",
          videoIds: [],
          itemLimit,
          sortOrder: Number(row.sort_order)
        });
        continue;
      }

      if (
        sourceType ===
        "category"
      ) {
        sections.push({
          id:
            Number(row.id),

          sectionKey:
            row.section_key,

          title:
            row.title,

          layout:
            row.layout ===
            "portrait"
              ? "portrait"
              : "landscape",

          sourceType:
            "category",

          sourceValue,

          videoIds: [],

          itemLimit,

          sortOrder:
            Number(
              row.sort_order,
            ),
        });

        continue;
      }

      const videoIds =
        await getVideoIdsBySource(
          sourceType,
          sourceValue,
          itemLimit,
        );

      sections.push({
        id:
          Number(row.id),

        sectionKey:
          row.section_key,

        title:
          row.title,

        layout:
          row.layout ===
          "portrait"
            ? "portrait"
            : "landscape",

        /*
         * React Native Home.tsx already
         * understands "manual".
         *
         * Backend resolves semantic
         * DB source types to video IDs.
         */
        sourceType:
          "manual",

        sourceValue:
          "",

        videoIds,

        itemLimit,

        sortOrder:
          Number(
            row.sort_order,
          ),

        resolvedSourceType:
          sourceType,
      });
    }

    return res.json({
      success: true,
      sections,
    });
  }
  catch (error) {
    console.error(
      "GET HOME SECTIONS ERROR:",
      error,
    );

    return res.status(
      500,
    ).json({
      success: false,
      message:
        "Unable to load home sections.",
    });
  }
}

module.exports = {
  getHomeSections,
};

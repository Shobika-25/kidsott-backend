// KIDSOTT_VIDEO_METADATA_WRITE_V1
// KIDSOTT_VIDEO_METADATA_READ_V1
const db =
  require("../config/db");

function makeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );
}

function parseTags(value) {
  if (
    Array.isArray(value)
  ) {
    return value
      .map(item =>
        String(item).trim()
      )
      .filter(Boolean);
  }

  return [];
}

function parseExtendedVideoFields(body, current = null) {
  const has = key =>
    Object.prototype.hasOwnProperty.call(body, key);

  function readText(key, column, limit) {
    const supplied = has(key);
    const raw = supplied
      ? body[key]
      : current
        ? current[column]
        : null;

    if (raw === null || raw === undefined || raw === "") {
      return { value: null };
    }

    if (typeof raw !== "string") {
      return { error: key + " must be text." };
    }

    const value = raw.trim();

    if (value.length > limit || /[\x00-\x1f\x7f]/.test(value)) {
      return { error: key + " has invalid characters or length." };
    }

    return { value: value || null };
  }

  const type = readText("contentType", "content_type", 20);
  const language = readText("language", "language", 50);
  const landscape = readText(
    "landscapeThumbnailUrl",
    "landscape_thumbnail_url",
    2048
  );
  const portrait = readText(
    "portraitThumbnailUrl",
    "portrait_thumbnail_url",
    2048
  );

  for (const field of [type, language, landscape, portrait]) {
    if (field.error) return { error: field.error };
  }

  if (
    type.value !== null &&
    !["Movie", "Episode", "Short"].includes(type.value)
  ) {
    return { error: "Content type must be Movie, Episode or Short." };
  }

  // KIDSOTT_LOCAL_THUMBNAIL_URL_V1
  // Local generated image URLs are allowed for development only.
  // External artwork still requires HTTPS.
  function isLocalUploadedImageUrl(raw) {
    if (process.env.NODE_ENV === "production") {
      return false;
    }

    const dbHost = String(process.env.DB_HOST || "")
      .trim()
      .toLowerCase();

    if (!["localhost", "127.0.0.1", "::1"].includes(dbHost)) {
      return false;
    }

    const port = String(process.env.PORT || "5000");

    if (
      !/^[0-9]{1,5}$/.test(port) ||
      Number(port) < 1 ||
      Number(port) > 65535
    ) {
      return false;
    }

    try {
      const url = new URL(raw);

      const allowedOrigins = new Set([
        "http://127.0.0.1:" + port,
        "http://localhost:" + port,
        "http://[::1]:" + port
      ]);

      if (
        !allowedOrigins.has(url.origin) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        return false;
      }

      return /^\/api\/media\/files\/images\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i
        .test(url.pathname);
    } catch {
      return false;
    }
  }

  for (const [name, key, field] of [
    ["Landscape thumbnail", "landscapeThumbnailUrl", landscape],
    ["Portrait thumbnail", "portraitThumbnailUrl", portrait]
  ]) {
    // Existing values are retained when the field is omitted.
    if (field.value === null || !has(key)) {
      continue;
    }

    // KIDSOTT_STEP07G15O_HISTORICAL_COMPAT
    const previousColumn = key === "landscapeThumbnailUrl"
      ? "landscape_thumbnail_url"
      : "portrait_thumbnail_url";

    const previousValue = current?.[previousColumn];

    if (
      typeof previousValue === "string" &&
      previousValue.trim() === field.value
    ) {
      continue;
    }

    let url;

    try {
      url = new URL(field.value);
    } catch {
      return {
        error: name + " must be a valid HTTPS URL or local uploaded image."
      };
    }

    const validHttps =
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password;

    if (!validHttps && !isLocalUploadedImageUrl(field.value)) {
      return {
        error: name + " must be a valid HTTPS URL or local uploaded image."
      };
    }
  }

  const activeRaw = has("isActive")
    ? body.isActive
    : current
      ? current.is_active
      : 1;

  let isActive;

  if (activeRaw === true || activeRaw === 1) {
    isActive = 1;
  } else if (activeRaw === false || activeRaw === 0) {
    isActive = 0;
  } else {
    return { error: "isActive must be a boolean." };
  }

  return {
    values: {
      contentType: type.value,
      language: language.value,
      isActive,
      landscapeThumbnailUrl: landscape.value,
      portraitThumbnailUrl: portrait.value
    }
  };
}

function normalizeVideo(row) {
  let tags = [];

  if (
    Array.isArray(row.tags)
  ) {
    tags = row.tags;
  } else if (
    typeof row.tags === "string"
  ) {
    try {
      tags =
        JSON.parse(
          row.tags
        );
    } catch {
      tags = [];
    }
  }

  return {
    id: Number(row.id),
    title: row.title,
    slug: row.slug,
    description:
      row.description,
    categoryId:
      Number(
        row.categoryId
      ),
    category:
      row.category,
    categorySlug:
      row.categorySlug,
    thumbnailUrl:
  row.thumbnailUrl,

landscapeThumbnailUrl:
  row.landscapeThumbnailUrl,

portraitThumbnailUrl:
  row.portraitThumbnailUrl,

videoUrl:
  row.videoUrl,
    durationSeconds:
      Number(
        row.durationSeconds ||
        0
      ),
    durationLabel:
      row.durationLabel,
    releaseYear:
      row.releaseYear
        ? Number(
            row.releaseYear
          )
        : null,
    ageRating:
      row.ageRating,
    rating: row.rating == null ? null : Number(row.rating),
    tags,
    status: row.status,
    contentType: row.contentType ?? null,
    language: row.language ?? null,
    isActive: Number(row.isActive) === 1,
    isFeatured:
      Boolean(
        row.isFeatured
      ),
    sortOrder:
      Number(
        row.sortOrder ||
        0
      ),
    createdAt:
      row.createdAt,
    updatedAt:
      row.updatedAt,
  };
}

const videoSelect = `
  SELECT
    v.id,
    v.title,
    v.slug,
    v.description,

    v.category_id
      AS categoryId,

    c.name
      AS category,

    c.slug
      AS categorySlug,

    v.thumbnail_url
  AS thumbnailUrl,

v.landscape_thumbnail_url
  AS landscapeThumbnailUrl,

v.portrait_thumbnail_url
  AS portraitThumbnailUrl,

v.video_url
  AS videoUrl,

    v.duration_seconds
      AS durationSeconds,

    v.duration_label
      AS durationLabel,

    v.release_year
      AS releaseYear,
    v.rating AS rating,

    v.age_rating
      AS ageRating,

    v.tags,

    v.content_type AS contentType,
    v.language AS language,
    v.is_active AS isActive,
    v.status,

    v.is_featured
      AS isFeatured,

    v.sort_order
      AS sortOrder,

    v.created_at
      AS createdAt,

    v.updated_at
      AS updatedAt

  FROM videos v

  INNER JOIN categories c
    ON c.id = v.category_id
`;

async function getVideos(
  req,
  res
) {
  try {
    const page =
      Math.max(
        Number(
          req.query.page || 1
        ),
        1
      );

    const limit =
      Math.min(
        Math.max(
          Number(
            req.query.limit || 20
          ),
          1
        ),
        100
      );

    const offset =
      (page - 1) * limit;

    const category =
      String(
        req.query.category ||
        ""
      ).trim();

    const search =
      String(
        req.query.search ||
        ""
      ).trim();

    const featured =
      String(
        req.query.featured ||
        ""
      ).trim();

    const conditions = [
      "v.status = 'published'",
      "v.is_active = 1",
      "c.is_active = 1",
    ];

    const params = [];

    if (category) {
      conditions.push(
        "c.slug = ?"
      );

      params.push(category);
    }

    if (search) {
      conditions.push(
        `(
          v.title LIKE ?
          OR v.description LIKE ?
        )`
      );

      params.push(
        `%${search}%`,
        `%${search}%`
      );
    }

    if (
      featured === "1" ||
      featured === "true"
    ) {
      conditions.push(
        "v.is_featured = 1"
      );
    }

    const where =
      conditions.join(
        " AND "
      );

    const [countRows] =
      await db.query(
        `
          SELECT
            COUNT(*) AS total

          FROM videos v

          INNER JOIN categories c
            ON c.id =
              v.category_id

          WHERE ${where}
        `,
        params
      );

    const [rows] =
      await db.query(
        `
          ${videoSelect}

          WHERE ${where}

          ORDER BY
            v.is_featured DESC,
            v.sort_order ASC,
            v.created_at DESC

          LIMIT ?
          OFFSET ?
        `,
        [
          ...params,
          limit,
          offset,
        ]
      );

    const total =
      Number(
        countRows[0].total
      );

    return res.json({
      success: true,

      videos:
        rows.map(
          normalizeVideo
        ),

      pagination: {
        page,
        limit,
        total,

        totalPages:
          Math.ceil(
            total / limit
          ),
      },
    });
  } catch (error) {
    console.error(
      "GET VIDEOS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load videos.",
    });
  }
}

async function getVideoById(
  req,
  res
) {
  try {
    const id =
      Number(req.params.id);

    const [rows] =
      await db.query(
        `
          ${videoSelect}

          WHERE
            v.id = ?
            AND
            v.status = 'published'
            AND
            v.is_active = 1
            AND
            c.is_active = 1

          LIMIT 1
        `,
        [id]
      );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message:
          "Video not found.",
      });
    }

    return res.json({
      success: true,
      video:
        normalizeVideo(
          rows[0]
        ),
    });
  } catch (error) {
    console.error(
      "GET VIDEO ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load video.",
    });
  }
}

async function getAdminVideos(
  req,
  res
) {
  try {
    const [rows] =
      await db.query(`
        ${videoSelect}

        ORDER BY
          v.created_at DESC
      `);

    return res.json({
      success: true,
      videos:
        rows.map(
          normalizeVideo
        ),
    });
  } catch (error) {
    console.error(
      "ADMIN VIDEOS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load admin videos.",
    });
  }
}

// KIDSOTT_STEP07G9_HOSTED_MEDIA_URL_GUARD_V1
// Refuse NEW localhost media values when saving into a hosted catalog.
// Local MySQL and pre-existing records remain unchanged.
function rejectsHostedLoopbackMediaInput(body, current = null) {
  const dbHost = String(process.env.DB_HOST || "").trim().toLowerCase();
  const localDatabase = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(dbHost);
  const hostedDatabase = process.env.NODE_ENV === "production" || (Boolean(dbHost) && !localDatabase);
  if (!hostedDatabase || !body || typeof body !== "object") return false;
  const keys = ["thumbnailUrl", "videoUrl", "landscapeThumbnailUrl", "portraitThumbnailUrl",
    "landscape_thumbnail_url", "portrait_thumbnail_url"];
  const historicalColumns = {
    thumbnailUrl: "thumbnail_url",
    videoUrl: "video_url",
    landscapeThumbnailUrl: "landscape_thumbnail_url",
    portraitThumbnailUrl: "portrait_thumbnail_url",
    landscape_thumbnail_url: "landscape_thumbnail_url",
    portrait_thumbnail_url: "portrait_thumbnail_url",
  };

  return keys.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(body, key) || typeof body[key] !== "string") return false;
    const previousValue = current?.[historicalColumns[key]];

    if (
      typeof previousValue === "string" &&
      previousValue.trim() === body[key].trim()
    ) {
      return false;
    }

    try {
      const url = new URL(body[key].trim());
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      return hostname === "localhost" || hostname === "localhost." || hostname === "::1" ||
        hostname === "0.0.0.0" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname);
    } catch { return false; }
  });
}
async function createVideo(
  req,
  res
) {
  try {
    const title =
      String(
        req.body.title || ""
      ).trim();

    const categoryId =
      Number(
        req.body.categoryId
      );

    if (
      !title ||
      !categoryId
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Title and category are required.",
      });
    }

    const slug =
      makeSlug(
        req.body.slug ||
        `${title}-${Date.now()}`
      );

    const description =
      String(
        req.body.description ||
        ""
      ).trim();

    const thumbnailUrl =
      String(
        req.body.thumbnailUrl ||
        ""
      ).trim();

    const videoUrl =
      String(
        req.body.videoUrl ||
        ""
      ).trim();

    const durationSeconds =
      Math.max(
        Number(
          req.body.durationSeconds ||
          0
        ),
        0
      );

    const durationLabel =
      String(
        req.body.durationLabel ||
        ""
      ).trim();

    const releaseYear =
      req.body.releaseYear
        ? Number(
            req.body.releaseYear
          )
        : null;

    const ageRating =
      String(
        req.body.ageRating ||
        ""
      ).trim();

    const tags =
      parseTags(
        req.body.tags
      );

    const status =
      req.body.status ===
      "published"
        ? "published"
        : "draft";

    const isFeatured =
      req.body.isFeatured
        ? 1
        : 0;

    const sortOrder =
      Number(
        req.body.sortOrder ||
        0
      );

    const parsedMetadata = parseExtendedVideoFields(req.body);

    if (parsedMetadata.error) {

      return res.status(400).json({

        success: false,

        message: parsedMetadata.error

      });

    }

    const extended = parsedMetadata.values;
    // KIDSOTT_STEP07G9_HOSTED_MEDIA_URL_WRITE_CHECK
    if (rejectsHostedLoopbackMediaInput(req.body)) {
      return res.status(400).json({
        success: false,
        message: "Localhost media URLs cannot be saved to the hosted KidsOTT catalog. Use verified HTTPS media URLs.",
      });
    }

    const [categories] =
      await db.query(
        `
          SELECT id
          FROM categories
          WHERE id = ?
          LIMIT 1
        `,
        [categoryId]
      );

    if (!categories.length) {
      return res.status(400).json({
        success: false,
        message:
          "Selected category does not exist.",
      });
    }

    const [result] =
      await db.query(
        `
          INSERT INTO videos (
            title,
            slug,
            description,
            category_id,
            thumbnail_url,
            video_url,
            duration_seconds,
            duration_label,
            release_year,
            age_rating,
            tags,
            status,
            is_featured,
            sort_order,
            created_by,
            content_type,
            language,
            is_active,
            landscape_thumbnail_url,
            portrait_thumbnail_url
          )
          VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?
          )
        `,
        [
          title,
          slug,
          description || null,
          categoryId,
          thumbnailUrl || null,
          videoUrl || null,
          durationSeconds,
          durationLabel || null,
          releaseYear,
          ageRating || null,
          JSON.stringify(tags),
          status,
          isFeatured,
          sortOrder,
          req.user.id,
          extended.contentType,
          extended.language,
          extended.isActive,
          extended.landscapeThumbnailUrl,
          extended.portraitThumbnailUrl,
        ]
      );

    return res.status(201).json({
      success: true,
      message:
        "Video created successfully.",

      videoId:
        Number(
          result.insertId
        ),
    });
  } catch (error) {
    if (
      error.code ===
      "ER_DUP_ENTRY"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Video slug already exists.",
      });
    }

    console.error(
      "CREATE VIDEO ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to create video.",
    });
  }
}

async function updateVideo(
  req,
  res
) {
  try {
    const id =
      Number(req.params.id);

    const [rows] =
      await db.query(
        `
          SELECT *
          FROM videos
          WHERE id = ?
          LIMIT 1
        `,
        [id]
      );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message:
          "Video not found.",
      });
    }

    const current =
      rows[0];
    const parsedMetadata = parseExtendedVideoFields(req.body, current);
    if (parsedMetadata.error) {
      return res.status(400).json({
        success: false, message: parsedMetadata.error
      });
    }
    const extended = parsedMetadata.values;
    // KIDSOTT_STEP07G9_HOSTED_MEDIA_URL_WRITE_CHECK
    if (rejectsHostedLoopbackMediaInput(req.body, current)) {
      return res.status(400).json({
        success: false,
        message: "Localhost media URLs cannot be saved to the hosted KidsOTT catalog. Use verified HTTPS media URLs.",
      });
    }

    const title =
      req.body.title !==
      undefined
        ? String(
            req.body.title
          ).trim()
        : current.title;

    const slug =
      req.body.slug !==
      undefined
        ? makeSlug(
            req.body.slug
          )
        : current.slug;

    const categoryId =
      req.body.categoryId !==
      undefined
        ? Number(
            req.body.categoryId
          )
        : current.category_id;

    const description =
      req.body.description !==
      undefined
        ? String(
            req.body.description
          ).trim()
        : current.description;

    const thumbnailUrl =
      req.body.thumbnailUrl !==
      undefined
        ? String(
            req.body.thumbnailUrl
          ).trim()
        : current.thumbnail_url;

    const videoUrl =
      req.body.videoUrl !==
      undefined
        ? String(
            req.body.videoUrl
          ).trim()
        : current.video_url;

    const durationSeconds =
      req.body.durationSeconds !==
      undefined
        ? Math.max(
            Number(
              req.body.durationSeconds
            ),
            0
          )
        : current.duration_seconds;

    const durationLabel =
      req.body.durationLabel !==
      undefined
        ? String(
            req.body.durationLabel
          ).trim()
        : current.duration_label;

    const releaseYear =
      req.body.releaseYear !==
      undefined
        ? (
            req.body.releaseYear
              ? Number(
                  req.body.releaseYear
                )
              : null
          )
        : current.release_year;

    const ageRating =
      req.body.ageRating !==
      undefined
        ? String(
            req.body.ageRating
          ).trim()
        : current.age_rating;

    const tags =
      req.body.tags !==
      undefined
        ? parseTags(
            req.body.tags
          )
        : (
            typeof current.tags ===
            "string"
              ? JSON.parse(
                  current.tags
                )
              : current.tags
          );

    const status =
      req.body.status !==
      undefined
        ? (
            req.body.status ===
            "published"
              ? "published"
              : "draft"
          )
        : current.status;

    const isFeatured =
      req.body.isFeatured !==
      undefined
        ? (
            req.body.isFeatured
              ? 1
              : 0
          )
        : current.is_featured;

    const sortOrder =
      req.body.sortOrder !==
      undefined
        ? Number(
            req.body.sortOrder
          )
        : current.sort_order;

    await db.query(
      `
        UPDATE videos
        SET
          title = ?,
          slug = ?,
          description = ?,
          category_id = ?,
          thumbnail_url = ?,
          video_url = ?,
          duration_seconds = ?,
          duration_label = ?,
          release_year = ?,
          age_rating = ?,
          tags = ?,
          status = ?,
          is_featured = ?,
          sort_order = ?,
          content_type = ?,
          language = ?,
          is_active = ?,
          landscape_thumbnail_url = ?,
          portrait_thumbnail_url = ?
        WHERE id = ?
      `,
      [
        title,
        slug,
        description || null,
        categoryId,
        thumbnailUrl || null,
        videoUrl || null,
        durationSeconds,
        durationLabel || null,
        releaseYear,
        ageRating || null,
        JSON.stringify(
          tags || []
        ),
        status,
        isFeatured,
        sortOrder,
        extended.contentType,
        extended.language,
        extended.isActive,
        extended.landscapeThumbnailUrl,
        extended.portraitThumbnailUrl,
        id,
      ]
    );

    return res.json({
      success: true,
      message:
        "Video updated successfully.",
    });
  } catch (error) {
    console.error(
      "UPDATE VIDEO ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to update video.",
    });
  }
}

async function deleteVideo(
  req,
  res
) {
  try {
    const id =
      Number(req.params.id);

    const [result] =
      await db.query(
        `
          DELETE FROM videos
          WHERE id = ?
        `,
        [id]
      );

    if (
      result.affectedRows === 0
    ) {
      return res.status(404).json({
        success: false,
        message:
          "Video not found.",
      });
    }

    return res.json({
      success: true,
      message:
        "Video deleted successfully.",
    });
  } catch (error) {
    console.error(
      "DELETE VIDEO ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to delete video.",
    });
  }
}

module.exports = {
  getVideos,
  getVideoById,
  getAdminVideos,
  createVideo,
  updateVideo,
  deleteVideo,
};

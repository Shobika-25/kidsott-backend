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
    status:
      row.status,
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
            created_by
          )
          VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?
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
          sort_order = ?
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

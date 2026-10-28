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

async function getCategories(
  req,
  res
) {
  try {
    const [rows] =
      await db.query(`
        SELECT
          id,
          name,
          slug,
          description,
          image_url AS imageUrl,
          is_active AS isActive,
          sort_order AS sortOrder,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM categories
        WHERE is_active = 1
        ORDER BY
          sort_order ASC,
          name ASC
      `);

    return res.json({
      success: true,
      categories:
        rows.map(row => ({
          ...row,
          isActive:
            Boolean(
              row.isActive
            ),
        })),
    });
  } catch (error) {
    console.error(
      "GET CATEGORIES ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load categories.",
    });
  }
}

async function getAdminCategories(
  req,
  res
) {
  try {
    const [rows] =
      await db.query(`
        SELECT
          c.id,
          c.name,
          c.slug,
          c.description,
          c.image_url AS imageUrl,
          c.is_active AS isActive,
          c.sort_order AS sortOrder,
          c.created_at AS createdAt,
          c.updated_at AS updatedAt,
          COUNT(v.id) AS videoCount
        FROM categories c

        LEFT JOIN videos v
          ON v.category_id = c.id

        GROUP BY c.id

        ORDER BY
          c.sort_order ASC,
          c.name ASC
      `);

    return res.json({
      success: true,
      categories:
        rows.map(row => ({
          ...row,
          isActive:
            Boolean(
              row.isActive
            ),
          videoCount:
            Number(
              row.videoCount
            ),
        })),
    });
  } catch (error) {
    console.error(
      "ADMIN CATEGORIES ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load categories.",
    });
  }
}

async function createCategory(
  req,
  res
) {
  try {
    const name =
      String(
        req.body.name || ""
      ).trim();

    const description =
      String(
        req.body.description ||
        ""
      ).trim();

    const imageUrl =
      String(
        req.body.imageUrl ||
        ""
      ).trim();

    const sortOrder =
      Number(
        req.body.sortOrder || 0
      );

    // KIDSOTT_CATEGORY_CREATE_STATUS_V1
    // Existing clients default to Active.
    // Explicit false saves Inactive directly.
    const requestedIsActive = req.body.isActive;

    if (
      requestedIsActive !== undefined &&
      typeof requestedIsActive !== "boolean"
    ) {
      return res.status(400).json({
        success: false,
        message: "Category isActive must be true or false.",
      });
    }

    const isActive = requestedIsActive === false ? 0 : 1;

    if (!name) {
      return res.status(400).json({
        success: false,
        message:
          "Category name is required.",
      });
    }

    const slug =
      makeSlug(
        req.body.slug || name
      );

    if (!slug) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid category slug.",
      });
    }

    const [result] =
      await db.query(
        `
          INSERT INTO categories (
            name,
            slug,
            description,
            image_url,
            is_active,
            sort_order
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          name,
          slug,
          description || null,
          imageUrl || null,
          isActive,
          sortOrder,
        ]
      );

    return res.status(201).json({
      success: true,
      message:
        "Category created successfully.",
      categoryId:
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
          "Category name or slug already exists.",
      });
    }

    console.error(
      "CREATE CATEGORY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to create category.",
    });
  }
}

async function updateCategory(
  req,
  res
) {
  try {
    const id =
      Number(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid category id.",
      });
    }

    const [existing] =
      await db.query(
        `
          SELECT *
          FROM categories
          WHERE id = ?
          LIMIT 1
        `,
        [id]
      );

    if (!existing.length) {
      return res.status(404).json({
        success: false,
        message:
          "Category not found.",
      });
    }

    const current =
      existing[0];

    const name =
      req.body.name !==
      undefined
        ? String(
            req.body.name
          ).trim()
        : current.name;

    const slug =
      req.body.slug !==
      undefined
        ? makeSlug(
            req.body.slug
          )
        : current.slug;

    const description =
      req.body.description !==
      undefined
        ? String(
            req.body.description
          ).trim()
        : current.description;

    const imageUrl =
      req.body.imageUrl !==
      undefined
        ? String(
            req.body.imageUrl
          ).trim()
        : current.image_url;

    const isActive =
      req.body.isActive !==
      undefined
        ? (
            req.body.isActive
              ? 1
              : 0
          )
        : current.is_active;

    const sortOrder =
      req.body.sortOrder !==
      undefined
        ? Number(
            req.body.sortOrder
          )
        : current.sort_order;

    await db.query(
      `
        UPDATE categories
        SET
          name = ?,
          slug = ?,
          description = ?,
          image_url = ?,
          is_active = ?,
          sort_order = ?
        WHERE id = ?
      `,
      [
        name,
        slug,
        description || null,
        imageUrl || null,
        isActive,
        sortOrder,
        id,
      ]
    );

    return res.json({
      success: true,
      message:
        "Category updated successfully.",
    });
  } catch (error) {
    if (
      error.code ===
      "ER_DUP_ENTRY"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Category name or slug already exists.",
      });
    }

    console.error(
      "UPDATE CATEGORY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to update category.",
    });
  }
}

async function deleteCategory(
  req,
  res
) {
  try {
    const id =
      Number(req.params.id);

    const [videos] =
      await db.query(
        `
          SELECT COUNT(*) AS total
          FROM videos
          WHERE category_id = ?
        `,
        [id]
      );

    if (
      Number(
        videos[0].total
      ) > 0
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Category contains videos. Move or delete those videos first.",
      });
    }

    const [result] =
      await db.query(
        `
          DELETE FROM categories
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
          "Category not found.",
      });
    }

    return res.json({
      success: true,
      message:
        "Category deleted successfully.",
    });
  } catch (error) {
    console.error(
      "DELETE CATEGORY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to delete category.",
    });
  }
}

module.exports = {
  getCategories,
  getAdminCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};

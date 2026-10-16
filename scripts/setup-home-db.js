const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config();

async function setup() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "kidsott_db",
  });

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS home_sections (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        section_key VARCHAR(120) NOT NULL UNIQUE,
        title VARCHAR(160) NOT NULL,
        layout VARCHAR(30) NOT NULL DEFAULT 'landscape',
        source_type VARCHAR(30) NOT NULL DEFAULT 'category',
        source_value VARCHAR(190) NULL,
        item_limit INT NOT NULL DEFAULT 10,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_home_sections_order (is_active, sort_order)
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS home_section_videos (
        section_id BIGINT UNSIGNED NOT NULL,
        video_id BIGINT UNSIGNED NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (section_id, video_id),
        CONSTRAINT fk_home_section_videos_section
          FOREIGN KEY (section_id)
          REFERENCES home_sections(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_home_section_videos_video
          FOREIGN KEY (video_id)
          REFERENCES videos(id)
          ON DELETE CASCADE,
        INDEX idx_home_section_video_order (section_id, sort_order)
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);

    const [countRows] = await db.query(
      "SELECT COUNT(*) AS total FROM home_sections"
    );

    if (Number(countRows[0].total) === 0) {
      const [categories] = await db.query(`
        SELECT
          name,
          sort_order
        FROM categories
        ORDER BY sort_order ASC, id ASC
      `);

      for (let index = 0; index < categories.length; index += 1) {
        const category = categories[index];

        const key =
          String(category.name)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");

        await db.execute(`
          INSERT INTO home_sections (
            section_key,
            title,
            layout,
            source_type,
            source_value,
            item_limit,
            sort_order,
            is_active
          )
          VALUES (?, ?, ?, 'category', ?, 10, ?, 1)
        `, [
          key || `category-${index + 1}`,
          String(category.name),
          index % 2 === 1 ? "portrait" : "landscape",
          String(category.name),
          Number(category.sort_order ?? index + 1),
        ]);
      }
    }

    const [sections] = await db.query(`
      SELECT
        id,
        section_key AS sectionKey,
        title,
        layout,
        source_type AS sourceType,
        source_value AS sourceValue,
        item_limit AS itemLimit,
        sort_order AS sortOrder,
        is_active AS isActive
      FROM home_sections
      ORDER BY sort_order ASC, id ASC
    `);

    console.log("");
    console.log("===== HOME DATABASE READY =====");
    console.log("Sections :", sections.length);
    console.table(sections);
  } finally {
    await db.end();
  }
}

setup().catch(error => {
  console.error("HOME DB SETUP ERROR:");
  console.error(error);
  process.exit(1);
});

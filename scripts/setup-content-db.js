const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config();

async function setupContentDatabase() {
  let connection;

  try {
    connection =
      await mysql.createConnection({
        host:
          process.env.DB_HOST ||
          "127.0.0.1",

        port: Number(
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

    console.log("");
    console.log(
      "===================================="
    );
    console.log(
      " CONTENT DATABASE SETUP"
    );
    console.log(
      "===================================="
    );

    await connection.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id BIGINT UNSIGNED
          NOT NULL AUTO_INCREMENT,

        name VARCHAR(100)
          NOT NULL,

        slug VARCHAR(120)
          NOT NULL,

        description VARCHAR(500)
          NULL,

        image_url TEXT
          NULL,

        is_active TINYINT(1)
          NOT NULL DEFAULT 1,

        sort_order INT
          NOT NULL DEFAULT 0,

        created_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP,

        updated_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),

        UNIQUE KEY
          uq_categories_name (name),

        UNIQUE KEY
          uq_categories_slug (slug),

        KEY
          idx_categories_active (
            is_active
          ),

        KEY
          idx_categories_sort (
            sort_order
          )
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);

    console.log(
      "categories table ready"
    );

    await connection.query(`
      CREATE TABLE IF NOT EXISTS videos (
        id BIGINT UNSIGNED
          NOT NULL AUTO_INCREMENT,

        title VARCHAR(200)
          NOT NULL,

        slug VARCHAR(220)
          NOT NULL,

        description TEXT
          NULL,

        category_id BIGINT UNSIGNED
          NOT NULL,

        thumbnail_url TEXT
          NULL,

        video_url TEXT
          NULL,

        duration_seconds INT
          NOT NULL DEFAULT 0,

        duration_label VARCHAR(30)
          NULL,

        release_year SMALLINT
          NULL,

        age_rating VARCHAR(30)
          NULL,

        tags JSON
          NULL,

        status ENUM(
          'draft',
          'published'
        )
          NOT NULL DEFAULT 'draft',

        is_featured TINYINT(1)
          NOT NULL DEFAULT 0,

        sort_order INT
          NOT NULL DEFAULT 0,

        created_by BIGINT UNSIGNED
          NULL,

        created_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP,

        updated_at TIMESTAMP
          NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),

        UNIQUE KEY
          uq_videos_slug (slug),

        KEY
          idx_videos_category (
            category_id
          ),

        KEY
          idx_videos_status (
            status
          ),

        KEY
          idx_videos_featured (
            is_featured
          ),

        CONSTRAINT
          fk_videos_category
        FOREIGN KEY (
          category_id
        )
        REFERENCES categories(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

        CONSTRAINT
          fk_videos_created_by
        FOREIGN KEY (
          created_by
        )
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);

    console.log(
      "videos table ready"
    );

    const seedCategories = [
      [
        "Cartoons",
        "cartoons",
        "Fun animated adventures",
        1
      ],
      [
        "Learning",
        "learning",
        "Educational videos for kids",
        2
      ],
      [
        "Stories",
        "stories",
        "Stories and imagination",
        3
      ],
      [
        "Science",
        "science",
        "Discover science and nature",
        4
      ],
      [
        "Rhymes",
        "rhymes",
        "Songs and nursery rhymes",
        5
      ],
      [
        "Animals",
        "animals",
        "Explore the animal world",
        6
      ]
    ];

    for (
      const [
        name,
        slug,
        description,
        sortOrder
      ] of seedCategories
    ) {
      await connection.query(
        `
          INSERT INTO categories (
            name,
            slug,
            description,
            is_active,
            sort_order
          )
          VALUES (?, ?, ?, 1, ?)

          ON DUPLICATE KEY UPDATE
            name =
              VALUES(name),

            description =
              VALUES(description),

            is_active = 1,

            sort_order =
              VALUES(sort_order)
        `,
        [
          name,
          slug,
          description,
          sortOrder
        ]
      );
    }

    console.log(
      "Default categories seeded"
    );

    const [categories] =
      await connection.query(`
        SELECT
          id,
          name,
          slug,
          is_active,
          sort_order
        FROM categories
        ORDER BY
          sort_order ASC,
          name ASC
      `);

    console.table(categories);

    console.log("");
    console.log(
      "===== CONTENT DATABASE READY ====="
    );
  } catch (error) {
    console.error(
      "CONTENT DATABASE SETUP FAILED:"
    );

    console.error(
      error.message
    );

    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

setupContentDatabase();

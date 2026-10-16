const mysql =
  require("mysql2/promise");

const dotenv =
  require("dotenv");

dotenv.config();

const db =
  mysql.createPool({
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

    waitForConnections:
      true,

    connectionLimit:
      5,

    queueLimit:
      0,
  });


async function getPublicHome(
  req,
  res
) {
  try {

    const [
      sectionRows,
    ] =
      await db.query(`
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
        ORDER BY
          sort_order ASC,
          id ASC
      `);


    let assignmentRows =
      [];


    try {

      const [
        rows,
      ] =
        await db.query(`
          SELECT
            section_id,
            video_id,
            sort_order
          FROM home_section_videos
          ORDER BY
            section_id ASC,
            sort_order ASC,
            video_id ASC
        `);


      assignmentRows =
        rows;

    } catch (assignmentError) {

      console.error(
        "HOME ASSIGNMENT LOAD ERROR:",
        assignmentError instanceof Error
          ? assignmentError.message
          : assignmentError
      );
    }


    const videoIdsBySection =
      new Map();


    for (
      const row of assignmentRows
    ) {

      const sectionId =
        Number(
          row.section_id
        );


      const videoId =
        Number(
          row.video_id
        );


      if (
        !Number.isFinite(
          sectionId
        ) ||
        !Number.isFinite(
          videoId
        )
      ) {
        continue;
      }


      const existing =
        videoIdsBySection.get(
          sectionId
        ) || [];


      existing.push(
        videoId
      );


      videoIdsBySection.set(
        sectionId,
        existing
      );
    }


    const sections =
      sectionRows.map(
        row => ({
          id:
            Number(row.id),

          key:
            String(
              row.section_key ||
              ""
            ),

          title:
            String(
              row.title ||
              ""
            ),

          layout:
            String(
              row.layout ||
              "landscape"
            ),

          sourceType:
            String(
              row.source_type ||
              "category"
            ),

          sourceValue:
            row.source_value === null ||
            row.source_value === undefined
              ? null
              : String(
                  row.source_value
                ),

          itemLimit:
            Math.max(
              1,
              Number(
                row.item_limit
              ) || 10
            ),

          sortOrder:
            Number(
              row.sort_order
            ) || 0,

          videoIds:
            videoIdsBySection.get(
              Number(row.id)
            ) || [],
        })
      );


    return res.json({
      success: true,
      sections,
    });

  } catch (error) {

    console.error(
      "HOME PUBLIC GET ERROR:"
    );

    console.error(
      error instanceof Error
        ? error.stack ||
          error.message
        : error
    );


    return res.status(500).json({
      success: false,
      message:
        "Unable to load Home configuration.",
    });
  }
}


module.exports = {
  getPublicHome,
};

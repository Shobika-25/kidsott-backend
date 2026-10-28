const db = require("../config/db");
// KIDSOTT_HOME_PUBLIC_VISIBILITY_V1


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
          AND (start_at IS NULL OR start_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE))
          AND (end_at IS NULL OR end_at > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE))
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
      hsv.section_id,
      hsv.video_id,
      hsv.sort_order
    FROM home_section_videos hsv
    INNER JOIN videos v
      ON v.id = hsv.video_id
    INNER JOIN categories c
      ON c.id = v.category_id
    WHERE v.status = 'published'
      AND v.is_active = 1
      AND c.is_active = 1
    ORDER BY
      hsv.section_id ASC,
      hsv.sort_order ASC,
      hsv.video_id ASC
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
    String(row.source_type || "").trim().toLowerCase() === "manual"
      ? (videoIdsBySection.get(Number(row.id)) || []).join(",")
      : row.source_value == null
        ? null
        : String(row.source_value),

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

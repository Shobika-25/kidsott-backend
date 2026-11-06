'use strict';

const db = require('../config/db');

const MAX_UINT64 = 18446744073709551615n;

function parseVideoId(raw) {
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,19}$/.test(raw)) return null;
  try {
    const n = BigInt(raw);
    return n > 0n && n <= MAX_UINT64 ? String(n) : null;
  } catch {
    return null;
  }
}

async function findPublicVideo(id) {
  const [rows] = await db.query(
    `SELECT v.id, v.rating AS catalogRating
       FROM videos v
       INNER JOIN categories c ON c.id = v.category_id
      WHERE v.id = ?
        AND v.status = 'published'
        AND v.is_active = 1
        AND c.is_active = 1
      LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function getAggregate(videoId) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS ratingCount,
            ROUND(AVG(rating), 1) AS communityRating
       FROM video_ratings
      WHERE video_id = ?`,
    [videoId],
  );
  const row = rows[0] || {};
  return {
    ratingCount: Number(row.ratingCount || 0),
    communityRating:
      row.communityRating === null || row.communityRating === undefined
        ? null
        : Number(row.communityRating),
  };
}

function invalidId(res) {
  return res.status(400).json({ success: false, message: 'Invalid video ID.' });
}

function missingVideo(res) {
  return res.status(404).json({ success: false, message: 'Video not available.' });
}

async function getVideoRatingSummary(req, res) {
  const videoId = parseVideoId(req.params.id);
  if (!videoId) return invalidId(res);
  try {
    const video = await findPublicVideo(videoId);
    if (!video) return missingVideo(res);
    const stats = await getAggregate(videoId);
    return res.status(200).json({
      success: true,
      videoId: Number(video.id),
      catalogRating: video.catalogRating == null ? null : Number(video.catalogRating),
      ...stats,
    });
  } catch (error) {
    console.error('GET VIDEO RATING SUMMARY ERROR:', error);
    return res.status(500).json({ success: false, message: 'Unable to load video ratings.' });
  }
}

async function getMyVideoRating(req, res) {
  const videoId = parseVideoId(req.params.id);
  if (!videoId) return invalidId(res);
  try {
    const video = await findPublicVideo(videoId);
    if (!video) return missingVideo(res);
    const [rows] = await db.query(
      'SELECT rating FROM video_ratings WHERE user_id = ? AND video_id = ? LIMIT 1',
      [req.user.id, videoId],
    );
    return res.status(200).json({
      success: true,
      videoId: Number(video.id),
      myRating: rows.length ? Number(rows[0].rating) : null,
    });
  } catch (error) {
    console.error('GET MY VIDEO RATING ERROR:', error);
    return res.status(500).json({ success: false, message: 'Unable to load your rating.' });
  }
}

async function upsertMyVideoRating(req, res) {
  const videoId = parseVideoId(req.params.id);
  if (!videoId) return invalidId(res);
  const rating = req.body && req.body.rating;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, message: 'Rating must be an integer from 1 to 5.' });
  }
  try {
    const video = await findPublicVideo(videoId);
    if (!video) return missingVideo(res);
    await db.query(
      `INSERT INTO video_ratings (user_id, video_id, rating)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = ?, updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, videoId, rating, rating],
    );
    const stats = await getAggregate(videoId);
    return res.status(200).json({
      success: true,
      videoId: Number(video.id),
      myRating: rating,
      catalogRating: video.catalogRating == null ? null : Number(video.catalogRating),
      ...stats,
    });
  } catch (error) {
    console.error('SAVE VIDEO RATING ERROR:', error);
    return res.status(500).json({ success: false, message: 'Unable to save your rating.' });
  }
}

module.exports = {
  getVideoRatingSummary,
  getMyVideoRating,
  upsertMyVideoRating,
};
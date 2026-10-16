const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config();

const sslCaBase64 = (
  process.env.DB_SSL_CA_BASE64 || ""
).trim();

const sslOptions = sslCaBase64
  ? {
      ca: Buffer.from(sslCaBase64, "base64").toString("utf8"),
      rejectUnauthorized: true,
    }
  : undefined;

if (
  sslOptions &&
  !sslOptions.ca.includes("-----BEGIN CERTIFICATE-----")
) {
  throw new Error("Invalid DB_SSL_CA_BASE64 certificate");
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  ...(sslOptions ? { ssl: sslOptions } : {}),

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

module.exports = pool;

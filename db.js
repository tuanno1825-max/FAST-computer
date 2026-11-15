process.env.TZ = 'Asia/Ho_Chi_Minh';
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ Lỗi: Chưa cấu hình DATABASE_URL trong file .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  options: '-c timezone=Asia/Ho_Chi_Minh',
});

module.exports = pool;

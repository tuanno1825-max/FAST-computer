require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db');

async function initDatabase() {
  try {
    const sqlPath = path.join(__dirname, '..', 'database.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('⏳ Đang chạy database.sql lên PostgreSQL...');
    await pool.query(sql);
    console.log('✅ Khởi tạo 11 bảng và dữ liệu mẫu thành công!');
  } catch (err) {
    console.error('❌ Lỗi khi khởi tạo database:', err.message);
  } finally {
    await pool.end();
  }
}

initDatabase();

/**
 * Publish Store 数据库迁移模块
 *
 * 职责：
 * - SQLite 数据库初始化
 * - 从 JSON 文件迁移到 SQLite
 * - 数据库连接管理
 */

const Database = require('better-sqlite3');
const fs = require('fs');

/**
 * 创建发布任务数据库
 * @param {string} publishJobsPath - 发布任务 JSON 文件路径
 * @param {function} readJsonIfExists - 读取 JSON 文件的函数
 * @returns {object} { db, migrate }
 */
function createPublishDatabase(publishJobsPath, readJsonIfExists) {
  const dbPath = publishJobsPath.replace('.json', '.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // 创建表结构
  db.exec(`
    CREATE TABLE IF NOT EXISTS publish_jobs_v1 (
      id TEXT PRIMARY KEY,
      data JSON,
      updatedAt TEXT,
      archiveDueAt TEXT
    );
  `);

  // 为已存在的表添加 archiveDueAt 列（如果不存在）
  try {
    db.exec('ALTER TABLE publish_jobs_v1 ADD COLUMN archiveDueAt TEXT;');
  } catch (err) {
    // 列已存在，忽略错误
  }

  /**
   * 执行迁移：从 JSON 文件迁移到 SQLite
   */
  function migrate() {
    if (!fs.existsSync(publishJobsPath)) {
      return { migrated: false, reason: 'json_file_not_found' };
    }

    try {
      const oldPayload = readJsonIfExists(publishJobsPath, { jobs: [] });
      if (!Array.isArray(oldPayload.jobs) || oldPayload.jobs.length === 0) {
        return { migrated: false, reason: 'no_jobs_to_migrate' };
      }

      const stmt = db.prepare('INSERT OR IGNORE INTO publish_jobs_v1 (id, data, updatedAt) VALUES (?, ?, ?)');
      const insertMany = db.transaction((jobs) => {
        for (const job of jobs) {
          stmt.run(job.id, JSON.stringify(job), job.updatedAt || new Date().toISOString());
        }
      });
      insertMany(oldPayload.jobs);

      // 备份原 JSON 文件
      fs.renameSync(publishJobsPath, publishJobsPath + '.bak');
      console.log('Migrated publish_jobs.json to SQLite database.');

      return { migrated: true, count: oldPayload.jobs.length };
    } catch (err) {
      console.error('Migration to SQLite failed:', err);
      return { migrated: false, reason: 'migration_error', error: err.message };
    }
  }

  // 自动执行迁移
  migrate();

  return { db, migrate };
}

module.exports = { createPublishDatabase };

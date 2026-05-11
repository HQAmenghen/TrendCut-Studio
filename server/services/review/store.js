const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(process.cwd(), 'data');
const REVIEW_DB_PATH = path.join(DATA_DIR, 'ai_review.db');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化数据库
function initReviewDatabase() {
  const db = new Database(REVIEW_DB_PATH);

  // 创建审核记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_review_records (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      review_status TEXT NOT NULL,
      overall_score INTEGER,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      content_quality_score INTEGER,
      subtitle_accuracy_score INTEGER,
      title_appeal_score INTEGER,
      editing_quality_score INTEGER,
      content_analysis TEXT,
      subtitle_issues TEXT,
      title_suggestions TEXT,
      editing_feedback TEXT,
      fix_suggestions TEXT,
      auto_fix_available INTEGER DEFAULT 0,
      config_snapshot TEXT,
      error_message TEXT,
      error_details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_review_asset ON ai_review_records(asset_id);
    CREATE INDEX IF NOT EXISTS idx_review_status ON ai_review_records(review_status);
    CREATE INDEX IF NOT EXISTS idx_review_created ON ai_review_records(created_at DESC);
  `);

  // 创建审核配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_review_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER DEFAULT 1,
      min_pass_score INTEGER DEFAULT 65,
      content_weight INTEGER DEFAULT 30,
      subtitle_weight INTEGER DEFAULT 25,
      title_weight INTEGER DEFAULT 20,
      editing_weight INTEGER DEFAULT 25,
      auto_skip_on_error INTEGER DEFAULT 0,
      require_manual_confirm INTEGER DEFAULT 1,
      save_review_history INTEGER DEFAULT 1,
      gemini_model TEXT DEFAULT 'gemini-2.5-pro',
      gemini_timeout INTEGER DEFAULT 180,
      updated_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO ai_review_config (id, updated_at)
    VALUES (1, datetime('now'));
  `);

  db.close();
}

// 获取数据库连接
function getReviewDb() {
  return new Database(REVIEW_DB_PATH);
}

// 读取审核配置
function readReviewConfig() {
  const db = getReviewDb();
  try {
    const config = db.prepare('SELECT * FROM ai_review_config WHERE id = 1').get();
    return config || {
      enabled: 1,
      min_pass_score: 65,
      content_weight: 30,
      subtitle_weight: 25,
      title_weight: 20,
      editing_weight: 25,
      auto_skip_on_error: 0,
      require_manual_confirm: 1,
      save_review_history: 1,
      gemini_model: 'gemini-2.5-pro',
      gemini_timeout: 180
    };
  } finally {
    db.close();
  }
}

// 写入审核配置
function writeReviewConfig(config) {
  const db = getReviewDb();
  try {
    db.prepare(`
      UPDATE ai_review_config SET
        enabled = ?,
        min_pass_score = ?,
        content_weight = ?,
        subtitle_weight = ?,
        title_weight = ?,
        editing_weight = ?,
        auto_skip_on_error = ?,
        require_manual_confirm = ?,
        save_review_history = ?,
        gemini_model = ?,
        gemini_timeout = ?,
        updated_at = datetime('now')
      WHERE id = 1
    `).run(
      config.enabled ? 1 : 0,
      config.min_pass_score || 65,
      config.content_weight || 30,
      config.subtitle_weight || 25,
      config.title_weight || 20,
      config.editing_weight || 25,
      config.auto_skip_on_error ? 1 : 0,
      config.require_manual_confirm ? 1 : 0,
      config.save_review_history ? 1 : 0,
      config.gemini_model || 'gemini-2.5-pro',
      config.gemini_timeout || 180
    );
  } finally {
    db.close();
  }
}

// 创建审核记录
function createReviewRecord(record) {
  const db = getReviewDb();
  try {
    db.prepare(`
      INSERT INTO ai_review_records (
        id, asset_id, video_path, review_status, created_at, config_snapshot
      ) VALUES (?, ?, ?, ?, datetime('now'), ?)
    `).run(
      record.id,
      record.asset_id,
      record.video_path,
      record.review_status || 'reviewing',
      JSON.stringify(record.config_snapshot || {})
    );
  } finally {
    db.close();
  }
}

// 更新审核记录
function updateReviewRecord(id, updates) {
  const db = getReviewDb();
  try {
    const fields = [];
    const values = [];

    if (updates.review_status !== undefined) {
      fields.push('review_status = ?');
      values.push(updates.review_status);
    }
    if (updates.overall_score !== undefined) {
      fields.push('overall_score = ?');
      values.push(updates.overall_score);
    }
    if (updates.content_quality_score !== undefined) {
      fields.push('content_quality_score = ?');
      values.push(updates.content_quality_score);
    }
    if (updates.subtitle_accuracy_score !== undefined) {
      fields.push('subtitle_accuracy_score = ?');
      values.push(updates.subtitle_accuracy_score);
    }
    if (updates.title_appeal_score !== undefined) {
      fields.push('title_appeal_score = ?');
      values.push(updates.title_appeal_score);
    }
    if (updates.editing_quality_score !== undefined) {
      fields.push('editing_quality_score = ?');
      values.push(updates.editing_quality_score);
    }
    if (updates.content_analysis !== undefined) {
      fields.push('content_analysis = ?');
      values.push(JSON.stringify(updates.content_analysis));
    }
    if (updates.subtitle_issues !== undefined) {
      fields.push('subtitle_issues = ?');
      values.push(JSON.stringify(updates.subtitle_issues));
    }
    if (updates.title_suggestions !== undefined) {
      fields.push('title_suggestions = ?');
      values.push(JSON.stringify(updates.title_suggestions));
    }
    if (updates.editing_feedback !== undefined) {
      fields.push('editing_feedback = ?');
      values.push(JSON.stringify(updates.editing_feedback));
    }
    if (updates.fix_suggestions !== undefined) {
      fields.push('fix_suggestions = ?');
      values.push(JSON.stringify(updates.fix_suggestions));
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.error_message);
    }
    if (updates.error_details !== undefined) {
      fields.push('error_details = ?');
      values.push(updates.error_details);
    }

    fields.push('completed_at = datetime(\'now\')');
    values.push(id);

    const sql = `UPDATE ai_review_records SET ${fields.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...values);
  } finally {
    db.close();
  }
}

// 获取审核记录
function getReviewRecord(id) {
  const db = getReviewDb();
  try {
    const record = db.prepare('SELECT * FROM ai_review_records WHERE id = ?').get(id);
    if (record) {
      // 解析JSON字段
      ['content_analysis', 'subtitle_issues', 'title_suggestions', 'editing_feedback', 'fix_suggestions', 'config_snapshot'].forEach(field => {
        if (record[field]) {
          try {
            record[field] = JSON.parse(record[field]);
          } catch (e) {
            record[field] = null;
          }
        }
      });
    }
    return record;
  } finally {
    db.close();
  }
}

// 获取审核历史
function getReviewHistory(limit = 50, offset = 0) {
  const db = getReviewDb();
  try {
    const records = db.prepare(`
      SELECT * FROM ai_review_records
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare('SELECT COUNT(*) as count FROM ai_review_records').get().count;

    // 解析JSON字段
    records.forEach(record => {
      ['content_analysis', 'subtitle_issues', 'title_suggestions', 'editing_feedback', 'fix_suggestions', 'config_snapshot'].forEach(field => {
        if (record[field]) {
          try {
            record[field] = JSON.parse(record[field]);
          } catch (e) {
            record[field] = null;
          }
        }
      });
    });

    return { records, total, limit, offset };
  } finally {
    db.close();
  }
}

// 删除审核记录
function deleteReviewRecord(id) {
  const db = getReviewDb();
  try {
    const result = db.prepare('DELETE FROM ai_review_records WHERE id = ?').run(id);
    return result.changes || 0;
  } finally {
    db.close();
  }
}

module.exports = {
  initReviewDatabase,
  getReviewDb,
  readReviewConfig,
  writeReviewConfig,
  createReviewRecord,
  updateReviewRecord,
  getReviewRecord,
  getReviewHistory,
  deleteReviewRecord,
  REVIEW_DB_PATH
};

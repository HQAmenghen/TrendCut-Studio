const Database = require('better-sqlite3');

class TaskStore {
  constructor(dbPath, options = {}) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('busy_timeout = 5000');
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
    this.revision = 0;
    this.statements = new Map();
    this.initSchema();
    this.memoryCache = new Map(); // 活跃任务缓存
  }

  prepare(key, sql) {
    if (!this.statements.has(key)) {
      this.statements.set(key, this.db.prepare(sql));
    }
    return this.statements.get(key);
  }

  notifyChange() {
    this.revision += 1;
    if (this.onChange) {
      try {
        this.onChange(this.revision);
      } catch (_err) {}
    }
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        taskKey TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        message TEXT,
        logs TEXT,
        metadata TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT,
        durationSeconds INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_type_status ON tasks(type, status);
      CREATE INDEX IF NOT EXISTS idx_tasks_updatedAt ON tasks(updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_type_updatedAt ON tasks(type, updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_status_createdAt ON tasks(status, createdAt ASC);
      CREATE INDEX IF NOT EXISTS idx_tasks_status_updatedAt ON tasks(status, updatedAt DESC);
    `);
    this.ensureColumn('tasks', 'taskKey', 'TEXT');
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_type_taskKey ON tasks(type, taskKey) WHERE taskKey IS NOT NULL AND taskKey != '';
    `);
  }

  ensureColumn(tableName, columnName, definition) {
    const columns = this.prepare(`pragma:${tableName}:columns`, `PRAGMA table_info(${tableName})`).all();
    if (columns.some((column) => column.name === columnName)) return;
    this.db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }

  rowToTask(row) {
    if (!row) return null;
    return {
      ...row,
      logs: JSON.parse(row.logs || '[]'),
      metadata: JSON.parse(row.metadata || '{}')
    };
  }

  createTask(type, metadata = {}, options = {}) {
    const now = new Date().toISOString();
    const task = {
      id: options.id || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      taskKey: String(options.taskKey || '').trim() || null,
      type,
      status: options.status || 'queued',
      progress: Number.isFinite(Number(options.progress)) ? Number(options.progress) : 0,
      message: options.message || '',
      logs: Array.isArray(options.logs) ? options.logs : [],
      metadata,
      createdAt: options.createdAt || now,
      updatedAt: options.updatedAt || now,
      startedAt: options.startedAt || null,
      completedAt: options.completedAt || null,
      durationSeconds: options.durationSeconds || null
    };

    this.prepare('createTask', `
      INSERT INTO tasks (id, taskKey, type, status, progress, message, logs, metadata, createdAt, updatedAt, startedAt, completedAt, durationSeconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.taskKey, task.type, task.status, task.progress, task.message,
      JSON.stringify(task.logs), JSON.stringify(task.metadata),
      task.createdAt, task.updatedAt, task.startedAt, task.completedAt, task.durationSeconds
    );

    this.memoryCache.set(task.id, task);
    this.notifyChange();
    return task;
  }

  createOrReuseTask(type, taskKey, metadata = {}, options = {}) {
    const normalizedKey = String(taskKey || '').trim();
    if (!normalizedKey) {
      return { task: this.createTask(type, metadata, options), created: true };
    }

    const existing = this.findTaskByKey(type, normalizedKey);
    if (existing) {
      const nextMetadata = options.mergeMetadata === false
        ? existing.metadata
        : { ...existing.metadata, ...metadata };
      const task = this.updateTask(existing.id, {
        metadata: nextMetadata,
        message: options.message || existing.message,
        updatedAt: options.updatedAt
      });
      return { task, created: false };
    }

    return {
      task: this.createTask(type, metadata, { ...options, taskKey: normalizedKey }),
      created: true
    };
  }

  updateTask(id, updates) {
    const task = this.memoryCache.get(id) || this.getTask(id);
    if (!task) throw new Error('Task not found');

    // 只有在 updates 中没有明确提供 updatedAt 时，才自动设置为当前时间
    const updatedAt = updates.updatedAt || new Date().toISOString();
    Object.assign(task, updates, { updatedAt });

    // 计算持续时间
    if (task.completedAt && task.startedAt) {
      task.durationSeconds = Math.max(0, Math.floor(
        (new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000
      ));
    }

    this.prepare('updateTask', `
      UPDATE tasks SET taskKey = ?, status = ?, progress = ?, message = ?, logs = ?,
                       metadata = ?, updatedAt = ?, startedAt = ?, completedAt = ?, durationSeconds = ?
      WHERE id = ?
    `).run(
      task.taskKey || null, task.status, task.progress, task.message,
      JSON.stringify(task.logs), JSON.stringify(task.metadata),
      task.updatedAt, task.startedAt, task.completedAt, task.durationSeconds,
      id
    );

    this.memoryCache.set(id, task);
    this.notifyChange();
    return task;
  }

  getTask(id) {
    const cached = this.memoryCache.get(id);
    if (cached) return cached;

    const row = this.prepare('getTaskById', 'SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) return null;

    const task = this.rowToTask(row);

    // 缓存活跃任务
    if (['queued', 'running'].includes(task.status)) {
      this.memoryCache.set(id, task);
    }

    return task;
  }

  findTaskByKey(type, taskKey, options = {}) {
    const normalizedKey = String(taskKey || '').trim();
    if (!normalizedKey) return null;
    const statuses = Array.isArray(options.statuses) ? options.statuses.filter(Boolean) : [];
    const cacheMatch = Array.from(this.memoryCache.values()).find((task) =>
      task.type === type &&
      task.taskKey === normalizedKey &&
      (statuses.length === 0 || statuses.includes(task.status))
    );
    if (cacheMatch) return cacheMatch;

    const statusClause = statuses.length
      ? ` AND status IN (${statuses.map(() => '?').join(', ')})`
      : '';
    const statementKey = statuses.length ? `findTaskByKey:${statuses.length}` : 'findTaskByKey:any';
    const row = this.prepare(statementKey, `
      SELECT * FROM tasks WHERE type = ? AND taskKey = ?${statusClause} ORDER BY updatedAt DESC LIMIT 1
    `).get(type, normalizedKey, ...statuses);
    const task = this.rowToTask(row);
    if (task && ['queued', 'running'].includes(task.status)) {
      this.memoryCache.set(task.id, task);
    }
    return task;
  }

  listTasks(type, limit = 50) {
    const rows = this.prepare('listTasksByType', `
      SELECT * FROM tasks WHERE type = ? ORDER BY updatedAt DESC LIMIT ?
    `).all(type, limit);

    return rows.map(row => this.rowToTask(row));
  }

  listActiveTasks(type) {
    let query;
    let params;

    if (type) {
      // 如果指定了 type，只查询该类型的活跃任务
      query = 'SELECT * FROM tasks WHERE type = ? AND status IN (\'queued\', \'running\') ORDER BY createdAt ASC';
      params = [type];
    } else {
      // 如果没有指定 type，查询所有活跃任务
      query = 'SELECT * FROM tasks WHERE status IN (\'queued\', \'running\') ORDER BY createdAt ASC';
      params = [];
    }

    const statementKey = type ? 'listActiveTasksByType' : 'listActiveTasksAll';
    const rows = this.prepare(statementKey, query).all(...params);

    return rows.map(row => this.rowToTask(row));
  }

  appendLog(id, message) {
    const task = this.getTask(id);
    if (!task) return;

    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    task.logs.push(`[${timestamp}] ${message}`);
    task.logs = task.logs.slice(-120); // 保留最近 120 条

    this.updateTask(id, { logs: task.logs });
  }

  deleteTask(id) {
    this.prepare('deleteTaskById', 'DELETE FROM tasks WHERE id = ?').run(id);
    this.memoryCache.delete(id);
    this.notifyChange();
  }

  close() {
    this.db.close();
  }
}

module.exports = { TaskStore };

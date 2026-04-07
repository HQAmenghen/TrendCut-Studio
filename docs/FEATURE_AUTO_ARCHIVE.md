# 自动归档已发布任务功能

## 功能概述

自动归档功能允许已成功发布的任务在延迟一段时间后自动从主列表移走，降低发布中心的噪音，提升用户体验。

## 实现细节

### 1. 配置项

#### 环境变量（.env）
```bash
# 自动归档已发布任务
AUTO_ARCHIVE_PUBLISHED=true
AUTO_ARCHIVE_DELAY_MINUTES=30
```

#### 前端配置（发布中心 > 自动归档设置）
- **启用归档**：开关控制是否启用自动归档
- **延迟归档分钟数**：设置发布成功后多久自动归档（默认 30 分钟）

配置优先级：前端配置 > 环境变量

### 2. 归档规则

- ✅ **自动归档**：状态为 `published` 的任务
- ❌ **不归档**：`failed`、`cancelled`、`ready_for_manual_publish` 状态的任务
- 📦 **已归档任务**：可在"查看已归档"中找回并取消归档

### 3. 技术实现

#### 数据库扩展
- 在 `publish_jobs_v1` 表中添加 `archiveDueAt` 字段
- 自动迁移已存在的表结构

#### 状态更新触发
当任务状态更新为 `published` 时：
```javascript
// server/services/publish/store.js
if (job.status === 'published' && previousStatus !== 'published') {
  const config = configService.readPublishConfig();
  if (isAutoArchiveEnabled(config)) {
    if (!job.archiveDueAt) {
      job.archiveDueAt = calculateArchiveDueAt(null, config);
    }
  }
}
```

#### 定时扫描归档
调度器每分钟扫描一次到期的归档任务：
```javascript
// server/services/system/scheduler.js
cron.schedule('* * * * *', async () => {
  const dueJobs = publishStore.getDueArchiveJobs(Date.now());
  for (const job of dueJobs) {
    publishStore.archivePublishJob(job.id, true);
  }
});
```

### 4. 前端界面

在发布中心左侧配置面板中添加了"📦 自动归档设置"区块：

```vue
<div class="panel">
  <div class="panel-header panel-header-between">
    <span>📦 自动归档设置</span>
    <button @click="center.saveConfig('归档设置')">
      保存归档配置
    </button>
  </div>
  <div class="panel-body">
    <!-- 启用开关 -->
    <label class="toggle">
      <input type="checkbox" 
        :checked="!!center.config.value?.global?.autoArchiveEnabled"
        @change="center.updateConfigField('global', 'autoArchiveEnabled', $event.target.checked)"
      />
      启用归档
    </label>
    
    <!-- 延迟分钟数 -->
    <input type="number" 
      :value="center.config.value.global?.autoArchiveDelayMinutes || 30"
      @input="center.updateConfigField('global', 'autoArchiveDelayMinutes', parseInt($event.target.value) || 30)"
    />
  </div>
</div>
```

## 使用方式

### 1. 启用自动归档

**方式一：环境变量**
```bash
# .env
AUTO_ARCHIVE_PUBLISHED=true
AUTO_ARCHIVE_DELAY_MINUTES=30
```

**方式二：前端配置**
1. 打开发布中心
2. 找到"📦 自动归档设置"面板
3. 开启"启用归档"开关
4. 设置"延迟归档分钟数"
5. 点击"保存归档配置"

### 2. 查看归档任务

在发布中心任务列表中点击"查看已归档"按钮，可以查看所有已归档的任务。

### 3. 取消归档

在已归档任务列表中，点击任务的"取消归档"按钮，任务将重新出现在主列表中。

## 收益

- ✅ **降低噪音**：发布中心主列表更干净，只显示待处理和进行中的任务
- ✅ **减少操作**：无需手动整理已完成的任务
- ✅ **灵活配置**：支持自定义延迟时间和开关控制
- ✅ **低风险**：不影响核心执行链路，已归档任务可随时找回

## 注意事项

1. **配置优先级**：前端配置优先于环境变量
2. **定时扫描**：调度器每分钟扫描一次，实际归档时间可能有 1 分钟以内的延迟
3. **数据库迁移**：首次启动时会自动添加 `archiveDueAt` 字段
4. **状态限制**：只有 `published` 状态的任务会被自动归档

## 相关文件

### 后端
- `server/services/publish/store.js` - 归档逻辑实现
- `server/services/publish/publishStore.migrations.js` - 数据库迁移
- `server/services/publish/publishStore.config.js` - 配置管理
- `server/services/system/scheduler.js` - 定时扫描任务

### 前端
- `frontend/src/components/PublishCenterWorkspace.vue` - 配置界面

### 配置
- `.env.example` - 环境变量示例

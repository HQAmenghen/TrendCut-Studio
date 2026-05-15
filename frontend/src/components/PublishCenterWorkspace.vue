<template>
  <section class="publish-page">
    <section class="hero-panel">
      <div class="hero-grid">
        <div class="hero-copy">
          <div class="section-kicker">Distribution Console</div>
          <div>
            <h3>多平台发布中心</h3>
            <p>把当前中台产出的成片统一整理成发布任务，集中填写平台配置、标题描述和标签，按平台生成一键发布清单。</p>
          </div>
          <div class="flow-pills">
            <span class="flow-pill">视频号</span>
            <span class="flow-pill">抖音</span>
            <span class="flow-pill">小红书</span>
            <span class="flow-pill">X</span>
            <span class="flow-pill">YouTube</span>
          </div>
        </div>
        <div class="hero-stats">
          <div class="dashboard-stat">
            <span>素材数量</span>
            <strong>{{ center.assets.value.length || 0 }}</strong>
            <p>自动收集当前项目内可发布视频。</p>
          </div>
          <div class="dashboard-stat">
            <span>平台配置</span>
            <strong>{{ enabledPlatforms.length }}</strong>
            <p>已启用平台数会影响一键发布可用性。</p>
          </div>
          <div class="dashboard-stat">
            <span>发布任务</span>
            <strong>{{ center.jobs.value.length }}</strong>
            <p>保存最近 50 条任务记录。</p>
          </div>
          <div class="dashboard-stat">
            <span>状态</span>
            <strong>{{ center.loading.value ? '加载中' : '就绪' }}</strong>
            <p>先填配置，再选素材与平台创建任务。</p>
          </div>
        </div>
      </div>
    </section>

    <div class="workspace-grid">
      <div class="left-column">
        <div class="builder-card">
          <div class="builder-card-header">
            <div>
              <h4>接入健康度</h4>
              <p>把平台配置变成可视化状态，不用再靠脑子记哪些字段还没补。</p>
            </div>
          </div>
          <div class="builder-card-body health-stack">
            <div v-for="platform in center.platformCards.value" :key="`health_${platform.key}`" class="platform-health">
              <div class="health-head">
                <div>
                  <div class="health-title">{{ platform.label }}</div>
                  <div class="health-status">{{ platform.config?.enabled ? '已启用' : '未启用' }}</div>
                </div>
                <div class="health-percent" :class="{ enabled: platform.config?.enabled }">{{ platform.percent }}%</div>
              </div>
              <div class="bar"><span :style="{ width: `${platform.percent}%` }"></span></div>
            </div>
          </div>
        </div>

        <div class="builder-card">
          <div class="builder-card-header">
            <div>
              <h4>启动自检</h4>
              <p>快速确认环境变量、脚本、目录和运行依赖是否在线。</p>
            </div>
            <button type="button" class="ghost-btn compact-btn" @click="center.refreshSelfCheck()" :disabled="center.selfCheckLoading.value">
              {{ center.selfCheckLoading.value ? '检测中...' : '重新检测' }}
            </button>
          </div>
          <div class="builder-card-body self-check-stack">
            <div class="self-check-summary">
              <div class="self-check-chip" :class="`status-${center.selfCheckSummary.value.status}`">
                {{ selfCheckStatusLabel(center.selfCheckSummary.value.status) }}
              </div>
              <div class="summary-meta">
                通过 {{ center.selfCheckSummary.value.okCount }} 项 · 警告 {{ center.selfCheckSummary.value.warnCount }} 项 · 失败 {{ center.selfCheckSummary.value.failCount }} 项
              </div>
            </div>
            <div v-if="center.selfCheckHighlights.value.length" class="self-check-list">
              <div v-for="item in center.selfCheckHighlights.value" :key="`${item.groupLabel}_${item.key}`" class="self-check-item">
                <div class="self-check-item-head">
                  <strong>{{ item.label }}</strong>
                  <span :class="`status-${item.status}`">{{ item.status }}</span>
                </div>
                <div class="job-sub">{{ item.groupLabel }} · {{ item.details || '待检查' }}</div>
                <div v-if="item.hint" class="summary-note compact-note">{{ item.hint }}</div>
              </div>
            </div>
            <div v-else class="summary-note">当前没有高优先级异常，自检结果已通过。</div>
          </div>
        </div>

        <div class="panel" style="margin-bottom: 24px;">
          <div class="panel-header panel-header-between">
            <span>🤖 无人值守全栈托管 (Auto-Pilot)</span>
            <button type="button" class="save-chip" @click="center.saveConfig('托管配置')" :disabled="center.savingConfig.value">
              {{ center.savingConfig.value ? '保存中...' : '保存托管配置' }}
            </button>
          </div>
          <div class="panel-body">
            <div class="platform-block mb-0" style="background: rgba(0,0,0,0.1); border: none;">
              <div class="platform-block-head">
                <div>
                  <div class="platform-name">自动调度与发稿引擎</div>
                  <div class="platform-tip">
                    开启后：未勾选“使用当前榜单”时，会在设定抓榜时间自动获取榜单并继续发片；
                    勾选后，保存配置就会立刻按当前榜单准备任务，只保留下方的发布时间和账号分发策略。
                  </div>
                </div>
                <label class="toggle">
                  <input
                    type="checkbox"
                    :checked="!!center.config.value?.global?.autoPilotEnabled"
                    @change="center.updateConfigField('global', 'autoPilotEnabled', $event.target.checked)"
                  />
                  全面接管
                </label>
              </div>
              <div class="px-3 pb-3 pt-0" v-if="center.config.value?.global?.autoPilotEnabled">
                <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 16px;">
                  <div>
                    <label class="control-label mb-1 block" style="font-size: 12px;">自动抓榜时间</label>
                    <input type="time" class="input-dark" style="font-size: 14px; width: 100px;" :value="center.config.value.global?.autoPilotFetchTime || '07:30'" @input="center.updateConfigField('global', 'autoPilotFetchTime', $event.target.value)" />
                  </div>
                  <div>
                    <label class="control-label mb-1 block" style="font-size: 12px;">发帖数量 (Top N)</label>
                    <span style="font-size: 13px; color: #9ca3af;">(由下方排名配置自动决定)</span>
                  </div>
                </div>

                <div style="margin-bottom: 16px; padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);">
                  <label class="toggle" style="justify-content: space-between; width: 100%;">
                    <span>
                      <strong style="display: block; color: var(--strong-text); font-size: 13px;">使用当前榜单</strong>
                      <span style="display: block; margin-top: 6px; color: #9ca3af; font-size: 12px; line-height: 1.6;">
                        开启后，保存托管配置就会立刻按照当前已保存的 Top10 榜单启动渲染和自动发布准备，不再依赖上方抓榜时间。适合直接测试自动发布链路。
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      :checked="!!center.config.value?.global?.autoPilotUseCurrentRanking"
                      @change="center.updateConfigField('global', 'autoPilotUseCurrentRanking', $event.target.checked)"
                    />
                  </label>
                </div>

                <div style="margin-bottom: 16px; padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);">
                  <div style="display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap;">
                    <div>
                      <strong style="display: block; color: var(--strong-text); font-size: 13px;">制作模式</strong>
                      <span style="display: block; margin-top: 6px; color: #9ca3af; font-size: 12px; line-height: 1.6;">
                        可同时开启带数字人与不带数字人，两条流水线会分别生成发布任务，并使用下方时间进入定时发布。
                      </span>
                    </div>
                    <div class="autopilot-mode-selector">
                      <button
                        v-for="mode in center.autoPilotPipelineDefs"
                        :key="mode.key"
                        type="button"
                        class="autopilot-mode-option"
                        :class="{ active: center.activeAutoPilotPipelineModes.value.includes(mode.key) }"
                        :title="mode.description"
                        :aria-pressed="center.activeAutoPilotPipelineModes.value.includes(mode.key)"
                        @click="center.toggleAutoPilotPipelineMode(mode.key, !center.activeAutoPilotPipelineModes.value.includes(mode.key))"
                      >
                        <span class="mode-option-title">{{ mode.label }}</span>
                        <span class="mode-option-desc">{{ mode.description }}</span>
                        <span class="mode-option-state">
                          {{ center.activeAutoPilotPipelineModes.value.includes(mode.key) ? '已启用' : '点击启用' }}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
                
                <div class="autopilot-config-panel">
                  <div class="autopilot-section-intro">
                    <div>
                      <label class="control-label">精细化定时分发策略</label>
                      <p>每条计划独立选择发布账号、榜单分区、分区内排名和发布时间，可同时发布多个板块的 Top1。</p>
                    </div>
                  </div>

                  <div
                    v-for="mode in center.autoPilotPipelineDefs.filter(item => center.activeAutoPilotPipelineModes.value.includes(item.key))"
                    :key="`schedule_${mode.key}`"
                    class="autopilot-plan-group"
                  >
                    <div class="autopilot-plan-head">
                      <div>
                        <strong>{{ mode.label }}发布计划</strong>
                        <span>{{ mode.description }}</span>
                      </div>
                      <span>{{ center.getAutoPilotMappingsForMode(mode.key).length }} 条</span>
                    </div>

                    <div class="autopilot-plan-list">
                      <div
                        v-for="m in center.getAutoPilotMappingsForMode(mode.key)"
                        :key="`${mode.key}_${m.slot}`"
                        class="autopilot-plan-row"
                      >
                        <div class="plan-slot">
                          <span>计划 {{ m.slot }}</span>
                          <strong>{{ m.partitionLabel }} Top {{ m.sourceRank }}</strong>
                        </div>

                        <label class="plan-field plan-field-platforms">
                          <span>目标平台</span>
                          <div class="plan-platform-picks">
                            <label v-for="platform in center.autoPilotPlatformDefs" :key="`${mode.key}_${m.slot}_${platform.key}`">
                              <input
                                type="checkbox"
                                :checked="m.platforms.includes(platform.key)"
                                @change="center.toggleAutoPilotModePlatform(mode.key, m.slot, platform.key, $event.target.checked)"
                              />
                              {{ platform.label }}
                            </label>
                          </div>
                        </label>

                        <label v-if="m.platforms.includes('wechatChannels')" class="plan-field plan-field-account">
                          <span>发布账号</span>
                          <select
                            class="input-dark"
                            :value="m.accountId"
                            @change="center.updateAutoPilotModeArray(mode.key, 'accountIds', m.slot - 1, $event.target.value)"
                          >
                            <option v-for="account in center.getWechatAccountOptions()" :key="account.id" :value="account.id">
                              {{ account.label }}
                            </option>
                          </select>
                        </label>
                        <div v-else class="plan-field plan-field-account">
                          <span>发布账号</span>
                          <div class="plan-static-field">无需视频号账号</div>
                        </div>

                        <label class="plan-field">
                          <span>榜单分区</span>
                          <select
                            class="input-dark"
                            :value="m.partitionId"
                            @change="center.updateAutoPilotModeArray(mode.key, 'partitionIds', m.slot - 1, $event.target.value)"
                          >
                            <option v-for="partition in center.xaiPartitionOptions.value" :key="partition.id" :value="partition.id">
                              {{ partition.label }}
                            </option>
                          </select>
                        </label>

                        <label class="plan-field plan-field-rank">
                          <span>分区排名</span>
                          <select
                            class="input-dark"
                            :value="String(m.sourceRank || 1)"
                            @change="center.updateAutoPilotModeArray(mode.key, 'sourceRanks', m.slot - 1, $event.target.value)"
                          >
                            <option v-for="rank in [1,2,3,4,5,6,7,8,9,10]" :key="`${mode.key}_${m.slot}_rank_${rank}`" :value="String(rank)">
                              Top {{ rank }}
                            </option>
                          </select>
                        </label>

                        <label class="plan-field plan-field-time">
                          <span>发布时间</span>
                          <input
                            type="time"
                            class="input-dark"
                            :value="m.time"
                            @input="center.updateAutoPilotModeArray(mode.key, 'times', m.slot - 1, $event.target.value)"
                          />
                        </label>

                        <button
                          type="button"
                          class="plan-remove-btn"
                          title="移除计划"
                          @click="center.removeAutoPilotModeMapping(mode.key, m.slot)"
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    <div v-if="!center.getAutoPilotMappingsForMode(mode.key).length" class="autopilot-empty-state">
                      这个模式还没有配置自动分发映射。
                    </div>

                    <div class="autopilot-plan-actions">
                      <button
                        type="button"
                        class="ghost-btn compact-btn autopilot-add-plan"
                        :disabled="center.getAutoPilotMappingsForMode(mode.key).length >= 10"
                        @click="center.addAutoPilotModeMapping(mode.key, center.getNextAutoPilotMappingSlot(mode.key))"
                      >
                        + 新增发布计划
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="platform-block autopilot-task-window">
              <div class="autopilot-task-panel">
                <div class="autopilot-task-head">
                  <div>
                    <div class="summary-kicker">Automation Queue</div>
                    <strong>当前自动化任务</strong>
                  </div>
                  <span>{{ center.autoPilotJobs.value.length }} 条</span>
                </div>
                <div v-if="!center.autoPilotJobs.value.length" class="autopilot-empty">
                  当前还没有由自动化流水线创建的发布任务。
                </div>
                <div v-else class="autopilot-task-list">
                  <div v-for="task in center.autoPilotJobs.value" :key="task.id" class="autopilot-task-item">
                    <div class="autopilot-task-title-row">
                      <strong>{{ task.title }}</strong>
                      <span>{{ task.statusLabel }}</span>
                    </div>
                    <div class="autopilot-task-meta">
                      <span>{{ task.pipelineLabel }}</span>
                      <span v-if="task.platformLabels?.length">{{ task.platformLabels.join(' / ') }}</span>
                      <span v-if="task.slot">计划 {{ task.slot }}</span>
                      <span v-if="task.partitionLabel">{{ task.partitionLabel }} Top {{ task.sourceRank || task.rank }}</span>
                      <span v-else-if="task.rank">Top {{ task.rank }}</span>
                      <span>{{ task.accountLabel }}</span>
                    </div>
                    <div class="autopilot-task-time">
                      {{ task.scheduledLabel || center.formatAutoPilotJobTime(task.scheduledAt) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="panel" style="margin-bottom: 24px;">
          <div class="panel-header panel-header-between">
            <span>📦 自动归档设置</span>
            <button type="button" class="save-chip" @click="center.saveConfig('归档设置')" :disabled="center.savingConfig.value">
              {{ center.savingConfig.value ? '保存中...' : '保存归档配置' }}
            </button>
          </div>
          <div class="panel-body">
            <div class="platform-block mb-0" style="background: rgba(0,0,0,0.1); border: none;">
              <div class="platform-block-head">
                <div>
                  <div class="platform-name">自动归档已发布任务</div>
                  <div class="platform-tip">
                    开启后，状态为 published 的任务会在延迟时间后自动归档，降低发布中心噪音。
                  </div>
                </div>
                <label class="toggle">
                  <input
                    type="checkbox"
                    :checked="!!center.config.value?.global?.autoArchiveEnabled"
                    @change="center.updateConfigField('global', 'autoArchiveEnabled', $event.target.checked)"
                  />
                  启用归档
                </label>
              </div>
              <div class="px-3 pb-3 pt-0" v-if="center.config.value?.global?.autoArchiveEnabled">
                <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 16px;">
                  <div>
                    <label class="control-label mb-1 block" style="font-size: 12px;">延迟归档分钟数</label>
                    <input
                      type="number"
                      class="input-dark"
                      style="font-size: 14px; width: 120px;"
                      min="0"
                      :value="center.config.value.global?.autoArchiveDelayMinutes || 30"
                      @input="center.updateConfigField('global', 'autoArchiveDelayMinutes', parseInt($event.target.value) || 30)"
                    />
                  </div>
                  <div style="font-size: 13px; color: #9ca3af; margin-top: 20px;">
                    任务发布成功后，将在设定的延迟时间后自动归档
                  </div>
                </div>
                <div style="padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);">
                  <div style="font-size: 12px; color: #9ca3af; line-height: 1.6;">
                    <strong style="display: block; color: var(--strong-text); margin-bottom: 6px;">归档规则说明：</strong>
                    • 仅归档状态为 <code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">published</code> 的任务<br/>
                    • <code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">failed / cancelled / ready_for_manual_publish</code> 状态不会自动归档<br/>
                    • 已归档的任务可在"查看已归档"中找回并取消归档
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header panel-header-between">
            <span>🔐 社交账号授权配置</span>
            <button type="button" class="save-chip" @click="center.saveConfig('社交账号授权')" :disabled="center.savingConfig.value">
              {{ center.savingConfig.value ? '保存中...' : '保存授权信息' }}
            </button>
          </div>
          <div class="panel-body config-scroll">
            <div
              v-for="platform in center.platformDefs"
              :key="platform.key"
              :class="['platform-block', hasIssue(platform.key) ? 'platform-issue' : '']"
            >
              <div class="platform-block-head">
                <div>
                  <div class="platform-name">{{ platform.label }}</div>
                  <div class="platform-tip">{{ platformTip(platform.key) }}</div>
                </div>
                <label class="toggle">
                  <input
                    type="checkbox"
                    :checked="!!center.config.value?.[platform.key]?.enabled"
                    @change="center.updateConfigField(platform.key, 'enabled', $event.target.checked)"
                  />
                  启用
                </label>
              </div>
              <div class="platform-fields">
                <template v-if="platform.key === 'wechatChannels'">
                  <div class="account-manager">
                    <div class="account-manager-head">
                      <div class="platform-tip">为每个视频号账号分配独立浏览器登录环境，避免账号互串。</div>
                      <div style="display: flex; gap: 8px; align-items: center;">
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                          <input v-model="batchNotifyFeishu" type="checkbox" style="width: 16px; height: 16px; cursor: pointer;" />
                          <span>发送飞书</span>
                        </label>
                        <button
                          v-if="selectedWechatAccounts.length > 0"
                          type="button"
                          class="ghost-btn compact-btn"
                          :disabled="checkingBatchLogin"
                          @click="checkSelectedAccountsLogin"
                        >
                          {{ checkingBatchLogin ? '检测中...' : `检测选中 (${selectedWechatAccounts.length})` }}
                        </button>
                        <button type="button" class="ghost-btn compact-btn" @click="center.addWechatAccount">新增账号</button>
                      </div>
                    </div>
                    <div v-if="!center.wechatAccounts.value.length" class="issue-box">还没有配置任何视频号账号。</div>
                    <div v-for="account in center.wechatAccounts.value" :key="account.id" class="account-card">
                      <div class="account-card-head" @click="toggleAccountExpand(account.id)" style="cursor: pointer;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                          <input
                            type="checkbox"
                            :checked="selectedWechatAccounts.includes(account.id)"
                            @change.stop="toggleWechatAccountSelection(account.id)"
                            style="width: 18px; height: 18px; cursor: pointer;"
                          />
                          <span class="expand-icon" :class="{ expanded: expandedAccounts.has(account.id) }">▶</span>
                          <strong>{{ account.displayName || account.helperAccount || account.finderUserName || account.id }}</strong>
                          <span
                            v-if="accountLoginStatus[account.id]"
                            class="login-status-badge"
                            :class="`status-${accountLoginStatus[account.id].status}`"
                          >
                            {{ getLoginStatusText(accountLoginStatus[account.id].status) }}
                          </span>
                        </div>
                        <div style="display: flex; gap: 8px;" @click.stop>
                          <button
                            type="button"
                            class="ghost-btn compact-btn"
                            :disabled="checkingLoginAccounts.has(account.id)"
                            @click="checkSingleAccountLogin(account.id)"
                          >
                            {{ checkingLoginAccounts.has(account.id) ? '检测中...' : '检测登录' }}
                          </button>
                          <button type="button" class="ghost-btn compact-btn" @click="center.testWechatLogin(account.id)">扫码登录</button>
                          <button type="button" class="ghost-btn compact-btn" @click="center.removeWechatAccount(account.id)">删除</button>
                        </div>
                      </div>
                      <div v-show="expandedAccounts.has(account.id)" class="platform-fields">
                        <input
                          class="input-dark text-sm"
                          :value="account.displayName || ''"
                          placeholder="账号备注 / Account Alias"
                          @input="center.updateWechatAccountField(account.id, 'displayName', $event.target.value)"
                        />
                        <div v-for="field in editableFields(platform.key)" :key="`${platform.key}-${account.id}-${field}`">
                          <label class="control-label field-label">
                            <span>{{ center.getFieldLabel(platform.key, field) }}</span>
                            <span v-if="requiredFields(platform.key).includes(field)" class="required-tag">Required</span>
                          </label>
                          <input
                            :type="center.isSecretField(field) ? 'password' : 'text'"
                            :class="['input-dark text-sm', isMissing(platform.key, field, account) ? 'missing-field' : '']"
                            :value="account[field] || ''"
                            @input="center.updateWechatAccountField(account.id, field, $event.target.value)"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <input
                    class="input-dark text-sm"
                    :value="center.config.value?.[platform.key]?.displayName || ''"
                    :placeholder="`${platform.label} 账号备注 / Account Alias`"
                    @input="center.updateConfigField(platform.key, 'displayName', $event.target.value)"
                  />
                  <div v-for="field in editableFields(platform.key)" :key="`${platform.key}-${field}`">
                    <label class="control-label field-label">
                      <span>{{ center.getFieldLabel(platform.key, field) }}</span>
                      <span v-if="requiredFields(platform.key).includes(field)" class="required-tag">Required</span>
                    </label>
                    <input
                      :type="center.isSecretField(field) ? 'password' : 'text'"
                      :class="['input-dark text-sm', isMissing(platform.key, field) ? 'missing-field' : '']"
                      :value="center.config.value?.[platform.key]?.[field] || ''"
                      @input="center.updateConfigField(platform.key, field, $event.target.value)"
                    />
                  </div>
                </template>
              </div>
              <div v-if="hasIssue(platform.key)" class="issue-box">
                缺少必填字段 / Missing required fields: {{ missingLabels(platform.key).join('，') }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="right-column">
        <div class="builder-card">
          <div class="builder-card-header">
            <div>
              <h4>发布工作区</h4>
              <p>从上到下完成：先编辑任务，再看素材，最后查看和执行任务，不再需要来回切页。</p>
            </div>
            <div class="header-tools">
              <button type="button" class="dark-chip" @click="center.refresh(true)" :disabled="center.loading.value">刷新素材与任务</button>
            </div>
          </div>
          <div class="builder-card-body workspace-stack">
            <div class="summary-grid">
              <div class="module-summary-card">
                <span>已启用平台</span>
                <strong>{{ enabledPlatforms.length }}</strong>
              </div>
              <div class="module-summary-card">
                <span>可发布素材</span>
                <strong>{{ center.assets.value.length }}</strong>
              </div>
              <div class="module-summary-card">
                <span>任务存量</span>
                <strong>{{ center.jobs.value.length }}</strong>
              </div>
            </div>

            <section class="workspace-section">
              <div class="section-head">
                <div>
                  <div class="summary-kicker">Step 1</div>
                  <div class="section-title">任务编辑器</div>
                </div>
                <div class="section-tip">先选素材，填标题和描述，再创建任务。</div>
              </div>
              <div class="editor-layout">
                <div class="editor-main">
                  <div>
                    <label class="control-label">选择发布素材</label>
                    <select :value="center.selectedAssetId.value" class="input-dark text-sm" @change="center.selectAsset($event.target.value)">
                      <option value="">请选择一个可发布的视频成片</option>
                      <option v-for="asset in center.assets.value" :key="asset.id" :value="asset.id">
                        {{ asset.displayLabel || asset.label }} · {{ formatDateTime(asset.updatedAt) }}
                      </option>
                    </select>
                  </div>

                  <div class="two-col editor-top-grid">
                    <div>
                      <div class="field-row">
                        <label class="control-label">发布标题</label>
                        <button type="button" class="ghost-btn compact-btn" @click="center.applySuggestedTitle">恢复推荐标题</button>
                      </div>
                      <input class="input-dark text-sm" :value="center.editor.value.title" placeholder="输入各平台共用标题" @input="center.editor.value.title = $event.target.value" />
                    </div>
                    <div>
                      <label class="control-label">封面链接</label>
                      <input class="input-dark text-sm" :value="center.editor.value.coverUrl" placeholder="可选：封面图片 URL" @input="center.editor.value.coverUrl = $event.target.value" />
                    </div>
                  </div>

                  <div>
                    <label class="control-label">标签策略</label>
                    <div class="platform-picks">
                      <label class="pick-card">
                        <input
                          type="radio"
                          name="publish-tag-strategy"
                          value="system"
                          :checked="center.editor.value.tagStrategy === 'system'"
                          @change="center.editor.value.tagStrategy = 'system'"
                        />
                        <span>系统标签</span>
                      </label>
                      <label class="pick-card">
                        <input
                          type="radio"
                          name="publish-tag-strategy"
                          value="model"
                          :checked="center.editor.value.tagStrategy === 'model'"
                          @change="center.editor.value.tagStrategy = 'model'"
                        />
                        <span>模型标签（默认）</span>
                      </label>
                    </div>
                    <div class="summary-meta">
                      {{ center.editor.value.tagStrategy === 'model'
                        ? '模型会把 #话题 一起写进描述，系统不再额外追加标签。'
                        : '模型只生成描述，下面的标签会由系统单独追加。' }}
                    </div>
                  </div>

                  <div>
                    <div class="field-row">
                      <label class="control-label">发布描述</label>
                      <button
                        type="button"
                        class="ghost-btn compact-btn"
                        @click="center.generateEditorDescription"
                        :disabled="center.generatingDescription.value"
                      >
                        {{ center.generatingDescription.value ? '生成中...' : '自动生成描述' }}
                      </button>
                    </div>
                    <textarea class="input-dark text-sm resize-none" rows="4" :value="center.editor.value.description" placeholder="输入发布描述、口播摘要或行动号召" @input="center.editor.value.description = $event.target.value"></textarea>
                  </div>

                  <div>
                    <div class="field-row">
                      <label class="control-label">标签</label>
                      <button type="button" class="ghost-btn compact-btn" @click="center.applySuggestedTags" :disabled="center.editor.value.tagStrategy === 'model'">恢复推荐标签</button>
                    </div>
                    <input
                      class="input-dark text-sm"
                      :value="center.editor.value.tags"
                      :disabled="center.editor.value.tagStrategy === 'model'"
                      :placeholder="center.editor.value.tagStrategy === 'model' ? '模型标签模式下，这里的系统标签不会追加到描述中' : '用逗号分隔，例如：热点视频, 财经, 能源'"
                      @input="center.editor.value.tags = $event.target.value"
                    />
                  </div>

                  <div>
                    <label class="control-label">发布平台</label>
                    <div class="platform-picks">
                      <label v-for="platform in center.platformDefs" :key="platform.key" class="pick-card">
                        <input
                          type="checkbox"
                          :checked="center.editor.value.platforms.includes(platform.key)"
                          @change="center.toggleEditorPlatform(platform.key, $event.target.checked)"
                        />
                        <span>{{ platform.label }}</span>
                      </label>
                    </div>
                  </div>

                  <div v-if="center.editor.value.platforms.includes('wechatChannels')">
                    <label class="control-label">视频号发布账号</label>
                    <select
                      class="input-dark text-sm"
                      :value="center.editor.value.platformSelections.wechatChannels.accountId"
                      @change="center.editor.value.platformSelections.wechatChannels.accountId = $event.target.value"
                    >
                      <option value="">请选择视频号账号</option>
                      <option v-for="account in center.getWechatAccountOptions()" :key="account.id" :value="account.id">
                        {{ account.label }}
                      </option>
                    </select>
                  </div>

                  <div>
                    <div class="field-row">
                      <label class="control-label">定时发布（选填）</label>
                    </div>
                    <div class="summary-meta" style="margin-bottom: 8px;">设定时间后，只要本地服务器保持运行，系统将在指定时间自动提交发布。</div>
                    <input type="datetime-local" class="input-dark text-sm" :value="center.editor.value.scheduledTime" @input="center.editor.value.scheduledTime = $event.target.value" />
                  </div>

                  <button type="button" class="btn-primary" @click="center.createJob" :disabled="center.creating.value">
                    <span v-if="!center.creating.value">{{ center.editor.value.scheduledTime ? '⏰ 加入定时发布队列' : '🚀 创建一键发布任务' }}</span>
                    <span v-else>⏳ 正在整理发布任务...</span>
                  </button>

                    <div v-if="center.creating.value && center.creatingStatusMessage.value" class="summary-note pending-note">
                      {{ center.creatingStatusMessage.value }}
                    </div>

                    <div v-if="center.errorState.value?.message" class="error-box">
                      <strong>{{ center.errorState.value.message }}</strong>
                    <div v-if="center.errorState.value.code" class="error-meta">错误码：{{ center.errorState.value.code }}</div>
                    <div v-if="center.errorState.value.hint" class="error-meta">排查建议：{{ center.errorState.value.hint }}</div>
                  </div>
                </div>

                <div class="config-cluster sticky-summary">
                  <div class="config-cluster-title">编辑摘要</div>
                  <div class="summary-side">
                    <div class="summary-card">
                      <div class="summary-kicker">素材预览</div>
                      <div v-if="center.selectedAsset.value?.url" class="video-shell">
                        <video :src="center.selectedAsset.value.url" controls preload="metadata" muted playsinline class="asset-video"></video>
                      </div>
                      <div v-else class="empty-preview">选择素材后会在这里显示视频预览。</div>
                    </div>

                    <div class="summary-card">
                      <div class="summary-kicker">当前素材</div>
                      <div class="summary-title">{{ center.selectedAsset.value?.displayLabel || center.selectedAsset.value?.label || '未选择素材' }}</div>
                      <div class="summary-meta">{{ center.selectedAsset.value ? `${center.selectedAsset.value.sourceMetaLine || center.selectedAsset.value.sourceType} · ${formatDateTime(center.selectedAsset.value.updatedAt)}` : '选择素材后会自动带出标题、描述和标签。' }}</div>
                      <div v-if="center.selectedAsset.value?.metadata?.sourceSummary" class="summary-note">{{ center.selectedAsset.value.metadata.sourceSummary }}</div>
                      <div v-if="center.selectedAsset.value?.metadata?.descriptionSource" class="summary-note compact-note">
                        描述来源：
                        {{
                          center.selectedAsset.value.metadata.descriptionSource === 'subtitles'
                            ? '字幕内容'
                            : center.selectedAsset.value.metadata.descriptionSource === 'post_summary'
                              ? '帖子摘要'
                              : '暂无可用文本'
                        }}
                      </div>
                    </div>

                    <div class="summary-card">
                      <div class="summary-kicker">文案完成度</div>
                      <div class="summary-title">{{ editorHealth.label }}</div>
                      <div class="bar mt"><span :style="{ width: `${editorHealth.percent}%` }"></span></div>
                    </div>

                    <div class="summary-card">
                      <div class="summary-kicker">已选平台</div>
                      <div class="summary-meta">{{ center.editor.value.platforms.length ? center.editor.value.platforms.map(platformLabel).join(' / ') : '尚未选择平台' }}</div>
                    </div>

                    <details class="asset-drawer">
                      <summary>展开侧边素材库（{{ center.assets.value.length }}）</summary>
                      <div class="asset-drawer-list">
                        <div v-if="!center.assets.value.length" class="empty-note">当前还没有可发布的成片。</div>
                        <div v-for="asset in center.assets.value" :key="`drawer_${asset.id}`" class="asset-drawer-card">
                          <div class="asset-title">{{ asset.displayLabel || asset.label }}</div>
                          <div class="asset-meta">{{ asset.sourceMetaLine || asset.sourceType }} · {{ formatDateTime(asset.updatedAt) }}</div>

                          <!-- AI审核状态 -->
                          <div v-if="asset.metadata?.aiReview" class="asset-review-status">
                            <span
                              class="review-badge"
                              :class="`badge-${asset.metadata.aiReview.status}`"
                            >
                              {{ getReviewStatusLabel(asset.metadata.aiReview.status) }}
                              <span v-if="asset.metadata.aiReview.overallScore !== undefined">
                                {{ asset.metadata.aiReview.overallScore }}分
                              </span>
                            </span>
                          </div>

                          <div class="asset-links">
                            <a :href="asset.url" target="_blank" rel="noreferrer">打开视频</a>
                            <button type="button" @click="useAsset(asset)">用于发布</button>
                            <button
                              v-if="review.isEnabled"
                              type="button"
                              class="review-btn"
                              @click="reviewAsset(asset)"
                              :disabled="review.reviewing.value"
                            >
                              {{ review.reviewing.value ? '审核中...' : '审核' }}
                            </button>
                          </div>

                          <!-- 审核结果展示 -->
                          <ReviewResultCard
                            v-if="asset.metadata?.aiReview && asset.metadata.aiReview.status !== 'skipped'"
                            :review="asset.metadata.aiReview"
                            :show-details="false"
                            :show-skip="true"
                            :show-regenerate="false"
                            @skip="skipAssetReview(asset)"
                            style="margin-top: 12px;"
                          />
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            </section>

            <section class="workspace-section">
              <div class="section-head section-head-wrap">
                <div>
                  <div class="summary-kicker">Step 2</div>
                  <div class="section-title">任务列表</div>
                </div>
                <div class="jobs-toolbar">
                  <select class="input-dark text-sm compact-select" :value="center.jobFilter.value" @change="center.jobFilter.value = $event.target.value">
                    <option value="active">进行中 / 未归档</option>
                    <option value="manual">待人工确认</option>
                    <option value="published">已发布</option>
                    <option value="failed">失败 / 已取消</option>
                    <option value="archived">已归档</option>
                    <option value="all">全部</option>
                  </select>
                  <div class="jobs-toolbar-actions">
                    <button type="button" class="primary-btn compact-btn" @click="center.runAllWechat('draft')">🚀 一键到待发布 (草稿)</button>
                    <button type="button" class="primary-btn compact-btn" @click="center.runAllWechat('publish')">📤 一键全部发布</button>
                    <button type="button" class="dark-chip" @click="center.archiveCompleted">归档已完成任务</button>
                    <button type="button" class="ghost-btn compact-btn" @click="center.clearJobs">清空列表</button>
                  </div>
                </div>
              </div>
              <div class="job-list">
              <div v-if="!center.jobs.value.length" class="empty-note">还没有发布任务。</div>
              <div v-for="job in center.filteredJobs.value" :key="job.id" class="job-card">
                <div class="job-head">
                  <div>
                    <div class="job-title">{{ job.publishData?.title || '未命名任务' }}</div>
                    <div class="job-sub">{{ job.asset?.displayLabel || job.asset?.label || '-' }}</div>
                  </div>
                  <span class="job-state">{{ center.getJobStatusLabel(job) }}</span>
                </div>

                <div class="job-detail-grid">
                  <div class="summary-card job-detail-card">
                    <div class="summary-kicker">描述策略</div>
                    <div class="summary-title">{{ job.publishData?.tagStrategy === 'model' ? '模型标签' : '系统标签' }}</div>
                    <div class="job-sub">{{ job.publishData?.tagStrategy === 'model' ? '模型负责描述与话题' : '模型生成描述，系统单独追加标签' }}</div>
                  </div>
                  <div class="summary-card job-detail-card">
                    <div class="summary-kicker">当前标签</div>
                    <div class="summary-title">{{ (job.publishData?.tags || []).length ? job.publishData.tags.join(' / ') : '未设置系统标签' }}</div>
                    <div class="job-sub">平台：{{ selectedPlatformLabels(job) }}</div>
                  </div>
                </div>

                <div v-if="job.publishData?.description" class="summary-note job-description">
                  {{ job.publishData.description }}
                </div>

                <div
                  v-for="task in platformTasks(job)"
                  :key="`${job.id}_${task.platform}`"
                  class="wechat-box platform-task-box"
                >
                  <div class="wechat-head">
                    <strong>{{ platformLabel(task.platform) }}</strong>
                    <span>{{ task.status || task.runtime?.state || 'unknown' }}</span>
                  </div>
                  <div v-if="task.accountLabel || task.accountId" class="job-sub">发布账号：{{ task.accountLabel || task.accountId }}</div>
                  <div class="bar mt"><span :style="{ width: `${center.getTaskProgress(job, task.platform)}%` }"></span></div>
                  <div class="job-sub">{{ task.runtime?.lastMessage || task.description || task.guide || '等待执行...' }}</div>
                  <div v-if="task.validation?.missingFieldLabels?.length" class="summary-note compact-note">
                    缺少配置：{{ task.validation.missingFieldLabels.join('，') }}
                  </div>
                  <div v-if="task.automationModes?.length" class="job-actions">
                    <button type="button" class="ghost-btn compact-btn" @click="center.runPlatform(job, task.platform, 'draft')" :disabled="!center.canRunPlatform(job, task.platform)">打开并填充到待发布页</button>
                    <button type="button" class="ghost-btn compact-btn" @click="center.runPlatform(job, task.platform, 'publish')" :disabled="!center.canRunPlatform(job, task.platform)">自动上传并发表</button>
                    <button type="button" class="ghost-btn compact-btn" @click="center.retryPlatform(job, task.platform)">失败后重试</button>
                    <button type="button" class="ghost-btn compact-btn" @click="center.cancelPlatform(job, task.platform)">取消任务</button>
                  </div>
                  <details v-if="task.runtime?.logs?.length" class="log-box">
                    <summary>查看运行日志</summary>
                    <pre>{{ task.runtime?.logs?.slice(-18).join('\n') }}</pre>
                  </details>
                </div>

                <div class="job-actions">
                  <button type="button" class="ghost-btn compact-btn" @click="useJob(job)">载入编辑器</button>
                  <button
                    type="button"
                    class="ghost-btn compact-btn"
                    @click="center.regenerateJobDescription(job)"
                    :disabled="center.regeneratingDescriptionJobId.value === job.id"
                  >
                    {{ center.regeneratingDescriptionJobId.value === job.id ? '生成中...' : '重新生成描述' }}
                  </button>
                  <button type="button" class="ghost-btn compact-btn" @click="center.archiveJob(job, !job.archived)">
                    {{ job.archived ? '取消归档' : '归档任务' }}
                  </button>
                  <button type="button" class="ghost-btn compact-btn" @click="center.deleteJob(job)">删除任务</button>
                </div>
              </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="center.qrCodeData.value.show"
      class="qr-modal-backdrop"
      @click.self="center.closeQrCodeModal"
    >
      <div class="qr-modal-content">
        <h4 class="qr-modal-title">微信视频号登录</h4>
        <div class="qr-state-box">
          <div v-if="center.qrCodeData.value.status === 'loading'">
            ⏳ {{ center.qrCodeData.value.message || '正在打开浏览器...' }}
          </div>
          <template v-else-if="center.qrCodeData.value.status === 'need_scan'">
            <img
              v-if="center.qrCodeData.value.base64"
              :src="center.qrCodeData.value.base64"
              alt="微信扫码二维码"
              class="qr-image"
            />
            <div>{{ center.qrCodeData.value.message || '请在弹出的浏览器窗口中扫描二维码' }}</div>
            <div class="job-sub">扫码并在手机上确认后，系统会自动检测并关闭此弹窗。</div>
          </template>
          <template v-else-if="center.qrCodeData.value.status === 'logged_in'">
            <strong>✅ 登录成功</strong>
            <div>{{ center.qrCodeData.value.message || '登录态已恢复，弹窗即将关闭' }}</div>
          </template>
          <template v-else-if="center.qrCodeData.value.status === 'error'">
            <strong>❌ 检测失败</strong>
            <div>{{ center.qrCodeData.value.error || '请稍后重试' }}</div>
          </template>
        </div>
        <div class="qr-modal-actions">
          <button type="button" class="ghost-btn compact-btn" @click="center.closeQrCodeModal">关闭</button>
        </div>
      </div>
    </div>

    <RunLogPanel
      title="📝 运行摘要"
      :summary-items="center.autoPilotSummaryItems.value"
      :recent-logs="center.recentLogs.value"
      :error-logs="center.errorLogs.value"
    />
  </section>
</template>

<script setup>
import { computed, onMounted, ref, reactive } from 'vue';
import RunLogPanel from './RunLogPanel.vue';
import ReviewResultCard from './ReviewResultCard.vue';
import { useVideoReview } from '../composables/useVideoReview';

const props = defineProps({
  center: { type: Object, required: true }
});

const {
  accountLoginStatus,
  checkingLoginAccounts,
  checkingBatchLogin
} = props.center;

// 审核功能
const review = useVideoReview();

// 登录状态检测
const selectedWechatAccounts = ref([]);
const expandedAccounts = reactive(new Set());
const batchNotifyFeishu = ref(false);  // 批量检测时是否发送飞书通知

onMounted(() => {
  review.loadConfig();
  loadAllLoginStatus();
  // 默认展开第一个账号
  if (props.center.wechatAccounts.value.length > 0) {
    expandedAccounts.add(props.center.wechatAccounts.value[0].id);
  }
});

// 加载所有账号的登录状态
async function loadAllLoginStatus() {
  await props.center.loadAllLoginStatus();
}

// 切换账号选择
function toggleWechatAccountSelection(accountId) {
  const index = selectedWechatAccounts.value.indexOf(accountId);
  if (index > -1) {
    selectedWechatAccounts.value.splice(index, 1);
  } else {
    selectedWechatAccounts.value.push(accountId);
  }
}

// 切换账号展开/折叠
function toggleAccountExpand(accountId) {
  if (expandedAccounts.has(accountId)) {
    expandedAccounts.delete(accountId);
  } else {
    expandedAccounts.add(accountId);
  }
}

// 检测单个账号登录状态
async function checkSingleAccountLogin(accountId) {
  await props.center.checkSingleAccountLogin(accountId);
}

// 批量检测选中账号
async function checkSelectedAccountsLogin() {
  if (selectedWechatAccounts.value.length === 0) return;
  const result = await props.center.checkSelectedAccountsLogin(selectedWechatAccounts.value, batchNotifyFeishu.value);
  if (result) {
    const msg = `检测完成: ${result.logged_in} 已登录, ${result.need_login} 需登录, ${result.error} 异常`;
    if (batchNotifyFeishu.value && result.need_login > 0) {
      alert(msg + '\n\n已发送飞书通知');
    } else {
      alert(msg);
    }
  }
}

// 获取登录状态文本
function getLoginStatusText(status) {
  const map = {
    logged_in: '✓ 已登录',
    need_login: '⚠ 需登录',
    error: '✗ 异常',
    checking: '检测中'
  };
  return map[status] || status;
}

// 审核素材
async function reviewAsset(asset) {
  const result = await review.reviewVideo(asset.path, asset.id);
  if (result.success) {
    if (result.skipped) {
      alert(`审核已跳过: ${result.reason}`);
    } else {
      alert(`审核完成！得分: ${result.result.overall_score}/100`);
      // 刷新素材列表以显示审核结果
      props.center.refreshAssets();
    }
  } else {
    alert(`审核失败: ${result.error}`);
  }
}

// 跳过素材审核
async function skipAssetReview(asset) {
  if (!confirm('确定要将该素材的AI审核标记为已跳过吗？')) {
    return;
  }
  const result = await review.skipReview(asset.path, asset.id, 'manual_skip');
  if (result.success) {
    alert('已跳过审核');
    props.center.refreshAssets();
  } else {
    alert(`跳过失败: ${result.error}`);
  }
}

// 获取审核状态标签
function getReviewStatusLabel(status) {
  const labels = {
    passed: '✓ 已通过',
    failed: '✗ 未通过',
    reviewing: '审核中',
    skipped: '已跳过',
    pending: '待审核'
  };
  return labels[status] || status;
}

const enabledPlatforms = computed(() => props.center.platformDefs.filter((platform) => props.center.config.value?.[platform.key]?.enabled));

const requiredFieldMap = {
  wechatChannels: ['finderUserName', 'helperAccount'],
  douyin: [],
  xiaohongshu: [],
  x: [],
  youtube: []
};

const platformTips = {
  wechatChannels: '按官方公开能力先保存视频号主体与视频号助手信息，当前以手动发布包为主。',
  douyin: '预留抖音开放平台字段，后续接入真实上传流程。',
  xiaohongshu: '预留小红书平台账号和凭据字段。',
  x: '预留 X 平台 API 字段，便于后续接入。',
  youtube: '预留 YouTube 频道 OAuth 字段。'
};

const editorHealth = computed(() => {
  let score = 0;
  if (String(props.center.editor.value.title || '').trim()) score += 25;
  if (String(props.center.editor.value.description || '').trim()) score += 35;
  if (String(props.center.editor.value.tags || '').trim()) score += 20;
  if ((props.center.editor.value.platforms || []).length) score += 20;
  return {
    percent: score,
    label: score >= 90 ? '可直接创建任务' : score >= 60 ? '需要补充基础内容' : '待完善文案'
  };
});

const editableFields = (platformKey) => {
  if (platformKey === 'wechatChannels') {
    return ['finderUserName', 'helperAccount', 'openPlatformAppId', 'appId', 'appSecret', 'refreshToken', 'accountId', 'notes'];
  }
  const source = props.center.config.value?.[platformKey] || {};
  return Object.keys(source).filter((field) => !['enabled', 'displayName', 'notes'].includes(field));
};

const requiredFields = (platformKey) => requiredFieldMap[platformKey] || [];

const isMissing = (platformKey, field, account = null) => {
  if (!requiredFields(platformKey).includes(field)) return false;
  if (platformKey === 'wechatChannels' && account) {
    return !String(account?.[field] || '').trim();
  }
  return !String(props.center.config.value?.[platformKey]?.[field] || '').trim();
};

const missingLabels = (platformKey) => {
  if (platformKey === 'wechatChannels') {
    const accounts = props.center.wechatAccounts.value || [];
    if (!accounts.length) return ['至少配置一个视频号账号'];
    const firstBroken = accounts.find((account) => requiredFields(platformKey).some((field) => isMissing(platformKey, field, account)));
    if (!firstBroken) return [];
    return requiredFields(platformKey).filter((field) => isMissing(platformKey, field, firstBroken)).map((field) => props.center.getFieldLabel(platformKey, field));
  }
  return requiredFields(platformKey).filter((field) => isMissing(platformKey, field)).map((field) => props.center.getFieldLabel(platformKey, field));
};
const hasIssue = (platformKey) => !!props.center.config.value?.[platformKey]?.enabled && missingLabels(platformKey).length > 0;
const platformTip = (platformKey) => platformTips[platformKey] || '平台接入说明';
const platformLabel = (key) => props.center.platformDefs.find((platform) => platform.key === key)?.label || key;
const wechatTask = (job) => props.center.getTask(job, 'wechatChannels');
const platformTasks = (job) => Array.isArray(job?.platformTasks) ? job.platformTasks : [];
const selectedPlatformLabels = (job) => {
  const selected = Array.isArray(job?.selectedPlatforms) && job.selectedPlatforms.length
    ? job.selectedPlatforms
    : platformTasks(job).map((task) => task.platform);
  return selected.length ? selected.map(platformLabel).join(' / ') : '未选择平台';
};

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function useAsset(asset) {
  props.center.selectedAssetId.value = asset.id;
  props.center.selectAsset(asset.id);
}

function useJob(job) {
  props.center.loadJobIntoEditor(job);
}

function selfCheckStatusLabel(status) {
  if (status === 'ok') return '环境通过';
  if (status === 'warn') return '存在警告';
  if (status === 'fail') return '存在阻塞';
  return '尚未检测';
}
</script>

<style scoped>
.publish-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.hero-panel,
.panel,
.builder-card,
.platform-health,
.platform-block,
.module-summary-card,
.config-cluster,
.summary-card,
.asset-card,
.job-card,
.wechat-box,
.dashboard-stat,
.console-card {
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--card-bg);
  box-shadow: var(--shadow);
}

.hero-panel {
  overflow: hidden;
  background: var(--hero-bg);
}

.hero-grid {
  display: grid;
  grid-template-columns: 1.25fr 1fr;
  gap: 24px;
  padding: 24px;
}

.section-kicker,
.control-label,
.config-cluster-title,
.summary-kicker {
  color: #7dd3fc;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.self-check-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.self-check-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.self-check-chip {
  display: inline-flex;
  align-items: center;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  border: 1px solid var(--line);
}

.self-check-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.self-check-item {
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.55);
}

.self-check-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.compact-note {
  margin-top: 6px;
}

.job-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.autopilot-config-panel {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.autopilot-section-intro {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.autopilot-section-intro p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  margin: 6px 0 0;
}

.autopilot-config-panel,
.autopilot-task-panel {
  min-width: 0;
}

.autopilot-mode-selector {
  display: grid;
  grid-template-columns: repeat(2, minmax(150px, 1fr));
  gap: 10px;
  min-width: min(100%, 360px);
}

.autopilot-mode-option {
  appearance: none;
  border: 1px solid rgba(125, 211, 252, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 106px;
  padding: 12px;
  text-align: left;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
}

.autopilot-mode-option:hover {
  border-color: rgba(125, 211, 252, 0.45);
  transform: translateY(-1px);
}

.autopilot-mode-option.active {
  border-color: rgba(14, 165, 233, 0.85);
  background: rgba(14, 165, 233, 0.1);
}

.mode-option-title {
  color: var(--strong-text);
  font-size: 13px;
  font-weight: 850;
}

.mode-option-desc {
  color: #9ca3af;
  font-size: 12px;
  line-height: 1.45;
}

.mode-option-state {
  color: #38bdf8;
  font-size: 11px;
  font-weight: 850;
  margin-top: auto;
}

.autopilot-mode-schedule {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.025);
  margin-top: 12px;
  padding: 12px;
}

.autopilot-plan-group {
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--card-bg);
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
  margin-top: 14px;
  padding: 14px;
}

.autopilot-plan-head {
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.autopilot-plan-head strong {
  color: var(--strong-text);
  display: block;
  font-size: 14px;
}

.autopilot-plan-head span {
  color: var(--muted);
  display: block;
  font-size: 12px;
  line-height: 1.55;
  margin-top: 4px;
}

.autopilot-plan-head > span {
  color: #0ea5e9;
  font-weight: 850;
  margin-top: 0;
  white-space: nowrap;
}

.autopilot-plan-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.autopilot-plan-row {
  align-items: end;
  background: var(--panel-subtle);
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  display: grid;
  gap: 10px;
  grid-template-columns: 118px minmax(160px, 1.1fr) minmax(150px, 1.15fr) minmax(118px, 0.9fr) 108px 112px 34px;
  padding: 12px;
}

.plan-slot {
  align-self: stretch;
  background: var(--card-subtle-bg);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 54px;
  padding: 10px 12px;
}

.plan-slot span,
.plan-field span {
  color: var(--muted);
  display: block;
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
  text-transform: uppercase;
}

.plan-slot strong {
  color: var(--strong-text);
  font-size: 13px;
  line-height: 1.3;
}

.plan-field {
  margin: 0;
  min-width: 0;
}

.plan-field .input-dark {
  border-radius: 12px;
  font-size: 14px;
  min-height: 46px;
  padding: 10px 12px;
}

.plan-platform-picks {
  align-items: center;
  background: var(--input-bg);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 46px;
  padding: 8px 10px;
}

.plan-platform-picks label {
  align-items: center;
  color: var(--text);
  display: inline-flex;
  font-size: 12px;
  gap: 6px;
  white-space: nowrap;
}

.plan-static-field {
  align-items: center;
  background: var(--input-bg);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  color: var(--muted);
  display: flex;
  font-size: 13px;
  min-height: 46px;
  padding: 10px 12px;
}

.plan-remove-btn {
  align-items: center;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.24);
  border-radius: 12px;
  color: #ef4444;
  cursor: pointer;
  display: inline-flex;
  font-size: 20px;
  height: 46px;
  justify-content: center;
  line-height: 1;
  transition: background 0.16s ease, border-color 0.16s ease;
  width: 34px;
}

.plan-remove-btn:hover {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.42);
}

.autopilot-empty-state {
  border: 1px dashed var(--line-soft);
  border-radius: 14px;
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 12px;
  padding: 18px;
  text-align: center;
}

.autopilot-plan-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.autopilot-add-plan {
  background: var(--input-bg);
  border-radius: 10px;
  font-size: 12px;
  padding: 8px 12px;
}

.mode-schedule-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.mode-schedule-head strong {
  color: var(--strong-text);
  display: block;
  font-size: 13px;
}

.mode-schedule-head span {
  color: #9ca3af;
  display: block;
  font-size: 12px;
  line-height: 1.5;
  margin-top: 4px;
}

.mode-schedule-head > span {
  color: #38bdf8;
  font-weight: 850;
  margin-top: 0;
  white-space: nowrap;
}

.autopilot-task-window {
  margin-top: 16px;
  background: rgba(0, 0, 0, 0.1);
  border: none;
}

.autopilot-task-panel {
  border-radius: 12px;
}

.autopilot-task-head,
.autopilot-task-title-row,
.autopilot-task-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.autopilot-task-head {
  justify-content: space-between;
  margin-bottom: 12px;
}

.autopilot-task-head strong,
.autopilot-task-title-row strong {
  color: var(--strong-text);
}

.autopilot-task-head > span,
.autopilot-task-title-row span {
  color: #7dd3fc;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.autopilot-empty {
  border: 1px dashed rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
  padding: 18px;
  text-align: center;
}

.autopilot-task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 360px;
  overflow: auto;
}

.autopilot-task-item {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 10px;
}

.autopilot-task-title-row {
  justify-content: space-between;
}

.autopilot-task-title-row strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.autopilot-task-meta {
  flex-wrap: wrap;
  color: #9ca3af;
  font-size: 12px;
  margin-top: 7px;
}

.autopilot-task-time {
  color: #cbd5e1;
  font-size: 12px;
  margin-top: 7px;
}

.job-detail-card {
  padding: 14px 16px;
  box-shadow: none;
}

.job-description {
  margin-top: 12px;
}

.status-ok {
  color: #0f9f5f;
}

.status-warn {
  color: #d97706;
}

.status-fail {
  color: #dc2626;
}

.hero-copy {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hero-copy h3 {
  margin: 0;
  color: var(--strong-text);
  font-size: 2.8rem;
  line-height: 1.1;
  font-weight: 900;
}

.hero-copy p,
.builder-card-header p,
.platform-tip,
.console-copy,
.muted-copy,
.summary-meta,
.asset-meta,
.asset-desc,
.job-sub {
  margin: 0;
  color: var(--muted);
  font-size: 0.875rem;
  line-height: 1.8;
}

.flow-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.flow-pill {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: var(--input-bg);
  color: var(--muted);
  padding: 0.45rem 0.85rem;
  font-size: 0.75rem;
}

.hero-stats,
.summary-grid,
.two-col {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.dashboard-stat,
.module-summary-card {
  padding: 16px;
}

.dashboard-stat span,
.module-summary-card span {
  display: block;
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.dashboard-stat strong,
.module-summary-card strong {
  display: block;
  color: var(--strong-text);
  font-size: 1.9rem;
  margin-top: 12px;
  line-height: 1.15;
}

.dashboard-stat p {
  margin-top: 10px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.workspace-grid {
  display: grid;
  grid-template-columns: 4fr 8fr;
  gap: 24px;
}

.left-column,
.right-column,
.health-stack,
.workspace-stack,
.summary-side,
.job-list {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.builder-card-header,
.panel-header,
.platform-block-head,
.job-head,
.wechat-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.builder-card-header,
.panel-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}

.builder-card-header h4,
.panel-header span {
  margin: 0;
  color: var(--strong-text);
  font-size: 0.95rem;
  font-weight: 800;
}

.builder-card-body,
.panel-body {
  padding: 20px;
}

.platform-health {
  padding: 14px;
  background: var(--card-subtle-bg);
}

.health-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.health-title,
.platform-name,
.summary-title,
.asset-title,
.job-title {
  color: var(--strong-text);
  font-size: 0.95rem;
  font-weight: 800;
}

.health-status,
.platform-tip {
  margin-top: 6px;
  font-size: 11px;
}

.health-percent {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.health-percent.enabled {
  color: #34d399;
}

.bar {
  height: 8px;
  border-radius: 999px;
  background: var(--line-soft);
  overflow: hidden;
}

.bar span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #22c55e, #38bdf8);
}

.panel-header-between {
  justify-content: space-between;
}

.save-chip,
.dark-chip,
.btn-primary,
.ghost-btn,
.compact-btn {
  border-radius: 12px;
  font-weight: 700;
  cursor: pointer;
}

.save-chip,
.btn-primary {
  border: 0;
  color: #fff;
  background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
}

.save-chip,
.dark-chip {
  padding: 8px 12px;
  font-size: 11px;
}

.dark-chip,
.ghost-btn {
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
  color: var(--strong-text);
}

.ghost-btn {
  padding: 12px 14px;
}

.compact-btn {
  font-size: 12px;
  padding: 10px 12px;
}

.config-scroll {
  max-height: 920px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.platform-block {
  padding: 16px;
  border-color: var(--line-soft);
  background: var(--input-bg);
}

.platform-issue {
  border-color: rgba(245, 158, 11, 0.55);
  background: rgba(245, 158, 11, 0.06);
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 12px;
}

.platform-fields,
.editor-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.account-manager,
.account-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.account-manager-head,
.account-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.account-card {
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  padding: 14px;
  background: var(--card-subtle-bg);
}

.field-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.required-tag {
  color: #f59e0b;
  font-size: 10px;
  letter-spacing: 0.14em;
}

.input-dark {
  width: 100%;
  border: 1px solid var(--input-border);
  border-radius: 12px;
  background: var(--input-bg);
  color: var(--text);
  padding: 14px 16px;
}

.missing-field {
  border-color: rgba(245, 158, 11, 0.7);
}

.issue-box,
.error-box {
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.6;
}

.issue-box {
  border: 1px solid rgba(245, 158, 11, 0.2);
  background: rgba(245, 158, 11, 0.1);
  color: #fcd34d;
}

.error-box {
  border: 1px solid rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
}

.header-tools,
.jobs-toolbar,
.jobs-toolbar-actions,
.job-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.workspace-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.section-head-wrap {
  flex-wrap: wrap;
}

.section-title {
  color: var(--strong-text);
  font-size: 1.05rem;
  font-weight: 800;
}

.section-tip {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
  max-width: 420px;
  text-align: right;
}

.editor-layout {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 16px;
}

.editor-top-grid {
  align-items: end;
}

.platform-picks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.pick-card {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  background: var(--input-bg);
  padding: 14px 16px;
  color: var(--text);
  font-size: 14px;
}

.summary-card,
.asset-card,
.job-card,
.wechat-box,
.config-cluster {
  padding: 14px;
  background: var(--card-subtle-bg);
}

.platform-task-box + .platform-task-box {
  margin-top: 12px;
}

.sticky-summary {
  position: sticky;
  top: 20px;
  align-self: start;
}

.video-shell {
  margin-top: 12px;
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid var(--line-soft);
  background: #000;
}

.asset-video {
  width: 100%;
  height: 176px;
  object-fit: cover;
  display: block;
}

.empty-preview {
  margin-top: 12px;
  border-radius: 16px;
  border: 1px dashed var(--line-soft);
  padding: 24px 12px;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
}

.summary-note,
.asset-desc {
  margin-top: 12px;
  border-radius: 12px;
  background: var(--input-bg);
  padding: 10px 12px;
  color: var(--text);
  font-size: 12px;
  line-height: 1.7;
}

.pending-note {
  border: 1px solid rgba(99, 102, 241, 0.18);
  background: rgba(99, 102, 241, 0.08);
  color: var(--strong-text);
}

.mt {
  margin-top: 12px;
}

.asset-links {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
  font-size: 12px;
}

.asset-links a,
.asset-links button {
  border: 0;
  background: transparent;
  cursor: pointer;
  color: #38bdf8;
  text-decoration: none;
  padding: 0;
}

.asset-links a:nth-child(2) {
  color: #34d399;
}

.asset-links button {
  color: #38bdf8;
}

.empty-note {
  color: var(--muted);
  font-size: 14px;
}

.asset-drawer {
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  background: var(--input-bg);
  overflow: hidden;
}

.asset-drawer summary {
  cursor: pointer;
  list-style: none;
  padding: 12px 14px;
  color: var(--strong-text);
  font-size: 12px;
  font-weight: 700;
}

.asset-drawer summary::-webkit-details-marker {
  display: none;
}

.asset-drawer-list {
  display: grid;
  gap: 10px;
  padding: 0 12px 12px;
}

.asset-drawer-card {
  border: 1px solid var(--line-soft);
  border-radius: 14px;
  background: var(--card-bg);
  padding: 12px;
}

.asset-review-status {
  margin: 8px 0;
}

.review-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.review-badge.badge-passed {
  background: #d1fae5;
  color: #065f46;
}

.review-badge.badge-failed {
  background: #fee2e2;
  color: #991b1b;
}

.review-badge.badge-skipped {
  background: #e5e7eb;
  color: #6b7280;
}

.review-badge.badge-reviewing {
  background: #dbeafe;
  color: #1e40af;
}

.review-badge.badge-pending {
  background: #fef3c7;
  color: #92400e;
}

.review-btn {
  color: #a78bfa !important;
  font-weight: 600;
}

.review-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login-status-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.login-status-badge.status-logged_in {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.login-status-badge.status-need_login {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}

.login-status-badge.status-error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.login-status-badge.status-checking {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.expand-icon {
  display: inline-block;
  font-size: 10px;
  color: var(--muted);
  transition: transform 0.2s ease;
  user-select: none;
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.account-card-head {
  transition: background-color 0.15s ease;
}

.account-card-head:hover {
  background-color: rgba(139, 92, 246, 0.05);
}

.compact-select {
  width: auto;
  min-width: 180px;
}

.job-state {
  display: inline-flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--strong-text);
  font-size: 12px;
  font-weight: 700;
}

.log-box {
  margin-top: 12px;
}

.log-box summary {
  cursor: pointer;
  color: var(--brand-a);
  font-size: 12px;
}

.log-box pre {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
  margin-top: 10px;
  padding: 14px;
  border-radius: 14px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 12px;
  line-height: 1.6;
  border: 1px solid var(--line-soft);
}

@media (max-width: 1200px) {
  .hero-grid,
  .workspace-grid,
  .editor-layout {
    grid-template-columns: 1fr;
  }

  .platform-picks,
  .summary-grid,
  .hero-stats,
  .autopilot-mode-selector,
  .two-col {
    grid-template-columns: 1fr;
  }

  .autopilot-plan-row {
    grid-template-columns: 1fr 1fr;
  }

  .plan-slot,
  .plan-field-platforms,
  .plan-field-account {
    grid-column: 1 / -1;
  }

  .plan-remove-btn {
    width: 100%;
  }

  .section-tip {
    max-width: none;
    text-align: left;
  }

  .sticky-summary {
    position: static;
  }
}

.qr-modal-backdrop {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(4px);
}
.qr-modal-content {
  background: var(--card-bg);
  border: 1px solid var(--line);
  padding: 30px;
  border-radius: 24px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  width: 400px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  gap: 20px;
  text-align: center;
}
.qr-modal-title { margin: 0; color: var(--strong-text); font-size: 1.25rem; }
.qr-state-box { min-height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text); }
.qr-image { width: 200px; height: 200px; border-radius: 12px; border: 1px solid var(--line); background: white; margin: 0 auto; }
.qr-modal-actions { display: flex; justify-content: center; margin-top: 10px; }
</style>

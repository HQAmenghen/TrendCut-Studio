<template>
  <section class="automation-dashboard">
    <section class="command-strip" :class="`state-${statusState}`">
      <div class="command-main">
        <div class="eyebrow">
          <Activity class="icon-sm" aria-hidden="true" />
          全自动生产
        </div>
        <div class="command-title-row">
          <h2>{{ statusTitle }}</h2>
          <span class="status-badge">
            <component :is="statusIcon" class="icon-sm" aria-hidden="true" />
            {{ statusLabel }}
          </span>
        </div>

        <div class="source-line">
          <FileVideo class="icon-sm" aria-hidden="true" />
          <span>{{ sourceLabel }}</span>
        </div>

        <div class="progress-rail" aria-label="自动生产进度">
          <span :style="{ width: displayProgressWidth }"></span>
        </div>

        <div class="run-meta">
          <span><Gauge class="icon-sm" aria-hidden="true" />{{ progressLabel }}</span>
          <span><Layers class="icon-sm" aria-hidden="true" />{{ currentStepLabel }}</span>
          <span><Clock class="icon-sm" aria-hidden="true" />{{ durationLabel }}</span>
          <span><Radio class="icon-sm" aria-hidden="true" />{{ publishReadinessLabel }}</span>
        </div>
      </div>

      <div class="launch-pad">
        <button
          v-if="!jobId && !hasSource"
          type="button"
          class="primary-action"
          :disabled="sourceLocked"
          @click="openSourcePicker"
        >
          <Search class="icon" aria-hidden="true" />
          从热门榜单选素材
        </button>
        <button
          v-else-if="!jobId"
          type="button"
          class="primary-action"
          :disabled="!canStart"
          @click="emitStart"
        >
          <Play class="icon" aria-hidden="true" />
          {{ startActionLabel }}
        </button>
        <button
          v-else-if="finalVideoUrl && verticalErrorText"
          type="button"
          class="primary-action"
          :disabled="verticalLoading"
          @click="$emit('retry-vertical')"
        >
          <RotateCcw class="icon" aria-hidden="true" />
          重试竖屏合成
        </button>
        <button
          v-else-if="finalVideoUrl"
          type="button"
          class="primary-action"
          :disabled="publishCreating || !deliveryReady"
          @click="$emit('create-publish-job')"
        >
          <Send class="icon" aria-hidden="true" />
          {{ primaryPublishActionLabel }}
        </button>
        <button
          v-else
          type="button"
          class="primary-action"
          :disabled="isBusy"
          @click="$emit('continue-workflow')"
        >
          <Play class="icon" aria-hidden="true" />
          继续当前任务
        </button>

        <div class="action-row">
          <label class="tool-button local-upload" :class="{ disabled: sourceLocked }">
            <Upload class="icon-sm" aria-hidden="true" />
            <span>{{ localUploadLabel }}</span>
            <input
              type="file"
              accept="video/mp4,video/*"
              hidden
              :disabled="sourceLocked"
              @change="handleFileSelect"
            />
          </label>
          <button
            type="button"
            class="tool-button"
            :class="{ loading: hotListBusy }"
            :disabled="hotListBusy"
            @click="refreshHotList"
          >
            <RefreshCw class="icon-sm" aria-hidden="true" />
            {{ hotListBusy ? '刷新中' : '刷新榜单' }}
          </button>
          <button type="button" class="tool-button" :disabled="!hasResettableWorkflow" @click="resetWorkflow">
            <RotateCcw class="icon-sm" aria-hidden="true" />
            新任务
          </button>
        </div>
      </div>
    </section>

    <ModalBackdrop v-if="sourcePickerOpen" @close="closeSourcePicker">
      <section class="source-modal" role="dialog" aria-modal="true" aria-label="选择热门素材">
        <div class="modal-heading">
          <div>
            <span class="panel-kicker">Hot List</span>
            <h3>从热门榜单选择素材</h3>
          </div>
          <button type="button" class="mini-button" @click="closeSourcePicker">关闭</button>
        </div>

        <div class="modal-actions">
          <button type="button" class="tool-button" :disabled="hotListBusy" @click="$emit('run-xai')">
            <Search class="icon-sm" aria-hidden="true" />
            {{ xaiLoading ? '正在抓取热门榜单' : '抓取最新热门榜单' }}
          </button>
          <button
            type="button"
            class="tool-button"
            :class="{ loading: hotListBusy }"
            :disabled="hotListBusy"
            @click="refreshHotList"
          >
            <RefreshCw class="icon-sm" aria-hidden="true" />
            {{ hotListBusy ? '刷新中' : '刷新榜单' }}
          </button>
        </div>

        <div
          v-if="hotListBusy"
          :key="`modal-${hotListProgressKey}`"
          class="hot-refresh-progress"
          role="progressbar"
          aria-label="榜单刷新中"
          :aria-valuenow="xaiProgressPercent"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuetext="xaiProgressLabel"
        >
          <span :style="{ width: xaiProgressWidth }"></span>
        </div>
        <div v-if="hotListBusy" class="hot-refresh-status">
          <strong>{{ xaiProgressLabel }}</strong>
          <span>{{ xaiProgressMessage }}</span>
        </div>

        <div v-if="xaiPartitions.length" class="partition-tabs">
          <button
            v-for="partition in xaiPartitions"
            :key="partition.id"
            type="button"
            :class="{ active: partition.id === activePartitionId }"
            @click="selectHotPartition(partition.id)"
          >
            {{ partition.label || partition.id }}
          </button>
        </div>

        <div class="hot-list picker-list">
          <button
            v-for="item in xaiItems"
            :key="itemKey(item)"
            type="button"
            class="hot-row"
            :disabled="sourceLocked"
            @click="useHotItem(item)"
          >
            <span>{{ item.rank || '-' }}</span>
            <strong>{{ hotTitle(item) }}</strong>
            <em>{{ item.views_display || item.hot_score || activePartitionLabel }}</em>
          </button>
          <div v-if="!xaiItems.length" class="empty-row picker-empty">
            <strong>当前 {{ activePartitionLabel }} 分区没有可用素材</strong>
            <span>可以切换上方分区，或重新抓取当前分区。</span>
            <button type="button" class="primary-action" :disabled="hotListBusy" @click="$emit('run-xai')">
              <Search class="icon-sm" aria-hidden="true" />
              {{ xaiLoading ? '正在抓取' : '立即抓取热门榜单' }}
            </button>
          </div>
        </div>

        <label class="tool-button local-upload modal-upload" :class="{ disabled: sourceLocked }">
          <Upload class="icon-sm" aria-hidden="true" />
          <span>没有合适热点时，本地上传备用</span>
          <input
            type="file"
            accept="video/mp4,video/*"
            hidden
            :disabled="sourceLocked"
            @change="handleFileSelect"
          />
        </label>
      </section>
    </ModalBackdrop>

    <ModalBackdrop v-if="selectedHotItem" @close="closeHotDetail">
      <section class="source-modal detail-modal" role="dialog" aria-modal="true" aria-label="热门素材详情">
        <div class="modal-heading">
          <div>
            <span class="panel-kicker">Detail</span>
            <h3>热门素材详情</h3>
          </div>
          <button type="button" class="mini-button" @click="closeHotDetail">关闭</button>
        </div>

        <div class="detail-title">
          <span class="rank-pill">{{ selectedHotItem.rank || '-' }}</span>
          <strong>{{ hotTitle(selectedHotItem) }}</strong>
        </div>

        <div class="detail-grid">
          <div>
            <span>作者</span>
            <strong>{{ hotAuthor(selectedHotItem) }}</strong>
          </div>
          <div>
            <span>发布时间</span>
            <strong>{{ selectedHotItem.published_at || '未知' }}</strong>
          </div>
          <div>
            <span>播放</span>
            <strong>{{ selectedHotItem.views_display || formatNumber(selectedHotItem.views) }}</strong>
          </div>
          <div>
            <span>互动</span>
            <strong>{{ formatNumber(selectedHotItem.likes) }} / {{ formatNumber(selectedHotItem.reposts) }} / {{ formatNumber(selectedHotItem.replies) }}</strong>
          </div>
          <div>
            <span>爆发系数</span>
            <strong>{{ selectedHotItem.breakout_display || '-' }}</strong>
          </div>
          <div>
            <span>视频规格</span>
            <strong>{{ selectedHotItem.video_resolution || '未知' }}</strong>
          </div>
        </div>

        <div class="detail-copy">
          <span>原始摘要</span>
          <p>{{ selectedHotItem.author_summary || selectedHotItem.title || '暂无英文摘要' }}</p>
        </div>

        <div class="detail-copy">
          <span>中文摘要</span>
          <p>{{ selectedHotItem.author_summary_zh || hotTitle(selectedHotItem) }}</p>
        </div>

        <div class="modal-actions">
          <button type="button" class="primary-action" :disabled="sourceLocked" @click="useHotItem(selectedHotItem)">
            <Play class="icon-sm" aria-hidden="true" />
            导入制作视频
          </button>
          <a
            v-if="selectedHotItem.post_url"
            class="tool-button"
            :href="selectedHotItem.post_url"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink class="icon-sm" aria-hidden="true" />
            查看原帖
          </a>
        </div>
      </section>
    </ModalBackdrop>

    <ModalBackdrop v-if="autoPilotModalOpen" @close="closeAutoPilotModal">
      <section class="source-modal autopilot-modal" role="dialog" aria-modal="true" aria-label="无人值守发布配置">
        <div class="modal-heading">
          <div>
            <span class="panel-kicker">Auto-Pilot</span>
            <h3>无人值守发布配置</h3>
          </div>
          <button type="button" class="mini-button" @click="closeAutoPilotModal">关闭</button>
        </div>

        <div class="autopilot-config-strip">
          <label class="toggle-row">
            <input
              type="checkbox"
              :checked="autoPilotEnabled"
              @change="updateAutoPilotField('autoPilotEnabled', $event.target.checked)"
            />
            <span>启用无人值守发布</span>
          </label>
          <label class="toggle-row">
            <input
              type="checkbox"
              :checked="autoPilotUseCurrentRanking"
              @change="updateAutoPilotField('autoPilotUseCurrentRanking', $event.target.checked)"
            />
            <span>使用当前榜单</span>
          </label>
          <label class="field-control compact">
            <span>抓榜时间</span>
            <input
              type="time"
              :value="autoPilotFetchTime"
              :disabled="autoPilotUseCurrentRanking"
              @change="updateAutoPilotField('autoPilotFetchTime', $event.target.value)"
            />
          </label>
        </div>

        <div class="autopilot-summary-list">
          <div v-for="item in autoPilotSummaryItems" :key="item.label" class="summary-row">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>

        <div class="autopilot-mode-list">
          <section class="autopilot-mode-section">
            <div class="mode-section-heading">
              <div>
                <strong>托管计划</strong>
                <span>每条计划单独选择制作方式、发布平台和账号</span>
              </div>
              <button type="button" class="mini-button" @click="addAutoPilotPlan()">
                <Plus class="icon-sm" aria-hidden="true" />
                新增计划
              </button>
            </div>

            <div class="autopilot-plan-editor">
              <div v-for="mapping in autoPilotEditablePlans" :key="mapping.id" class="autopilot-plan-row">
                <div class="plan-row-title">
                  <strong>托管计划 {{ mapping.displayIndex }}</strong>
                  <button type="button" class="mini-button danger-mini" @click="removeAutoPilotPlan(mapping.pipelineMode, mapping.slot)">
                    <Trash2 class="icon-sm" aria-hidden="true" />
                    移除
                  </button>
                </div>

                <div class="field-control select-control" @focusout="handleAutoPilotDropdownFocusout">
                  <span>制作方式</span>
                  <button
                    type="button"
                    class="select-trigger"
                    aria-haspopup="listbox"
                    :aria-expanded="autoPilotDropdownOpen === autoPilotDropdownKey(mapping.id, 'pipeline')"
                    @click="toggleAutoPilotDropdown(autoPilotDropdownKey(mapping.id, 'pipeline'))"
                    @keydown.escape.prevent="closeAutoPilotDropdown"
                  >
                    <strong>{{ mapping.pipelineLabel }}</strong>
                    <ChevronDown class="icon-sm" aria-hidden="true" />
                  </button>
                  <div
                    v-if="autoPilotDropdownOpen === autoPilotDropdownKey(mapping.id, 'pipeline')"
                    class="select-menu"
                    role="listbox"
                  >
                    <button
                      v-for="mode in autoPilotPipelineDefs"
                      :key="mode.key"
                      type="button"
                      class="select-option"
                      :class="{ active: mapping.pipelineMode === mode.key }"
                      role="option"
                      :aria-selected="mapping.pipelineMode === mode.key"
                      @click="selectAutoPilotPipelineMode(mapping, mode.key)"
                    >
                      <span>{{ mode.label }}</span>
                    </button>
                  </div>
                </div>

                <div class="field-control select-control" @focusout="handleAutoPilotDropdownFocusout">
                  <span>榜单分区</span>
                  <button
                    type="button"
                    class="select-trigger"
                    aria-haspopup="listbox"
                    :aria-expanded="autoPilotDropdownOpen === autoPilotDropdownKey(mapping.id, 'partition')"
                    @click="toggleAutoPilotDropdown(autoPilotDropdownKey(mapping.id, 'partition'))"
                    @keydown.escape.prevent="closeAutoPilotDropdown"
                  >
                    <strong>{{ getAutoPilotPartitionLabel(mapping.partitionId) }}</strong>
                    <ChevronDown class="icon-sm" aria-hidden="true" />
                  </button>
                  <div
                    v-if="autoPilotDropdownOpen === autoPilotDropdownKey(mapping.id, 'partition')"
                    class="select-menu"
                    role="listbox"
                  >
                    <button
                      v-for="partition in xaiPartitionOptions"
                      :key="partition.id"
                      type="button"
                      class="select-option"
                      :class="{ active: mapping.partitionId === partition.id }"
                      role="option"
                      :aria-selected="mapping.partitionId === partition.id"
                      @click="selectAutoPilotPartition(mapping.pipelineMode, mapping.slot, partition.id)"
                    >
                      <span>{{ partition.label }}</span>
                    </button>
                  </div>
                </div>
                <label class="field-control">
                  <span>素材排名</span>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    :value="mapping.sourceRank || 1"
                    @change="updateAutoPilotModeValue(mapping.pipelineMode, 'sourceRanks', mapping.slot, $event.target.value)"
                  />
                </label>
                <label class="field-control">
                  <span>发布时间</span>
                  <input type="time" :value="mapping.time" @change="updateAutoPilotModeValue(mapping.pipelineMode, 'times', mapping.slot, $event.target.value)" />
                </label>
                <div class="field-control select-control" @focusout="handleAutoPilotDropdownFocusout">
                  <span>发布平台</span>
                  <button
                    type="button"
                    class="select-trigger"
                    aria-haspopup="listbox"
                    :aria-expanded="autoPilotDropdownOpen === autoPilotDropdownKey(mapping.id, 'platform')"
                    @click="toggleAutoPilotDropdown(autoPilotDropdownKey(mapping.id, 'platform'))"
                    @keydown.escape.prevent="closeAutoPilotDropdown"
                  >
                    <strong>{{ getAutoPilotPlatformLabel(mapping) }}</strong>
                    <ChevronDown class="icon-sm" aria-hidden="true" />
                  </button>
                  <div
                    v-if="autoPilotDropdownOpen === autoPilotDropdownKey(mapping.id, 'platform')"
                    class="select-menu"
                    role="listbox"
                  >
                    <button
                      v-for="platform in autoPilotPlatformDefs"
                      :key="platform.key"
                      type="button"
                      class="select-option"
                      :class="{ active: getAutoPilotPlatformKey(mapping) === platform.key }"
                      role="option"
                      :aria-selected="getAutoPilotPlatformKey(mapping) === platform.key"
                      @click="selectAutoPilotPlatform(mapping.pipelineMode, mapping.slot, platform.key)"
                    >
                      <span>{{ platform.label }}</span>
                    </button>
                  </div>
                </div>

                <div class="field-control select-control" @focusout="handleAutoPilotDropdownFocusout">
                  <span>发布账号</span>
                  <button
                    type="button"
                    class="select-trigger"
                    aria-haspopup="listbox"
                    :aria-expanded="autoPilotDropdownOpen === autoPilotDropdownKey(mapping.id, 'account')"
                    :disabled="!getAutoPilotAccountOptions(getAutoPilotPlatformKey(mapping)).length"
                    @click="toggleAutoPilotDropdown(autoPilotDropdownKey(mapping.id, 'account'))"
                    @keydown.escape.prevent="closeAutoPilotDropdown"
                  >
                    <strong>{{ getAutoPilotAccountLabel(getAutoPilotPlatformKey(mapping), mapping.accountId) }}</strong>
                    <ChevronDown class="icon-sm" aria-hidden="true" />
                  </button>
                  <div
                    v-if="autoPilotDropdownOpen === autoPilotDropdownKey(mapping.id, 'account')"
                    class="select-menu"
                    role="listbox"
                  >
                    <button
                      v-for="account in getAutoPilotAccountOptions(getAutoPilotPlatformKey(mapping))"
                      :key="account.id"
                      type="button"
                      class="select-option"
                      :class="{ active: mapping.accountId === account.id }"
                      role="option"
                      :aria-selected="mapping.accountId === account.id"
                      @click="selectAutoPilotAccount(mapping.pipelineMode, mapping.slot, account.id)"
                    >
                      <span>{{ account.label }}</span>
                    </button>
                    <button
                      v-if="!getAutoPilotAccountOptions(getAutoPilotPlatformKey(mapping)).length"
                      type="button"
                      class="select-option"
                      disabled
                    >
                      <span>暂无账号</span>
                    </button>
                  </div>
                </div>

                <template v-if="mapping.pipelineMode === 'avatar'">
                  <div class="field-control select-control" @focusout="handleAutoPilotDropdownFocusout">
                    <span>声音预设</span>
                    <button
                      type="button"
                      class="select-trigger"
                      aria-haspopup="listbox"
                      :aria-expanded="autoPilotDropdownOpen === autoPilotDropdownKey(mapping.id, 'audio')"
                      @click="toggleAutoPilotDropdown(autoPilotDropdownKey(mapping.id, 'audio'))"
                      @keydown.escape.prevent="closeAutoPilotDropdown"
                    >
                      <strong>{{ getAvatarPresetLabel(mapping.audioPreset) }}</strong>
                      <ChevronDown class="icon-sm" aria-hidden="true" />
                    </button>
                    <div
                      v-if="autoPilotDropdownOpen === autoPilotDropdownKey(mapping.id, 'audio')"
                      class="select-menu"
                      role="listbox"
                    >
                      <button
                        v-for="preset in avatarAudioPresetOptions"
                        :key="preset"
                        type="button"
                        class="select-option"
                        :class="{ active: mapping.audioPreset === preset }"
                        role="option"
                        :aria-selected="mapping.audioPreset === preset"
                        @click="selectAutoPilotPreset(mapping.pipelineMode, mapping.slot, 'audioPresets', preset)"
                      >
                        <span>{{ getAvatarPresetLabel(preset) }}</span>
                      </button>
                    </div>
                  </div>
                  <div class="field-control select-control" @focusout="handleAutoPilotDropdownFocusout">
                    <span>形象预设</span>
                    <button
                      type="button"
                      class="select-trigger"
                      aria-haspopup="listbox"
                      :aria-expanded="autoPilotDropdownOpen === autoPilotDropdownKey(mapping.id, 'image')"
                      @click="toggleAutoPilotDropdown(autoPilotDropdownKey(mapping.id, 'image'))"
                      @keydown.escape.prevent="closeAutoPilotDropdown"
                    >
                      <strong>{{ getAvatarPresetLabel(mapping.imagePreset) }}</strong>
                      <ChevronDown class="icon-sm" aria-hidden="true" />
                    </button>
                    <div
                      v-if="autoPilotDropdownOpen === autoPilotDropdownKey(mapping.id, 'image')"
                      class="select-menu"
                      role="listbox"
                    >
                      <button
                        v-for="preset in avatarImagePresetOptions"
                        :key="preset"
                        type="button"
                        class="select-option"
                        :class="{ active: mapping.imagePreset === preset }"
                        role="option"
                        :aria-selected="mapping.imagePreset === preset"
                        @click="selectAutoPilotPreset(mapping.pipelineMode, mapping.slot, 'imagePresets', preset)"
                      >
                        <span>{{ getAvatarPresetLabel(preset) }}</span>
                      </button>
                    </div>
                  </div>
                </template>
              </div>
              <div v-if="!autoPilotEditablePlans.length" class="empty-row picker-empty">
                <strong>当前暂无托管计划</strong>
                <button type="button" class="tool-button" @click="addAutoPilotPlan()">新增第一条计划</button>
              </div>
            </div>
          </section>
        </div>

        <div class="modal-actions">
          <button type="button" class="tool-button" @click="closeAutoPilotModal">取消</button>
          <button type="button" class="primary-action" :disabled="autoPilotSaving" @click="saveAutoPilotConfig">
            <Save class="icon-sm" aria-hidden="true" />
            {{ autoPilotSaving ? '保存中' : '保存托管配置' }}
          </button>
        </div>
      </section>
    </ModalBackdrop>

    <ModalBackdrop v-if="selectedAssetDetail" @close="closeAssetDetail">
      <section class="source-modal asset-modal" role="dialog" aria-modal="true" aria-label="成品详情">
        <div class="modal-heading">
          <div>
            <span class="panel-kicker">Library</span>
            <h3>成品详情</h3>
          </div>
          <button type="button" class="mini-button" @click="closeAssetDetail">关闭</button>
        </div>

        <div class="asset-detail-body">
          <div class="asset-preview">
            <video
              v-if="selectedAssetDetail.url"
              :src="selectedAssetDetail.url"
              controls
              preload="metadata"
              playsinline
            ></video>
            <div v-else class="empty-row picker-empty">当前成品没有可预览地址</div>
          </div>

          <div class="asset-detail-side">
            <div class="detail-title">
              <span class="rank-pill">{{ selectedAssetDetailIndex }}</span>
              <strong>{{ getAssetTitle(selectedAssetDetail) }}</strong>
            </div>

            <div class="detail-grid asset-detail-grid">
              <div>
                <span>来源</span>
                <strong>{{ selectedAssetDetail.typeLabel || selectedAssetDetail.sourceType || '成品' }}</strong>
              </div>
              <div>
                <span>大小</span>
                <strong>{{ formatFileSize(selectedAssetDetail.sizeBytes) }}</strong>
              </div>
              <div>
                <span>更新时间</span>
                <strong>{{ formatTime(selectedAssetDetail.updatedAt) }}</strong>
              </div>
            </div>

            <div class="detail-copy">
              <span>来源信息</span>
              <p>{{ selectedAssetDetail.sourceMetaLine || selectedAssetDetail.metadata?.sourceSummary || '暂无来源摘要' }}</p>
            </div>

            <div v-if="selectedAssetTags.length" class="asset-tag-list">
              <span v-for="tag in selectedAssetTags" :key="tag">{{ tag }}</span>
            </div>

            <div class="detail-copy">
              <span>文件路径</span>
              <p>{{ selectedAssetDetail.path || '暂无路径' }}</p>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <a
            v-if="selectedAssetDetail.url"
            class="tool-button"
            :href="selectedAssetDetail.url"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink class="icon-sm" aria-hidden="true" />
            打开视频
          </a>
          <button type="button" class="primary-action" @click="useAssetForPublish(selectedAssetDetail)">
            <Send class="icon-sm" aria-hidden="true" />
            用于发布
          </button>
        </div>
      </section>
    </ModalBackdrop>

    <PublishComposerModal
      :open="publishComposerOpen"
      :asset="publishComposerAsset"
      :editor="publishEditor"
      :title="publishComposerTitle"
      :busy="publishComposerBusy"
      :action-mode="publishActionMode"
      :generating-description="publishGeneratingDescription"
      :creating-status-message="publishCreatingStatusMessage"
      :error-state="publishErrorState"
      :account-options="publishComposerAccountOptions"
      :account-label="publishComposerAccountLabel"
      :selected-account-key="selectedPublishComposerAccountKey"
      :account-dropdown-open="publishAccountDropdownOpen"
      @close="closePublishComposer"
      @update-title="publishEditor.title = $event"
      @update-description="publishEditor.description = $event"
      @generate-copy="generatePublishCopy"
      @toggle-account-dropdown="togglePublishAccountDropdown"
      @close-account-dropdown="closePublishAccountDropdown"
      @select-account="selectPublishComposerAccount"
      @create="createPublishFromComposer"
    />

    <div class="cockpit-layout">
      <div class="cockpit-column cockpit-main-column">
        <SourceIntakePanel
          :hot-list-busy="hotListBusy"
          :has-source="Boolean(selectedFile || materialUrl)"
          :partition-menu-open="partitionMenuOpen"
          :active-partition-label="activePartitionLabel"
          :active-partition-id="activePartitionId"
          :xai-partitions="xaiPartitions"
          :xai-loading="xaiLoading"
          :hot-list-progress-key="hotListProgressKey"
          :xai-progress-percent="xaiProgressPercent"
          :xai-progress-label="xaiProgressLabel"
          :xai-progress-width="xaiProgressWidth"
          :xai-progress-message="xaiProgressMessage"
          :displayed-hot-items="displayedHotItems"
          :source-locked="sourceLocked"
          :item-key="itemKey"
          :hot-title="hotTitle"
          :hot-meta-line="hotMetaLine"
          :format-number="formatNumber"
          @partition-menu-focusout="handlePartitionMenuFocusout"
          @toggle-partition-menu="togglePartitionMenu"
          @close-partition-menu="closePartitionMenu"
          @select-partition="selectPartitionFromMenu"
          @run-xai="$emit('run-xai')"
          @refresh-hot-list="refreshHotList"
          @use-hot-item="useHotItem"
          @open-hot-detail="openHotDetail"
          @open-source-picker="openSourcePicker"
        />
        <ProductionProgressPanel
          :steps="steps"
          :current-step="currentStep"
          :progress="displayProgress"
          :progress-label="progressLabel"
          :progress-width="displayProgressWidth"
          :current-step-label="currentStepLabel"
          :duration-label="durationLabel"
          :status-text="productionStatusText"
          :job-active="Boolean(jobId)"
          :final-video-ready="deliveryReady"
          :has-recoverable-failure="hasRecoverableFailure"
          :error-text="combinedErrorText"
          @retry-step="$emit('retry-step', currentStep || 1)"
        />

        <DashboardSupportPanels
          :live-task-items="liveTaskItems"
          :publish-jobs="publishJobs"
          :self-check-summary="selfCheckSummary"
          :self-check-label="selfCheckLabel"
          :self-check-highlights="selfCheckHighlights"
          :visible-logs="visibleLogs"
          :format-time="formatTime"
          :get-publish-job-label="getPublishJobLabel"
          :can-republish-job="canRepublishJob"
          @resume-material-task="resumeMaterialTask"
          @republish-job="republishJob"
        />

      </div>

      <div class="cockpit-column cockpit-side-column">
        <OutputDeliveryPanel
          :output-publish-dropdown-open="outputPublishDropdownOpen"
          :vertical-ready="verticalReady"
          :combined-error-text="combinedErrorText"
          :final-video-label="finalVideoUrl ? '已生成' : jobId ? '生产中' : '待生产'"
          :publish-stats="publishStats"
          :vertical-delivery-label="verticalDeliveryLabel"
          :vertical-error-text="verticalErrorText"
          :final-video-url="finalVideoUrl"
          :vertical-loading="verticalLoading"
          :vertical-delivery-state="verticalDeliveryState"
          :vertical-delivery-title="verticalDeliveryTitle"
          :vertical-delivery-description="verticalDeliveryDescription"
          :vertical-progress="verticalProgress"
          :vertical-progress-width="verticalProgressWidth"
          :delivery-preview-url="deliveryPreviewUrl"
          :publish-composer-busy="publishComposerBusy"
          :publish-composer-account-options="publishComposerAccountOptions"
          :publish-composer-account-label="publishComposerAccountLabel"
          :selected-publish-composer-account-key="selectedPublishComposerAccountKey"
          :can-quick-publish="canQuickPublish"
          :quick-publish-action-label="quickPublishActionLabel"
          @retry-vertical="$emit('retry-vertical')"
          @open-output-preview="openOutputPreview"
          @output-dropdown-focusout="handleOutputPublishDropdownFocusout"
          @toggle-output-dropdown="toggleOutputPublishDropdown"
          @close-output-dropdown="closeOutputPublishDropdown"
          @select-output-account="selectOutputPublishAccount"
          @create-publish="createPublishFromOutput"
        />
        <DashboardSidePanels
          :publish-loading="publishLoading"
          :publish-assets="publishAssets"
          :visible-assets="visibleAssets"
          :latest-asset-time-label="latestAssetTimeLabel"
          :auto-pilot-enabled="autoPilotEnabled"
          :publish-stats="publishStats"
          :auto-pilot-plans="autoPilotPlans"
          :account-cards="accountCards"
          :format-time="formatTime"
          :format-file-size="formatFileSize"
          :get-asset-title="getAssetTitle"
          :can-check-account="canCheckAccount"
          :get-account-action-label="getAccountActionLabel"
          :can-open-account-manager="canOpenAccountManager"
          @refresh-assets="refreshAssetLibrary"
          @open-asset-detail="openAssetDetail"
          @open-autopilot-modal="openAutoPilotModal"
          @add-account-config="openAddAccountConfig"
          @check-login="$emit('check-login', $event)"
          @edit-account-config="openEditAccountConfig"
          @open-account-manager="openAccountManager"
          @delete-account-config="deleteAccountConfig"
        />
      </div>
    </div>

    <ModalBackdrop v-if="accountConfigModal.open" @close="closeAccountConfigModal">
      <section class="source-modal account-config-modal" role="dialog" aria-modal="true" aria-label="账号配置">
        <div class="modal-heading">
          <div>
            <span class="panel-kicker">Account Config</span>
            <h3>{{ accountConfigModal.mode === 'edit' ? '配置账号' : '添加账号' }}</h3>
          </div>
          <button type="button" class="mini-button" @click="closeAccountConfigModal">关闭</button>
        </div>

        <div class="account-config-form">
          <label class="field-control account-config-field">
            <span>平台</span>
            <select
              v-model="accountConfigModal.platformKey"
              class="account-config-input"
              :disabled="accountConfigModal.mode === 'edit'"
              @change="resetAccountConfigForm(accountConfigModal.platformKey)"
            >
              <option v-for="platform in accountPlatformOptions" :key="platform.key" :value="platform.key">
                {{ platform.label }}
              </option>
            </select>
          </label>

          <label v-for="field in accountConfigFields" :key="field.key" class="field-control account-config-field">
            <span>
              {{ field.label }}
              <em v-if="field.required">必填</em>
            </span>
            <input
              v-model="accountConfigModal.form[field.key]"
              :type="field.secret ? 'password' : 'text'"
              :class="['account-config-input', field.required && !String(accountConfigModal.form[field.key] || '').trim() ? 'missing-field' : '']"
              :placeholder="field.placeholder || ''"
            />
          </label>

          <div v-if="accountConfigModal.error" class="issue-box">{{ accountConfigModal.error }}</div>
        </div>

        <div class="modal-actions">
          <button type="button" class="tool-button" :disabled="accountConfigModal.saving" @click="submitAccountConfig">
            <Save class="icon-sm" aria-hidden="true" />
            {{ accountConfigModal.saving ? '保存中' : '保存账号' }}
          </button>
          <button type="button" class="tool-button" @click="closeAccountConfigModal">取消</button>
        </div>
      </section>
    </ModalBackdrop>

    <ModalBackdrop v-if="outputPreviewOpen" @close="closeOutputPreview">
      <section class="source-modal output-preview-modal" role="dialog" aria-modal="true" aria-label="全屏预览">
        <div class="modal-heading">
          <div>
            <span class="panel-kicker">Preview</span>
            <h3>全屏预览</h3>
          </div>
          <button type="button" class="mini-button" @click="closeOutputPreview">关闭</button>
        </div>
        <div ref="outputPreviewFrame" class="output-preview-frame">
          <video
            v-if="deliveryPreviewUrl"
            :src="deliveryPreviewUrl"
            controls
            autoplay
            preload="metadata"
            playsinline
          ></video>
        </div>
      </section>
    </ModalBackdrop>

    <ModalBackdrop
      v-if="qrCodeData.show"
      @close="closeQrCodeModal"
    >
      <section class="source-modal qr-modal" role="dialog" aria-modal="true" aria-label="账号登录">
        <div class="modal-heading">
          <div>
            <span class="panel-kicker">Account Login</span>
            <h3>{{ qrCodeData.accountLabel || '账号登录' }}</h3>
          </div>
          <button type="button" class="mini-button" @click="closeQrCodeModal">关闭</button>
        </div>

        <div class="qr-state-box" :class="`status-${qrCodeData.status || 'loading'}`">
          <div v-if="qrCodeData.status === 'loading'">
            {{ qrCodeData.message || '正在打开登录检测窗口...' }}
          </div>
          <template v-else-if="qrCodeData.status === 'need_scan'">
            <img
              v-if="qrCodeData.base64"
              :src="qrCodeData.base64"
              :alt="`${qrCodeData.accountLabel || '账号'}扫码二维码`"
              class="qr-image"
            />
            <strong>{{ qrCodeData.message || '请在打开的窗口中完成扫码登录' }}</strong>
            <span>确认后系统会继续检测登录状态。</span>
          </template>
          <template v-else-if="qrCodeData.status === 'logged_in'">
            <CheckCircle2 class="icon" aria-hidden="true" />
            <strong>{{ qrCodeData.message || '登录态可用' }}</strong>
          </template>
          <template v-else-if="qrCodeData.status === 'error'">
            <AlertTriangle class="icon" aria-hidden="true" />
            <strong>登录检测失败</strong>
            <span>{{ qrCodeData.error || '请重新登录后再检测。' }}</span>
          </template>
          <template v-else>
            <span>{{ qrCodeData.message || '等待登录状态更新...' }}</span>
          </template>
        </div>

        <div class="modal-actions">
          <button
            v-if="qrCodeData.status === 'error'"
            type="button"
            class="tool-button"
            @click="retryQrLogin"
          >
            <RotateCcw class="icon-sm" aria-hidden="true" />
            重新登录
          </button>
          <button type="button" class="tool-button" @click="closeQrCodeModal">关闭</button>
        </div>
      </section>
    </ModalBackdrop>
  </section>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue';
import GlassPanel from './GlassPanel.vue';
import ModalBackdrop from './ModalBackdrop.vue';
import ProductionProgressPanel from './ProductionProgressPanel.vue';
import DashboardSidePanels from './materialDriven/DashboardSidePanels.vue';
import DashboardSupportPanels from './materialDriven/DashboardSupportPanels.vue';
import OutputDeliveryPanel from './materialDriven/OutputDeliveryPanel.vue';
import PublishComposerModal from './materialDriven/PublishComposerModal.vue';
import SourceIntakePanel from './materialDriven/SourceIntakePanel.vue';
import { useLiveTaskQueue } from './materialDriven/useLiveTaskQueue';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileVideo,
  Gauge,
  Info,
  Layers,
  Maximize2,
  Play,
  Radio,
  RefreshCw,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload
} from 'lucide-vue-next';
const props = defineProps({
  materialDriven: { type: Object, required: true },
  publishCenter: { type: Object, required: true },
  standalone: { type: Object, required: true },
  xai: { type: Object, required: true }
});

const emit = defineEmits([
  'start-automation',
  'continue-workflow',
  'retry-step',
  'reset-workflow',
  'use-xai-material',
  'refresh',
  'run-xai',
  'create-publish-job',
  'run-publish-draft',
  'retry-vertical',
  'resume-material-task',
  'check-login'
]);

const selectedFile = ref(null);
const sourcePickerOpen = ref(false);
const selectedHotItem = ref(null);
const selectedAssetDetail = ref(null);
const publishComposerOpen = ref(false);
const publishComposerAsset = ref(null);
const publishActionMode = ref('');
const publishAccountDropdownOpen = ref(false);
const outputPublishDropdownOpen = ref(false);
const outputPreviewOpen = ref(false);
const outputPreviewFrame = ref(null);
const partitionMenuOpen = ref(false);
const autoPilotModalOpen = ref(false);
const autoPilotDropdownOpen = ref('');
const hotListRefreshing = ref(false);
const hotListProgressKey = ref(0);
const accountConfigModal = ref({
  open: false,
  mode: 'add',
  platformKey: 'wechatChannels',
  accountId: '',
  saving: false,
  error: '',
  form: {}
});

const steps = [
  { id: 1, title: '接入素材', desc: '本地文件或热点素材' },
  { id: 2, title: '理解内容', desc: '识别重点与可用片段' },
  { id: 3, title: '匹配镜头', desc: '挑选候选画面' },
  { id: 4, title: '生成计划', desc: '脚本与剪辑安排' },
  { id: 5, title: '口播成稿', desc: '数字人口播文案' },
  { id: 6, title: '数字人生成', desc: '声音与形象驱动' },
  { id: 7, title: '竖屏交付', desc: '渲染、竖屏合成、入库' }
];

const readValue = (source, key, fallback = '') => {
  const raw = source?.[key];
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return raw.value ?? fallback;
  }
  return raw ?? fallback;
};

const readFunction = (source, key) => {
  const fn = source?.[key];
  return typeof fn === 'function' ? fn : null;
};

const accountRequiredFields = {
  wechatChannels: ['finderUserName', 'helperAccount'],
  douyin: ['sauAccountName'],
  xiaohongshu: ['sauAccountName'],
  x: ['accessToken']
};

const accountFormFields = {
  wechatChannels: [
    { key: 'displayName', label: '账号备注' },
    { key: 'finderUserName', label: '视频号名称', required: true },
    { key: 'helperAccount', label: '视频号助手账号', required: true }
  ],
  douyin: [
    { key: 'displayName', label: '账号备注' },
    { key: 'sauAccountName', label: '登录账号别名', required: true, placeholder: 'douyin_main' }
  ],
  xiaohongshu: [
    { key: 'displayName', label: '账号备注' },
    { key: 'sauAccountName', label: '登录账号别名', required: true, placeholder: 'xhs_main' }
  ],
  x: [
    { key: 'displayName', label: '账号备注' },
    { key: 'username', label: 'X 用户名', placeholder: '不带 @' },
    { key: 'accessToken', label: '访问令牌', required: true, secret: true }
  ]
};

const buildAccountForm = (platformKey, account = {}) => {
  const form = {};
  for (const field of accountFormFields[platformKey] || []) {
    form[field.key] = String(account?.[field.key] ?? '');
  }
  return form;
};

const jobId = computed(() => readValue(props.materialDriven, 'jobId', ''));
const currentStep = computed(() => Number(readValue(props.materialDriven, 'currentStep', 0)) || 0);
const progress = computed(() => Math.max(0, Math.min(100, Number(readValue(props.materialDriven, 'progress', 0)) || 0)));
const statusText = computed(() => String(readValue(props.materialDriven, 'statusText', '') || '').trim());
const finalVideoUrl = computed(() => String(readValue(props.materialDriven, 'finalVideoUrl', '') || '').trim());
const errorText = computed(() => String(readValue(props.materialDriven, 'error', '') || '').trim());
const outputPath = computed(() => String(readValue(props.materialDriven, 'outputPath', '') || '').trim());
const materialUrl = computed(() => String(readValue(props.materialDriven, 'materialUrl', '') || '').trim());
const materialSourceLabel = computed(() => String(readValue(props.materialDriven, 'materialSourceLabel', '') || '').trim());
const activeDurationLabel = computed(() => String(readValue(props.materialDriven, 'activeDurationLabel', '') || '').trim());
const lastDurationLabel = computed(() => String(readValue(props.materialDriven, 'lastDurationLabel', '') || '').trim());
const scriptUnits = computed(() => readValue(props.materialDriven, 'scriptUnits', []));
const materialLogs = computed(() => readValue(props.materialDriven, 'recentLogs', []));
const materialResumingTaskIds = computed(() => readValue(props.materialDriven, 'resumingTaskIds', []));
const gen = computed(() => readValue(props.materialDriven, 'gen', {}));
const uploading = computed(() => Boolean(readValue(props.materialDriven, 'uploading', false)));
const rebuildingPlan = computed(() => Boolean(readValue(props.materialDriven, 'rebuildingPlan', false)));
const rerenderingVideo = computed(() => Boolean(readValue(props.materialDriven, 'rerenderingVideo', false)));

const publishStats = computed(() => readValue(props.publishCenter, 'stats', {
  assetCount: 0,
  jobCount: 0,
  enabledPlatformCount: 0
}));
const publishConfig = computed(() => readValue(props.publishCenter, 'config', {}));
const publishAssets = computed(() => readValue(props.publishCenter, 'assets', []));
const publishCreating = computed(() => Boolean(readValue(props.publishCenter, 'creating', false)));
const publishCreatingStatusMessage = computed(() => readValue(props.publishCenter, 'creatingStatusMessage', ''));
const publishLoading = computed(() => Boolean(readValue(props.publishCenter, 'loading', false)));
const publishGeneratingDescription = computed(() => Boolean(readValue(props.publishCenter, 'generatingDescription', false)));
const publishJobs = computed(() => readValue(props.publishCenter, 'jobs', []).filter((job) => !job.archived).slice(0, 4));
const publishLogs = computed(() => readValue(props.publishCenter, 'recentLogs', []));
const publishErrorState = computed(() => readValue(props.publishCenter, 'errorState', { message: '', code: '', stage: '', hint: '', details: '' }));
const publishEditor = computed(() => readValue(props.publishCenter, 'editor', {
  title: '',
  description: '',
  tagStrategy: 'model',
  tags: '',
  platforms: [],
  platformSelections: {}
}));
const autoPilotPlans = computed(() => readValue(props.publishCenter, 'autoPilotJobs', []).slice(0, 4));
const autoPilotAllPlans = computed(() => readValue(props.publishCenter, 'autoPilotJobs', []));
const autoPilotSummaryItems = computed(() => readValue(props.publishCenter, 'autoPilotSummaryItems', []));
const autoPilotPlatformDefs = computed(() => readValue(props.publishCenter, 'autoPilotPlatformDefs', []));
const autoPilotPipelineDefs = computed(() => readValue(props.publishCenter, 'autoPilotPipelineDefs', []));
const activeAutoPilotPipelineModes = computed(() => readValue(props.publishCenter, 'activeAutoPilotPipelineModes', []));
const activeAutoPilotMappings = computed(() => readValue(props.publishCenter, 'activeAutoPilotMappings', []));
const xaiPartitionOptions = computed(() => readValue(props.publishCenter, 'xaiPartitionOptions', []));
const avatarAudioPresetOptions = computed(() => readValue(props.publishCenter, 'avatarAudioPresetOptions', []));
const avatarImagePresetOptions = computed(() => readValue(props.publishCenter, 'avatarImagePresetOptions', []));
const autoPilotSaving = computed(() => Boolean(readValue(props.publishCenter, 'savingConfig', false)));
const selfCheckSummary = computed(() => readValue(props.publishCenter, 'selfCheckSummary', {
  status: 'unknown',
  okCount: 0,
  warnCount: 0,
  failCount: 0
}));
const selfCheckHighlights = computed(() => readValue(props.publishCenter, 'selfCheckHighlights', []).slice(0, 3));
const platformDefs = computed(() => readValue(props.publishCenter, 'platformDefs', []));
const accountPlatformOptions = computed(() => platformDefs.value.filter((platform) => ['wechatChannels', 'douyin', 'xiaohongshu', 'x'].includes(platform.key)));
const accountConfigFields = computed(() => accountFormFields[accountConfigModal.value.platformKey] || []);
const accountLoginStatus = computed(() => readValue(props.publishCenter, 'accountLoginStatus', {}));
const qrCodeData = computed(() => readValue(props.publishCenter, 'qrCodeData', {
  show: false,
  accountId: '',
  accountLabel: '',
  source: '',
  base64: '',
  qrCodePath: '',
  status: '',
  error: '',
  message: ''
}));

const xaiItems = computed(() => readValue(props.xai, 'items', []));
const hotItems = computed(() => xaiItems.value.slice(0, 5));
const displayedHotItems = computed(() => xaiItems.value);
const xaiLoading = computed(() => Boolean(readValue(props.xai, 'loading', false)));
const hotListBusy = computed(() => Boolean(xaiLoading.value || hotListRefreshing.value));
const xaiProgressPercent = computed(() => Math.max(0, Math.min(100, Number(readValue(props.xai, 'progressPercent', 0)) || 0)));
const xaiProgressMessage = computed(() => String(readValue(props.xai, 'progressMessage', '') || '').trim() || '正在刷新榜单数据');
const xaiProgressLabel = computed(() => `${xaiProgressPercent.value}%`);
const xaiProgressWidth = computed(() => `${Math.max(4, xaiProgressPercent.value)}%`);
const xaiPartitions = computed(() => readValue(props.xai, 'partitions', []));
const activePartitionId = computed(() => String(readValue(props.xai, 'activePartitionId', '')));
const activePartitionLabel = computed(() => String(readValue(props.xai, 'activePartitionLabel', '默认分区')));
const xaiLogs = computed(() => readValue(props.xai, 'recentLogs', []));

const verticalLoading = computed(() => Boolean(readValue(props.standalone, 'loading', false)));
const verticalProgress = computed(() => Math.max(0, Math.min(100, Number(readValue(props.standalone, 'progress', 0)) || 0)));
const verticalStatusText = computed(() => String(readValue(props.standalone, 'statusText', '') || '').trim());
const verticalErrorText = computed(() => String(readValue(props.standalone, 'error', '') || '').trim());
const verticalFinalVideoUrl = computed(() => String(readValue(props.standalone, 'finalVideoUrl', '') || '').trim());
const verticalSourceTaskDir = computed(() => String(readValue(props.standalone, 'lastSourceTaskDir', '') || '').trim());
const verticalLogs = computed(() => readValue(props.standalone, 'recentLogs', []));
const verticalQueueStatus = computed(() => readValue(props.standalone, 'queueStatus', null));
const standaloneDbTasks = computed(() => readValue(props.standalone, 'standaloneTasks', []));
const unifiedDbTasks = computed(() => readValue(props.standalone, 'unifiedTasks', []));

const isBusy = computed(() => uploading.value || rebuildingPlan.value || rerenderingVideo.value);
const sourceLocked = computed(() => Boolean(isBusy.value || jobId.value));
const hasSource = computed(() => Boolean(selectedFile.value || materialUrl.value));
const hasResettableWorkflow = computed(() => Boolean(
  jobId.value
  || finalVideoUrl.value
  || progress.value > 0
  || currentStep.value > 0
  || statusText.value
  || errorText.value
  || outputPath.value
  || materialUrl.value
  || selectedFile.value
));
const scriptUnitCount = computed(() => Array.isArray(scriptUnits.value) ? scriptUnits.value.length : 0);
const autoPilotEnabled = computed(() => Boolean(publishConfig.value?.global?.autoPilotEnabled));
const autoPilotUseCurrentRanking = computed(() => Boolean(publishConfig.value?.global?.autoPilotUseCurrentRanking));
const autoPilotFetchTime = computed(() => String(publishConfig.value?.global?.autoPilotFetchTime || '07:30').trim());
const hasRecoverableFailure = computed(() => Boolean(jobId.value && errorText.value && currentStep.value));
const hasPublishJobs = computed(() => publishJobs.value.length > 0);
const verticalForCurrentTask = computed(() => Boolean(
  verticalFinalVideoUrl.value &&
  (
    outputPath.value
      ? verticalSourceTaskDir.value === outputPath.value
      : true
  )
));
const verticalReady = computed(() => Boolean(finalVideoUrl.value && verticalForCurrentTask.value && !verticalLoading.value));
const deliveryReady = computed(() => Boolean(finalVideoUrl.value && verticalReady.value && !verticalLoading.value && !verticalErrorText.value));
const combinedErrorText = computed(() => errorText.value || (finalVideoUrl.value ? verticalErrorText.value : ''));
const visibleAssets = computed(() => publishAssets.value.slice(0, 8));
const latestAssetTimeLabel = computed(() => publishAssets.value[0]?.updatedAt ? formatTime(publishAssets.value[0].updatedAt) : '暂无');
const selectedAssetDetailIndex = computed(() => {
  const index = publishAssets.value.findIndex((asset) => asset.id === selectedAssetDetail.value?.id);
  return index >= 0 ? index + 1 : 1;
});
const selectedAssetTags = computed(() => {
  const tags = selectedAssetDetail.value?.metadata?.suggestedTags;
  return Array.isArray(tags) ? tags.slice(0, 8) : [];
});
const deliveryAsset = computed(() => {
  const assets = Array.isArray(publishAssets.value) ? publishAssets.value : [];
  if (!assets.length) return null;
  if (outputPath.value) {
    const matched = assets.find((asset) =>
      ['standalone_runtime', 'standalone'].includes(asset.sourceType) &&
      String(asset.metadata?.sourceTaskDir || '').trim() === outputPath.value
    );
    if (matched) return matched;
  }
  if (verticalReady.value) {
    const standaloneAsset = assets.find((asset) => ['standalone_runtime', 'standalone'].includes(asset.sourceType));
    if (standaloneAsset) return standaloneAsset;
  }
  return assets[0] || null;
});
const deliveryPreviewUrl = computed(() => deliveryAsset.value?.url || (verticalReady.value ? verticalFinalVideoUrl.value : finalVideoUrl.value));
const selectedPublishAsset = computed(() =>
  publishComposerAsset.value
  || readValue(props.publishCenter, 'selectedAsset', null)
  || deliveryAsset.value
);
const publishComposerTitle = computed(() => {
  const asset = selectedPublishAsset.value || {};
  return String(
    publishEditor.value?.title
    || asset?.metadata?.suggestedTitle
    || asset?.metadata?.title
    || asset?.compactLabel
    || asset?.label
    || '视频发布'
  ).trim();
});
const publishComposerAccountOptions = computed(() => {
  const defs = Array.isArray(platformDefs.value) ? platformDefs.value : [];
  return defs.flatMap((platform) => getAutoPilotAccountOptions(platform.key).map((account) => ({
    key: `${platform.key}:${account.id}`,
    platformKey: platform.key,
    platformLabel: platform.label || platform.key,
    accountId: account.id,
    accountLabel: account.label || account.id
  })));
});
const selectedPublishComposerAccountKey = computed(() => {
  const selected = Array.isArray(publishEditor.value?.platforms) ? publishEditor.value.platforms : [];
  const platformKey = selected[0] || '';
  const accountId = publishEditor.value?.platformSelections?.[platformKey]?.accountId || '';
  return platformKey && accountId ? `${platformKey}:${accountId}` : '';
});
const publishComposerAccountLabel = computed(() => {
  const selected = publishComposerAccountOptions.value.find((account) => account.key === selectedPublishComposerAccountKey.value);
  if (selected) return `${selected.platformLabel} / ${selected.accountLabel}`;
  return publishComposerAccountOptions.value.length ? '请选择发布账号' : '暂无可用发布账号';
});
const publishComposerBusy = computed(() => Boolean(publishActionMode.value || publishGeneratingDescription.value || publishCreating.value));
const canQuickPublish = computed(() => Boolean(deliveryReady.value && deliveryAsset.value?.id && publishComposerAccountOptions.value.length && !publishComposerBusy.value));

const statusState = computed(() => {
  if (combinedErrorText.value) return 'danger';
  if (verticalLoading.value) return 'running';
  if (deliveryReady.value) return 'ready';
  if (jobId.value) return 'running';
  if (hasSource.value) return 'staged';
  return 'idle';
});

const statusTitle = computed(() => {
  if (combinedErrorText.value) return '当前任务需要处理';
  if (verticalLoading.value) return '竖屏合成中';
  if (deliveryReady.value) return '成片已就绪';
  if (jobId.value) return '自动生产进行中';
  if (hasSource.value) return '素材已接入';
  return '选择素材后自动生产';
});

const statusLabel = computed(() => ({
  danger: '需处理',
  ready: '可交付',
  running: '生产中',
  staged: '待启动',
  idle: '待接入'
}[statusState.value]));

const statusIcon = computed(() => {
  if (statusState.value === 'danger') return AlertTriangle;
  if (statusState.value === 'ready') return CheckCircle2;
  if (statusState.value === 'running') return Activity;
  return FileVideo;
});

const displayProgress = computed(() => {
  if (verticalLoading.value) return Math.min(99, 90 + Math.round(verticalProgress.value * 0.09));
  if (finalVideoUrl.value) return 100;
  return progress.value;
});
const displayProgressWidth = computed(() => `${displayProgress.value}%`);
const progressLabel = computed(() => verticalLoading.value ? `竖屏 ${verticalProgress.value}%` : `${displayProgress.value}%`);
const durationLabel = computed(() => {
  if (jobId.value && !finalVideoUrl.value) return activeDurationLabel.value || '00:00';
  return lastDurationLabel.value || '暂无记录';
});
const currentStepLabel = computed(() => {
  if (verticalLoading.value) return '竖屏合成中';
  if (finalVideoUrl.value) return '制作完成';
  const step = steps.find((item) => item.id === currentStep.value);
  if (step) return step.title;
  return statusText.value || '等待启动';
});
const productionStatusText = computed(() => {
  if (verticalLoading.value) return verticalStatusText.value || '横版成片已生成，正在自动合成竖屏版本';
  if (verticalReady.value) return '竖屏成片已生成，成品库已刷新';
  if (finalVideoUrl.value) return '横版成片已生成，正在准备竖屏合成';
  return statusText.value;
});
const publishReadinessLabel = computed(() => {
  if (verticalLoading.value) return '竖屏合成中';
  if (verticalErrorText.value) return '竖屏需处理';
  if (finalVideoUrl.value && !verticalReady.value) return '等待竖屏入库';
  if (finalVideoUrl.value) return '可创建发布任务';
  return '等待成片';
});
const primaryPublishActionLabel = computed(() => {
  if (verticalLoading.value) return '竖屏合成中';
  if (finalVideoUrl.value && !verticalReady.value) return '等待竖屏入库';
  if (publishCreating.value) return '正在创建发布任务';
  return '生成发布任务';
});
const quickPublishActionLabel = computed(() => {
  if (publishActionMode.value === 'publish') return '正在发布';
  if (publishCreating.value) return '正在创建任务';
  return '一键发布';
});
const verticalProgressWidth = computed(() => `${Math.max(4, verticalProgress.value)}%`);
const verticalDeliveryState = computed(() => {
  if (verticalLoading.value) return 'running';
  if (verticalReady.value) return 'ready';
  if (verticalErrorText.value) return 'danger';
  if (finalVideoUrl.value) return 'pending';
  return 'idle';
});
const verticalDeliveryLabel = computed(() => {
  if (verticalLoading.value) return `${verticalProgress.value}%`;
  if (verticalReady.value) return '已入库';
  if (verticalErrorText.value) return '需处理';
  if (finalVideoUrl.value) return '待合成';
  return '待成片';
});
const verticalDeliveryTitle = computed(() => {
  if (verticalLoading.value) return '正在自动合成竖屏版';
  if (verticalReady.value) return '竖屏成片已进入成品库';
  if (verticalErrorText.value) return '竖屏合成失败';
  return '等待自动竖屏合成';
});
const verticalDeliveryDescription = computed(() => {
  if (verticalLoading.value) return verticalStatusText.value || '系统已把竖屏合成并入最后一步，无需额外点击。';
  if (verticalReady.value) return '发布任务会优先使用刚生成的竖屏成片。';
  if (verticalErrorText.value) return verticalErrorText.value;
  return '横版成片就绪后会自动推进这一段。';
});

const sourceLabel = computed(() => {
  if (selectedFile.value) return selectedFile.value.name;
  if (materialSourceLabel.value) return materialSourceLabel.value;
  if (materialUrl.value) return materialUrl.value;
  return '尚未选择源素材';
});

const localUploadLabel = computed(() => {
  if (jobId.value && !selectedFile.value && !materialUrl.value) return '任务已锁定素材';
  if (selectedFile.value) return selectedFile.value.name;
  if (materialUrl.value) return '已接入热点素材';
  return '本地上传备用';
});

const canStart = computed(() => Boolean(!isBusy.value && !jobId.value && hasSource.value));
const startActionLabel = computed(() => {
  if (isBusy.value) return '正在接入素材';
  if (hasSource.value) return '一键自动生产';
  return '先选择素材';
});

const selfCheckLabel = computed(() => {
  const status = selfCheckSummary.value?.status;
  if (status === 'ok' || status === 'pass') return '运行正常';
  if (status === 'warn') return '存在警告';
  if (status === 'fail' || status === 'error') return '存在失败';
  return '待检测';
});

const accountCards = computed(() => {
  const defs = Array.isArray(platformDefs.value) ? platformDefs.value : [];
  const platformLabel = (key) => defs.find((item) => item.key === key)?.label || key;
  const sources = [
    ['wechatChannels', readValue(props.publishCenter, 'wechatAccounts', [])],
    ['douyin', readValue(props.publishCenter, 'douyinAccounts', [])],
    ['xiaohongshu', readValue(props.publishCenter, 'xiaohongshuAccounts', [])],
    ['x', readValue(props.publishCenter, 'xAccounts', [])]
  ];
  return sources.flatMap(([platformKey, accounts]) => (Array.isArray(accounts) ? accounts : []).map((account) => {
    const accountId = account.id || account.accountId || account.sauAccountName || account.finderUserName || '';
    const statusKey = `${platformKey}:${accountId}`;
    const status = accountLoginStatus.value?.[statusKey] || accountLoginStatus.value?.[accountId] || {};
    return {
      key: statusKey,
      platformKey,
      accountId,
      source: account,
      platformLabel: platformLabel(platformKey),
      label: account.displayName || account.sauAccountName || account.helperAccount || account.finderUserName || accountId || '未命名账号',
      status: status.status || '',
      statusLabel: getAccountStatusLabel(status.status)
    };
  })).filter((item) => item.accountId).slice(0, 6);
});

const getTaskState = (task) => String(task?.runtime?.state || task?.status || '').trim();
const getJobTasks = (job) => Array.isArray(job?.platformTasks) ? job.platformTasks : [];
const getRepublishTask = (job) => getJobTasks(job).find((task) => ['failed', 'cancelled'].includes(getTaskState(task))) || null;
const canRepublishJob = (job) => Boolean(getRepublishTask(job) && readFunction(props.publishCenter, 'retryPlatform'));
const republishJob = async (job) => {
  const task = getRepublishTask(job);
  const retry = readFunction(props.publishCenter, 'retryPlatform');
  if (!task || !retry) return;
  const mode = String(task?.runtime?.publishMode || task?.lastRunMode || (task.platform === 'x' ? 'publish' : 'publish')).trim();
  await retry(job, task.platform, mode);
};

const canCheckAccount = (account) => ['wechatChannels', 'douyin', 'xiaohongshu'].includes(account?.platformKey);
const canOpenAccountManager = (account) => ['wechatChannels', 'douyin', 'xiaohongshu'].includes(account?.platformKey);
const getAccountActionLabel = (account) => {
  if (!canCheckAccount(account)) return '无需扫码';
  if (account?.status === 'checking' || account?.status === 'checking_login') return '检测中';
  if (['need_login', 'need_scan', 'error', 'expired'].includes(account?.status)) return '重新登录';
  return '检测';
};
const openAccountManager = async (account) => {
  if (!canOpenAccountManager(account)) return;
  if (account.platformKey === 'wechatChannels') {
    const fn = readFunction(props.publishCenter, 'openWechatContentManager');
    if (fn) await fn(account.accountId);
    return;
  }
  const fn = readFunction(props.publishCenter, 'openPlatformContentManager');
  if (fn) await fn(account.platformKey, account.accountId);
};

const resetAccountConfigForm = (platformKey = 'wechatChannels', account = {}) => {
  const normalized = accountFormFields[platformKey] ? platformKey : 'wechatChannels';
  accountConfigModal.value.platformKey = normalized;
  accountConfigModal.value.form = buildAccountForm(normalized, account);
  accountConfigModal.value.error = '';
};

const openAddAccountConfig = (platformKey = 'wechatChannels') => {
  accountConfigModal.value.mode = 'add';
  accountConfigModal.value.accountId = '';
  accountConfigModal.value.saving = false;
  resetAccountConfigForm(platformKey);
  accountConfigModal.value.open = true;
};

const openEditAccountConfig = (account) => {
  if (!account?.platformKey || !account?.accountId) return;
  accountConfigModal.value.mode = 'edit';
  accountConfigModal.value.accountId = account.accountId;
  accountConfigModal.value.saving = false;
  resetAccountConfigForm(account.platformKey, account.source || {});
  accountConfigModal.value.open = true;
};

const closeAccountConfigModal = () => {
  if (accountConfigModal.value.saving) return;
  accountConfigModal.value.open = false;
  accountConfigModal.value.error = '';
};

const getAccountConfigError = () => {
  const platformKey = accountConfigModal.value.platformKey;
  const required = accountRequiredFields[platformKey] || [];
  const missing = required.filter((field) => !String(accountConfigModal.value.form[field] || '').trim());
  if (!missing.length) return '';
  const labels = missing.map((field) => (accountFormFields[platformKey] || []).find((item) => item.key === field)?.label || field);
  return `请填写必填信息：${labels.join('、')}`;
};

const saveAccountConfig = async () => {
  const fn = readFunction(props.publishCenter, 'saveConfig');
  if (!fn) return true;
  return await fn('账号配置');
};

const addAccountConfig = async (platformKey = 'wechatChannels', values = {}) => {
  const normalized = String(platformKey || 'wechatChannels');
  const updateConfig = readFunction(props.publishCenter, 'updateConfigField');
  if (updateConfig) updateConfig(normalized, 'enabled', true);
  if (normalized === 'wechatChannels') {
    const fn = readFunction(props.publishCenter, 'addWechatAccount');
    if (fn) fn(values);
    return;
  }
  if (normalized === 'x') {
    const fn = readFunction(props.publishCenter, 'addXAccount');
    if (fn) fn(values);
    return;
  }
  const fn = readFunction(props.publishCenter, 'addSauAccount');
  if (fn) fn(normalized, values);
};

const updateAccountConfig = (platformKey, accountId, values = {}) => {
  if (platformKey === 'wechatChannels') {
    const fn = readFunction(props.publishCenter, 'updateWechatAccountField');
    if (fn) Object.entries(values).forEach(([field, value]) => fn(accountId, field, value));
    return;
  }
  if (platformKey === 'x') {
    const fn = readFunction(props.publishCenter, 'updateXAccountField');
    if (fn) Object.entries(values).forEach(([field, value]) => fn(accountId, field, value));
    return;
  }
  const fn = readFunction(props.publishCenter, 'updateSauAccountField');
  if (fn) Object.entries(values).forEach(([field, value]) => fn(platformKey, accountId, field, value));
};

const removeAccountConfig = (account) => {
  if (account.platformKey === 'wechatChannels') {
    const fn = readFunction(props.publishCenter, 'removeWechatAccount');
    if (fn) fn(account.accountId);
    return;
  }
  if (account.platformKey === 'x') {
    const fn = readFunction(props.publishCenter, 'removeXAccount');
    if (fn) fn(account.accountId);
    return;
  }
  const fn = readFunction(props.publishCenter, 'removeSauAccount');
  if (fn) fn(account.platformKey, account.accountId);
};

const submitAccountConfig = async () => {
  const error = getAccountConfigError();
  if (error) {
    accountConfigModal.value.error = error;
    return;
  }
  const platformKey = accountConfigModal.value.platformKey;
  const values = { ...accountConfigModal.value.form };
  accountConfigModal.value.saving = true;
  accountConfigModal.value.error = '';
  try {
    if (accountConfigModal.value.mode === 'edit') {
      updateAccountConfig(platformKey, accountConfigModal.value.accountId, values);
    } else {
      await addAccountConfig(platformKey, values);
    }
    const saved = await saveAccountConfig();
    if (saved === false) {
      accountConfigModal.value.error = '保存账号配置失败，请查看右侧日志或稍后重试。';
      return;
    }
    accountConfigModal.value.open = false;
  } catch (err) {
    accountConfigModal.value.error = err?.message || '保存账号失败';
  } finally {
    accountConfigModal.value.saving = false;
  }
};

const deleteAccountConfig = async (account) => {
  if (!account?.accountId) return;
  if (!window.confirm(`确定删除「${account.label || account.accountId}」吗？`)) return;
  removeAccountConfig(account);
  await saveAccountConfig();
};
const closeQrCodeModal = () => {
  const fn = readFunction(props.publishCenter, 'closeQrCodeModal');
  if (fn) fn();
};
const retryQrLogin = async () => {
  const fn = readFunction(props.publishCenter, 'retryQrLogin');
  if (fn) await fn();
};

const visibleLogs = computed(() => {
  const merged = [
    ...normalizeLogs(materialLogs.value, '生产'),
    ...normalizeLogs(publishLogs.value, '发布'),
    ...normalizeLogs(verticalLogs.value, '竖屏'),
    ...normalizeLogs(xaiLogs.value, '热点')
  ];
  return merged.slice(-8).reverse().map((item, index) => ({
    id: `${item.time}_${item.message}_${index}`,
    ...item
  }));
});

const autoPilotEditablePlans = computed(() => activeAutoPilotMappings.value
  .slice()
  .sort((a, b) => {
    const aTime = String(a.time || '').localeCompare(String(b.time || ''));
    if (aTime !== 0) return aTime;
    return Number(a.slot || 0) - Number(b.slot || 0);
  })
  .map((mapping, index) => ({
    ...mapping,
    id: `${mapping.pipelineMode}_${mapping.slot}`,
    displayIndex: index + 1
  })));

const handleFileSelect = (event) => {
  selectedFile.value = event.target.files?.[0] || null;
  if (selectedFile.value) {
    sourcePickerOpen.value = false;
    selectedHotItem.value = null;
  }
};

const useHotItem = (item) => {
  selectedFile.value = null;
  emit('use-xai-material', item);
  sourcePickerOpen.value = false;
  selectedHotItem.value = null;
};

const resetWorkflow = () => {
  selectedFile.value = null;
  sourcePickerOpen.value = false;
  selectedHotItem.value = null;
  emit('reset-workflow');
};

const openSourcePicker = () => {
  if (sourceLocked.value) return;
  sourcePickerOpen.value = true;
};

const closeSourcePicker = () => {
  sourcePickerOpen.value = false;
};

const openHotDetail = (item) => {
  selectedHotItem.value = item;
};

const closeHotDetail = () => {
  selectedHotItem.value = null;
};

const openAssetDetail = (asset) => {
  selectedAssetDetail.value = asset;
};

const closeAssetDetail = () => {
  selectedAssetDetail.value = null;
};

const openOutputPreview = async () => {
  if (!deliveryPreviewUrl.value) return;
  outputPreviewOpen.value = true;
  await nextTick();
  const target = outputPreviewFrame.value;
  if (target?.requestFullscreen) {
    try {
      await target.requestFullscreen();
    } catch (_err) {
      // Keep the large preview modal open when browser fullscreen is blocked.
    }
  }
};

const closeOutputPreview = () => {
  outputPreviewOpen.value = false;
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
};

const closePublishComposer = () => {
  if (publishActionMode.value) return;
  publishComposerOpen.value = false;
  publishComposerAsset.value = null;
};

const openAutoPilotModal = () => {
  autoPilotModalOpen.value = true;
};

const closeAutoPilotModal = () => {
  autoPilotModalOpen.value = false;
  autoPilotDropdownOpen.value = '';
};

const autoPilotDropdownKey = (...parts) => parts.join(':');

const toggleAutoPilotDropdown = (key) => {
  autoPilotDropdownOpen.value = autoPilotDropdownOpen.value === key ? '' : key;
};

const closeAutoPilotDropdown = () => {
  autoPilotDropdownOpen.value = '';
};

const closePublishAccountDropdown = () => {
  publishAccountDropdownOpen.value = false;
};

const closeOutputPublishDropdown = () => {
  outputPublishDropdownOpen.value = false;
};

const togglePublishAccountDropdown = () => {
  if (publishComposerBusy.value || !publishComposerAccountOptions.value.length) return;
  outputPublishDropdownOpen.value = false;
  ensurePublishComposerAccountSelection();
  publishAccountDropdownOpen.value = !publishAccountDropdownOpen.value;
};

const toggleOutputPublishDropdown = () => {
  if (publishComposerBusy.value || !publishComposerAccountOptions.value.length) return;
  publishAccountDropdownOpen.value = false;
  ensurePublishComposerAccountSelection();
  outputPublishDropdownOpen.value = !outputPublishDropdownOpen.value;
};

const handleOutputPublishDropdownFocusout = (event) => {
  if (event.currentTarget?.contains(event.relatedTarget)) return;
  closeOutputPublishDropdown();
};

const handleAutoPilotDropdownFocusout = (event) => {
  if (event.currentTarget?.contains(event.relatedTarget)) return;
  closeAutoPilotDropdown();
};

const updateAutoPilotField = (field, value) => {
  const update = readFunction(props.publishCenter, 'updateConfigField');
  if (!update) return;
  update('global', field, value);
};

const updateAutoPilotModeValue = (mode, field, slot, value) => {
  const fn = readFunction(props.publishCenter, 'updateAutoPilotModeArray');
  if (!fn) return;
  fn(mode, field, Number(slot || 1) - 1, value);
};

const ensureAutoPilotPipelineMode = (mode) => {
  const fn = readFunction(props.publishCenter, 'toggleAutoPilotPipelineMode');
  if (fn && !activeAutoPilotPipelineModes.value.includes(mode)) fn(mode, true);
};

const getAutoPilotPlatformKey = (mapping) => mapping?.platformKey || mapping?.platforms?.[0] || autoPilotPlatformDefs.value[0]?.key || 'wechatChannels';

const getAutoPilotPlatformLabel = (mapping) => {
  const platformKey = getAutoPilotPlatformKey(mapping);
  return autoPilotPlatformDefs.value.find((platform) => platform.key === platformKey)?.label || platformKey;
};

const getAutoPilotPartitionLabel = (partitionId) => {
  const normalizedId = String(partitionId || '').trim();
  return xaiPartitionOptions.value.find((partition) => partition.id === normalizedId)?.label || normalizedId || '默认分区';
};

const getAutoPilotAccountOptions = (platformKey) => {
  const fn = readFunction(props.publishCenter, 'getPlatformAccountOptions');
  if (fn) return fn(platformKey);
  if (platformKey === 'wechatChannels') {
    return readValue(props.publishCenter, 'wechatAccounts', []).map((account) => ({
      id: account.id,
      label: account.displayName || account.helperAccount || account.finderUserName || account.id
    }));
  }
  if (platformKey === 'douyin') {
    return readValue(props.publishCenter, 'douyinAccounts', []).map((account) => ({
      id: account.id,
      label: account.displayName || account.sauAccountName || account.accountId || account.openId || account.id
    }));
  }
  if (platformKey === 'xiaohongshu') {
    return readValue(props.publishCenter, 'xiaohongshuAccounts', []).map((account) => ({
      id: account.id,
      label: account.displayName || account.sauAccountName || account.accountId || account.openId || account.id
    }));
  }
  if (platformKey === 'x') {
    return readValue(props.publishCenter, 'xAccounts', []).map((account) => ({
      id: account.id,
      label: account.displayName || account.username || account.userId || account.id
    }));
  }
  return [];
};

const getAutoPilotAccountLabel = (platformKey, accountId) => {
  const fn = readFunction(props.publishCenter, 'getPlatformAccountLabel');
  if (fn) return fn(platformKey, accountId);
  const normalizedId = String(accountId || '').trim();
  return getAutoPilotAccountOptions(platformKey).find((account) => account.id === normalizedId)?.label || normalizedId || '未指定账号';
};

const selectAutoPilotPlatform = (mode, slot, platformKey) => {
  closeAutoPilotDropdown();
  updateAutoPilotModeValue(mode, 'platforms', slot, [platformKey]);
  const firstAccountId = getAutoPilotAccountOptions(platformKey)[0]?.id || '';
  updateAutoPilotModeValue(mode, 'accountIds', slot, firstAccountId);
};

const selectAutoPilotAccount = (mode, slot, accountId) => {
  closeAutoPilotDropdown();
  updateAutoPilotModeValue(mode, 'accountIds', slot, accountId);
};

const selectAutoPilotPartition = (mode, slot, partitionId) => {
  closeAutoPilotDropdown();
  updateAutoPilotModeValue(mode, 'partitionIds', slot, partitionId);
};

const selectAutoPilotPreset = (mode, slot, field, value) => {
  closeAutoPilotDropdown();
  updateAutoPilotModeValue(mode, field, slot, value);
};

const moveAutoPilotPlanMode = (mapping, nextMode) => {
  if (!mapping || mapping.pipelineMode === nextMode) return;
  ensureAutoPilotPipelineMode(nextMode);
  const nextSlotFn = readFunction(props.publishCenter, 'getNextAutoPilotMappingSlot');
  const addFn = readFunction(props.publishCenter, 'addAutoPilotModeMapping');
  const removeFn = readFunction(props.publishCenter, 'removeAutoPilotModeMapping');
  const nextSlot = nextSlotFn ? nextSlotFn(nextMode) : 1;
  if (addFn) addFn(nextMode, nextSlot);
  updateAutoPilotModeValue(nextMode, 'partitionIds', nextSlot, mapping.partitionId);
  updateAutoPilotModeValue(nextMode, 'sourceRanks', nextSlot, mapping.sourceRank || 1);
  updateAutoPilotModeValue(nextMode, 'times', nextSlot, mapping.time);
  updateAutoPilotModeValue(nextMode, 'platforms', nextSlot, [getAutoPilotPlatformKey(mapping)]);
  updateAutoPilotModeValue(nextMode, 'accountIds', nextSlot, mapping.accountId || '');
  if (nextMode === 'avatar') {
    updateAutoPilotModeValue(nextMode, 'audioPresets', nextSlot, mapping.audioPreset || avatarAudioPresetOptions.value[0] || '');
    updateAutoPilotModeValue(nextMode, 'imagePresets', nextSlot, mapping.imagePreset || avatarImagePresetOptions.value[0] || '');
  }
  if (removeFn) removeFn(mapping.pipelineMode, mapping.slot);
  const oldModeHasOtherPlans = activeAutoPilotMappings.value.some((item) =>
    item.pipelineMode === mapping.pipelineMode && Number(item.slot) !== Number(mapping.slot)
  );
  const toggleFn = readFunction(props.publishCenter, 'toggleAutoPilotPipelineMode');
  if (!oldModeHasOtherPlans && toggleFn) toggleFn(mapping.pipelineMode, false);
};

const selectAutoPilotPipelineMode = (mapping, nextMode) => {
  closeAutoPilotDropdown();
  moveAutoPilotPlanMode(mapping, nextMode);
};

const addAutoPilotPlan = (mode = 'avatar') => {
  ensureAutoPilotPipelineMode(mode);
  const nextSlotFn = readFunction(props.publishCenter, 'getNextAutoPilotMappingSlot');
  const addFn = readFunction(props.publishCenter, 'addAutoPilotModeMapping');
  if (!addFn) return;
  addFn(mode, nextSlotFn ? nextSlotFn(mode) : 1);
};

const removeAutoPilotPlan = (mode, slot) => {
  const fn = readFunction(props.publishCenter, 'removeAutoPilotModeMapping');
  if (fn) fn(mode, slot);
};

const getAvatarPresetLabel = (fileName) => {
  const fn = readFunction(props.publishCenter, 'getAvatarPresetLabel');
  if (fn) return fn(fileName);
  return String(fileName || '未选择').replace(/\.[^.]+$/u, '');
};

const saveAutoPilotConfig = async () => {
  const fn = readFunction(props.publishCenter, 'saveConfig');
  if (!fn) return;
  await fn('托管配置');
};

const refreshAssetLibrary = async () => {
  const fn = readFunction(props.publishCenter, 'refresh');
  if (fn) await fn(true, { silent: true, preserveEditor: true });
};

const useAssetForPublish = async (asset) => {
  if (!asset?.id) return;
  publishComposerAsset.value = asset;
  const fn = readFunction(props.publishCenter, 'selectAsset');
  if (fn) await fn(asset.id);
  publishEditor.value.title = publishComposerTitle.value;
  publishEditor.value.tagStrategy = 'model';
  publishEditor.value.tags = '';
  ensurePublishComposerAccountSelection();
  closeAssetDetail();
  publishComposerOpen.value = true;
};

const setPublishComposerAccount = (platformKey, accountId) => {
  if (!publishEditor.value.platformSelections) {
    publishEditor.value.platformSelections = {};
  }
  if (!publishEditor.value.platformSelections[platformKey]) {
    publishEditor.value.platformSelections[platformKey] = { accountId: '' };
  }
  publishEditor.value.platforms = [platformKey];
  publishEditor.value.platformSelections[platformKey].accountId = accountId;
};

const ensurePublishComposerAccountSelection = () => {
  if (publishComposerAccountOptions.value.some((account) => account.key === selectedPublishComposerAccountKey.value)) return;
  const firstAccount = publishComposerAccountOptions.value[0];
  if (firstAccount) setPublishComposerAccount(firstAccount.platformKey, firstAccount.accountId);
};

const selectPublishComposerAccount = (account) => {
  if (!account) return;
  closePublishAccountDropdown();
  setPublishComposerAccount(account.platformKey, account.accountId);
};

const selectOutputPublishAccount = (account) => {
  if (!account) return;
  closeOutputPublishDropdown();
  setPublishComposerAccount(account.platformKey, account.accountId);
};

const generatePublishCopy = async () => {
  if (publishComposerBusy.value) return;
  publishEditor.value.tagStrategy = 'model';
  publishEditor.value.tags = '';
  const generateDescription = readFunction(props.publishCenter, 'generateEditorDescription');
  if (generateDescription) await generateDescription();
};

const createPublishFromComposer = async (mode = 'draft') => {
  if (publishActionMode.value) return;
  const createJob = readFunction(props.publishCenter, 'createJob');
  const runPlatform = readFunction(props.publishCenter, 'runPlatform');
  if (!createJob) return;
  publishActionMode.value = mode;
  try {
    publishEditor.value.title = publishComposerTitle.value;
    publishEditor.value.tagStrategy = 'model';
    publishEditor.value.tags = '';
    ensurePublishComposerAccountSelection();
    const job = await createJob();
    if (job && runPlatform && ['draft', 'publish'].includes(mode)) {
      const tasks = Array.isArray(job.platformTasks) ? job.platformTasks : [];
      let startedAll = true;
      for (const task of tasks) {
        if (task?.platform) {
          const started = await runPlatform(job, task.platform, mode);
          if (!started) startedAll = false;
        }
      }
      if (!startedAll) return;
    }
    if (job) {
      publishComposerOpen.value = false;
      publishComposerAsset.value = null;
    }
  } finally {
    publishActionMode.value = '';
  }
};

const createPublishFromOutput = async (mode = 'publish') => {
  if (!deliveryAsset.value?.id || publishActionMode.value) return;
  publishComposerAsset.value = deliveryAsset.value;
  const selectAsset = readFunction(props.publishCenter, 'selectAsset');
  if (selectAsset) await selectAsset(deliveryAsset.value.id);
  publishEditor.value.title = publishComposerTitle.value;
  await createPublishFromComposer(mode);
  publishComposerAsset.value = null;
};

const selectHotPartition = async (partitionId) => {
  const selectPartition = readFunction(props.xai, 'selectPartition');
  if (!selectPartition) return;
  await selectPartition(partitionId);
};

const togglePartitionMenu = () => {
  if (!xaiPartitions.value.length) return;
  partitionMenuOpen.value = !partitionMenuOpen.value;
};

const closePartitionMenu = () => {
  partitionMenuOpen.value = false;
};

const handlePartitionMenuFocusout = (event) => {
  if (event.currentTarget?.contains(event.relatedTarget)) return;
  closePartitionMenu();
};

const selectPartitionFromMenu = async (partitionId) => {
  closePartitionMenu();
  await selectHotPartition(partitionId);
};

const refreshHotList = async () => {
  if (hotListBusy.value) return;
  const run = readFunction(props.xai, 'run');
  const refresh = readFunction(props.xai, 'refresh');
  const startedAt = Date.now();
  hotListRefreshing.value = true;
  hotListProgressKey.value += 1;
  try {
    if (run) {
      await run();
    } else if (refresh) {
      await refresh(false);
    } else {
      emit('refresh');
    }
  } finally {
    const remainingMs = run ? 0 : Math.max(0, 900 - (Date.now() - startedAt));
    window.setTimeout(() => {
      hotListRefreshing.value = false;
    }, remainingMs);
  }
};

const emitStart = () => {
  if (!canStart.value) return;
  emit('start-automation', {
    file: selectedFile.value,
    config: {
      useSmartClip: true,
      autoGenerate: true,
      outputDir: ''
    },
    manualScript: gen.value?.text || ''
  });
};

const itemKey = (item) => String(item?.post_id || item?.id || item?.rank || item?.video_url || Math.random());

const hotTitle = (item) => {
  const title = String(item?.author_summary_zh || item?.title || item?.post_title || item?.author_summary || '').trim();
  return title || '未命名热点';
};

const hotAuthor = (item) => {
  const author = String(item?.author || '').trim();
  return author ? `@${author}` : '未知作者';
};

const hotMetaLine = (item) => {
  const pieces = [
    hotAuthor(item),
    item?.published_at || '',
    item?.video_resolution || '',
    item?.source_partition_label || activePartitionLabel.value
  ].filter(Boolean);
  return pieces.join(' · ');
};

const formatNumber = (value) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '-';
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
  if (number >= 1000) return `${Math.round(number / 1000)}K`;
  return String(number);
};

const formatFileSize = (value) => {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return '-';
  if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.round(size / 1024)}KB`;
  return `${size}B`;
};

const getAssetTitle = (asset) => String(
  asset?.displayLabel ||
  asset?.compactLabel ||
  asset?.metadata?.suggestedTitle ||
  asset?.label ||
  '未命名成品'
).trim();

const getPublishJobLabel = (job) => {
  const fn = readFunction(props.publishCenter, 'getJobStatusLabel');
  return fn ? fn(job) : String(job?.status || '待处理');
};

const getAccountStatusLabel = (status) => {
  if (status === 'logged_in') return '已登录';
  if (status === 'checking' || status === 'checking_login') return '检测中';
  if (status === 'need_scan' || status === 'need_login') return '需登录';
  if (status === 'error') return '异常';
  return '检查';
};

const normalizeLogs = (logs, source) => {
  if (!Array.isArray(logs)) return [];
  return logs.map((item, index) => {
    if (typeof item === 'string') {
      const matched = item.match(/^\[([^\]]+)\]\s*(.*)$/);
      return {
        time: matched?.[1] || source,
        message: matched?.[2] || item
      };
    }
    return {
      time: item.time || source || '--',
      message: String(item.message || item.text || item || index).trim()
    };
  }).filter((item) => item.message);
};

const formatTime = (value) => {
  if (!value) return '未设定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
};

const { liveTaskItems, createResumePayload } = useLiveTaskQueue({
  jobId,
  outputPath,
  activeMaterialTasks: computed(() => readValue(props.materialDriven, 'activeTasks', [])),
  selectedFile,
  uploading,
  rebuildingPlan,
  rerenderingVideo,
  finalVideoUrl,
  materialSourceLabel,
  combinedErrorText,
  currentStepLabel,
  productionStatusText,
  statusText,
  displayProgress,
  materialResumingTaskIds,
  xaiLoading,
  activePartitionId,
  activePartitionLabel,
  xaiProgressMessage,
  xaiProgressPercent,
  xaiProgressLabel,
  verticalLoading,
  verticalSourceTaskDir,
  verticalErrorText,
  verticalStatusText,
  verticalProgress,
  standaloneActiveDurationLabel: computed(() => readValue(props.standalone, 'activeDurationLabel', '')),
  standaloneDbTasks,
  unifiedDbTasks,
  verticalQueueStatus,
  publishJobs: computed(() => readValue(props.publishCenter, 'jobs', [])),
  platformDefs,
  formatTime,
  getPublishJobLabel
});

const resumeMaterialTask = (item) => {
  const payload = createResumePayload(item);
  if (payload) emit('resume-material-task', payload);
};

</script>

<style scoped src="./AutomationDashboard.css"></style>

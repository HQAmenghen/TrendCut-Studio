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

    <ModalBackdrop v-if="publishComposerOpen" @close="closePublishComposer">
      <section class="source-modal publish-composer-modal" role="dialog" aria-modal="true" aria-label="发布信息">
        <div class="modal-heading">
          <div>
            <span class="panel-kicker">Publish</span>
            <h3>发布信息</h3>
          </div>
          <button type="button" class="mini-button" :disabled="publishComposerBusy" @click="closePublishComposer">关闭</button>
        </div>

        <div class="publish-composer-grid">
          <div class="publish-composer-preview">
            <video
              v-if="publishComposerAsset?.url"
              :src="publishComposerAsset.url"
              controls
              preload="metadata"
              playsinline
            ></video>
            <div v-else class="empty-row picker-empty">当前成品没有可预览地址</div>
          </div>

          <div class="publish-composer-form">
            <label class="field-control">
              <span>发布标题</span>
              <input
                :value="publishEditor.title || publishComposerTitle"
                type="text"
                placeholder="默认从成品元数据读取，可手动修改。"
                :disabled="publishComposerBusy"
                @input="publishEditor.title = $event.target.value"
              />
            </label>

            <label class="field-control">
              <span class="field-control-row">
                <span>发布文案</span>
                <button
                  type="button"
                  class="tool-button compact"
                  :disabled="publishComposerBusy"
                  @click="generatePublishCopy"
                >
                  <Sparkles class="icon-sm" aria-hidden="true" />
                  {{ publishGeneratingDescription ? '生成中' : '生成文案和标签' }}
                </button>
              </span>
              <textarea
                rows="8"
                :value="publishEditor.description || ''"
                placeholder="文案由大模型生成，标签会随文案一起写入。"
                @input="publishEditor.description = $event.target.value"
              ></textarea>
            </label>

            <div class="publish-target-list">
              <span class="panel-kicker">发布账号</span>
              <div class="field-control select-control publish-account-select" @focusout="handlePublishAccountDropdownFocusout">
                <button
                  type="button"
                  class="select-trigger"
                  aria-haspopup="listbox"
                  :aria-expanded="publishAccountDropdownOpen"
                  :disabled="publishComposerBusy || !publishComposerAccountOptions.length"
                  @click="togglePublishAccountDropdown"
                  @keydown.escape.prevent="closePublishAccountDropdown"
                >
                  <strong>{{ publishComposerAccountLabel }}</strong>
                  <ChevronDown class="icon-sm" aria-hidden="true" />
                </button>
                <div
                  v-if="publishAccountDropdownOpen"
                  class="select-menu"
                  role="listbox"
                >
                  <button
                    v-for="account in publishComposerAccountOptions"
                    :key="account.key"
                    type="button"
                    class="select-option account-select-option"
                    :class="{ active: selectedPublishComposerAccountKey === account.key }"
                    role="option"
                    :aria-selected="selectedPublishComposerAccountKey === account.key"
                    @click="selectPublishComposerAccount(account)"
                  >
                    <span>{{ account.platformLabel }}</span>
                    <strong>{{ account.accountLabel }}</strong>
                  </button>
                </div>
              </div>
              <div v-if="!publishComposerAccountOptions.length" class="empty-row">还没有配置可用发布账号。</div>
            </div>

            <div v-if="publishCreatingStatusMessage" class="publish-composer-feedback pending">
              {{ publishCreatingStatusMessage }}
            </div>
            <div v-if="publishErrorState.message" class="publish-composer-feedback error">
              <strong>{{ publishErrorState.message }}</strong>
              <span v-if="publishErrorState.code">错误码：{{ publishErrorState.code }}</span>
              <span v-if="publishErrorState.hint">{{ publishErrorState.hint }}</span>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="tool-button" :disabled="publishComposerBusy" @click="closePublishComposer">取消</button>
          <button type="button" class="tool-button" :disabled="publishComposerBusy" @click="createPublishFromComposer('draft')">
            <ClipboardList class="icon-sm" aria-hidden="true" />
            {{ publishActionMode === 'draft' ? '正在创建草稿' : '创建草稿' }}
          </button>
          <button type="button" class="primary-action" :disabled="publishComposerBusy" @click="createPublishFromComposer('publish')">
            <Rocket class="icon-sm" aria-hidden="true" />
            {{ publishActionMode === 'publish' ? '正在发布' : '创建并发布' }}
          </button>
        </div>
      </section>
    </ModalBackdrop>

    <div class="cockpit-layout">
      <div class="cockpit-column cockpit-main-column">
        <GlassPanel class="ops-panel intake-panel" :aria-busy="hotListBusy" allow-overflow>
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Source</span>
            <h3>素材接入</h3>
          </div>
          <span class="state-chip" :class="{ on: Boolean(selectedFile || materialUrl) }">
            {{ selectedFile || materialUrl ? '已接入' : '待接入' }}
          </span>
        </div>

        <div class="source-toolbar">
          <div class="partition-select" @focusout="handlePartitionMenuFocusout">
            <span>榜单分区</span>
            <button
              type="button"
              class="partition-trigger"
              aria-haspopup="listbox"
              :aria-expanded="partitionMenuOpen"
              @click="togglePartitionMenu"
              @keydown.escape.prevent="closePartitionMenu"
            >
              <strong>{{ activePartitionLabel }}</strong>
              <ChevronDown class="icon-sm" aria-hidden="true" />
            </button>
            <div v-if="partitionMenuOpen" class="partition-menu" role="listbox">
              <button
                v-for="partition in xaiPartitions"
                :key="partition.id"
                type="button"
                class="partition-option"
                role="option"
                :aria-selected="partition.id === activePartitionId"
                :class="{ active: partition.id === activePartitionId }"
                @click="selectPartitionFromMenu(partition.id)"
              >
                <span>{{ partition.label || partition.id }}</span>
              </button>
            </div>
          </div>
          <button type="button" class="tool-button" :disabled="hotListBusy" @click="$emit('run-xai')">
            <Search class="icon-sm" aria-hidden="true" />
            {{ xaiLoading ? '抓取中' : '抓取榜单' }}
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
          :key="`source-${hotListProgressKey}`"
          class="hot-refresh-progress source-refresh-progress"
          role="progressbar"
          aria-label="榜单刷新中"
          :aria-valuenow="xaiProgressPercent"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuetext="xaiProgressLabel"
        >
          <span :style="{ width: xaiProgressWidth }"></span>
        </div>
        <div v-if="hotListBusy" class="hot-refresh-status source-refresh-status">
          <strong>{{ xaiProgressLabel }}</strong>
          <span>{{ xaiProgressMessage }}</span>
        </div>

        <div class="source-hot-list">
          <article
            v-for="item in displayedHotItems"
            :key="itemKey(item)"
            class="source-hot-card"
          >
            <div class="rank-pill">{{ item.rank || '-' }}</div>
            <div class="hot-main">
              <strong>{{ hotTitle(item) }}</strong>
              <span>{{ hotMetaLine(item) }}</span>
              <div class="hot-stats">
                <em>{{ item.views_display || formatNumber(item.views) }} 播放</em>
                <em>{{ formatNumber(item.likes) }} 赞</em>
                <em>{{ formatNumber(item.reposts) }} 转</em>
                <em>{{ item.breakout_display || '常规' }}</em>
                <em>热度 {{ item.hot_score || '-' }}</em>
              </div>
            </div>
            <div class="hot-actions">
              <button type="button" class="mini-button" :disabled="sourceLocked" @click="useHotItem(item)">
                <Play class="icon-sm" aria-hidden="true" />
                导入制作
              </button>
              <button type="button" class="mini-button subtle" @click="openHotDetail(item)">
                <Info class="icon-sm" aria-hidden="true" />
                详情
              </button>
            </div>
          </article>
          <div v-if="!displayedHotItems.length" class="empty-row picker-empty">
            <strong>当前 {{ activePartitionLabel }} 分区暂无素材</strong>
            <button type="button" class="tool-button" @click="openSourcePicker">
              <Search class="icon-sm" aria-hidden="true" />
              切换榜单分区
            </button>
            <button type="button" class="tool-button" :disabled="hotListBusy" @click="$emit('run-xai')">
              <Search class="icon-sm" aria-hidden="true" />
              {{ xaiLoading ? '抓取中' : '抓取热门榜单' }}
            </button>
          </div>
        </div>
        </GlassPanel>

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

        <section class="support-section cockpit-support-section">
          <div class="support-grid">
            <GlassPanel class="ops-panel support-panel live-queue-panel">
              <div class="support-card-heading">
                <div>
                  <span class="panel-kicker">Live Queue</span>
                  <h3>实时任务队列</h3>
                </div>
                <span class="support-status" :class="{ active: activeTaskCount > 0 }">
                  {{ liveTaskSummaryLabel }}
                </span>
              </div>

              <div class="support-body">
                <div class="task-queue-list">
                  <div
                    v-for="item in liveTaskItems"
                    :key="item.id"
                    class="task-queue-row"
                    :class="`state-${item.state}`"
                  >
                    <span class="task-type-pill">{{ item.type }}</span>
                    <div class="task-queue-main">
                      <div class="task-queue-title">
                        <strong>{{ item.title }}</strong>
                        <em>{{ item.statusLabel }}</em>
                      </div>
                      <span>{{ item.detail }}</span>
                      <div v-if="item.progress !== null" class="mini-progress-rail">
                        <span :style="{ width: `${Math.max(3, item.progress)}%` }"></span>
                      </div>
                    </div>
                    <div class="task-queue-side">
                      <button
                        v-if="item.action === 'resume-material'"
                        type="button"
                        class="mini-button task-action-button"
                        :disabled="item.actionBusy"
                        @click="resumeMaterialTask(item)"
                      >
                        <RefreshCw v-if="item.actionBusy" class="icon-sm spin-icon" aria-hidden="true" />
                        <Play v-else class="icon-sm" aria-hidden="true" />
                        {{ item.actionBusy ? '恢复中' : '继续' }}
                      </button>
                      <span class="task-queue-meta">{{ item.meta }}</span>
                    </div>
                  </div>
                  <div v-if="!liveTaskItems.length" class="empty-row">暂无运行任务</div>
                </div>
              </div>
            </GlassPanel>

            <GlassPanel class="ops-panel support-panel publish-panel">
              <div class="support-card-heading">
                <div>
                  <span class="panel-kicker">Delivery</span>
                  <h3>发布队列</h3>
                </div>
                <span class="support-status">{{ publishJobs.length ? `${publishJobs.length} 个任务` : '暂无任务' }}</span>
              </div>

              <div class="support-body">
                <div class="plan-list">
                  <div v-for="job in publishJobs" :key="job.id" class="plan-row">
                    <div>
                      <strong>{{ job.asset?.label || job.asset?.compactLabel || job.title || job.id }}</strong>
                      <span>{{ formatTime(job.scheduledAt) }}</span>
                    </div>
                    <div class="support-row-actions">
                      <span>{{ getPublishJobLabel(job) }}</span>
                      <button
                        v-if="canRepublishJob(job)"
                        type="button"
                        class="mini-button"
                        @click="republishJob(job)"
                      >
                        重新发布
                      </button>
                    </div>
                  </div>
                  <div v-if="!publishJobs.length" class="empty-row">暂无发布任务</div>
                </div>
              </div>
            </GlassPanel>

            <GlassPanel class="ops-panel support-panel health-panel">
              <div class="support-card-heading">
                <div>
                  <span class="panel-kicker">Health</span>
                  <h3>系统健康</h3>
                </div>
                <span class="support-status">
                  <span :class="`health-dot status-${selfCheckSummary.status}`"></span>
                  {{ selfCheckLabel }}
                </span>
              </div>

              <div class="support-body">
                <div class="health-score">
                  <span :class="`health-dot status-${selfCheckSummary.status}`"></span>
                  <strong>{{ selfCheckLabel }}</strong>
                  <span>通过 {{ selfCheckSummary.okCount || 0 }} / 警告 {{ selfCheckSummary.warnCount || 0 }} / 失败 {{ selfCheckSummary.failCount || 0 }}</span>
                </div>

                <div class="issue-list">
                  <div v-for="item in selfCheckHighlights" :key="`${item.groupLabel}_${item.key}`" class="issue-row">
                    <strong>{{ item.label }}</strong>
                    <span>{{ item.details || item.hint || item.groupLabel }}</span>
                  </div>
                  <div v-if="!selfCheckHighlights.length" class="empty-row">暂无高优先级异常</div>
                </div>
              </div>
            </GlassPanel>

            <GlassPanel class="ops-panel support-panel activity-panel">
              <div class="support-card-heading">
                <div>
                  <span class="panel-kicker">Activity</span>
                  <h3>最近运行</h3>
                </div>
                <span class="support-status">{{ visibleLogs.length ? `${visibleLogs.length} 条记录` : '暂无记录' }}</span>
              </div>

              <div class="support-body">
                <div class="log-list">
                  <div v-for="line in visibleLogs" :key="line.id" class="log-row">
                    <span>{{ line.time }}</span>
                    <strong>{{ line.message }}</strong>
                  </div>
                  <div v-if="!visibleLogs.length" class="empty-row">暂无运行记录</div>
                </div>
              </div>
            </GlassPanel>
          </div>
        </section>

      </div>

      <div class="cockpit-column cockpit-side-column">
        <GlassPanel class="ops-panel output-panel" :class="{ 'output-panel-open': outputPublishDropdownOpen }" allow-overflow>
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Output</span>
            <h3>成片交付</h3>
          </div>
          <CheckCircle2 v-if="verticalReady" class="panel-mark ready" aria-hidden="true" />
          <AlertTriangle v-else-if="combinedErrorText" class="panel-mark danger" aria-hidden="true" />
        </div>

        <div class="output-summary">
          <div class="output-metric">
            <span>成片</span>
            <strong>{{ finalVideoUrl ? '已生成' : jobId ? '生产中' : '待生产' }}</strong>
          </div>
          <div class="output-metric">
            <span>发布任务</span>
            <strong>{{ publishStats.jobCount }}</strong>
          </div>
          <div class="output-metric">
            <span>竖屏合成</span>
            <strong>{{ verticalDeliveryLabel }}</strong>
          </div>
        </div>

        <div v-if="combinedErrorText" class="failure-box">
          <AlertTriangle class="icon" aria-hidden="true" />
          <div>
            <strong>最近失败</strong>
            <span>{{ combinedErrorText }}</span>
            <div v-if="verticalErrorText && finalVideoUrl" class="failure-actions">
              <button type="button" class="mini-button danger-mini" :disabled="verticalLoading" @click="$emit('retry-vertical')">
                <RotateCcw class="icon-sm" aria-hidden="true" />
                重试竖屏合成
              </button>
            </div>
          </div>
        </div>

        <div v-if="finalVideoUrl" class="vertical-delivery-card" :class="`state-${verticalDeliveryState}`">
          <div class="vertical-delivery-copy">
            <Activity v-if="verticalLoading" class="icon-sm" aria-hidden="true" />
            <CheckCircle2 v-else-if="verticalReady" class="icon-sm" aria-hidden="true" />
            <AlertTriangle v-else-if="verticalErrorText" class="icon-sm" aria-hidden="true" />
            <Sparkles v-else class="icon-sm" aria-hidden="true" />
            <div>
              <strong>{{ verticalDeliveryTitle }}</strong>
              <span>{{ verticalDeliveryDescription }}</span>
            </div>
          </div>
          <div v-if="verticalLoading" class="vertical-progress-rail" role="progressbar" :aria-valuenow="verticalProgress" aria-valuemin="0" aria-valuemax="100">
            <span :style="{ width: verticalProgressWidth }"></span>
          </div>
          <div v-if="verticalErrorText" class="vertical-retry-actions">
            <button type="button" class="tool-button compact" :disabled="verticalLoading" @click="$emit('retry-vertical')">
              <RotateCcw class="icon-sm" aria-hidden="true" />
              重新合成竖屏
            </button>
          </div>
        </div>

        <div class="output-workbench">
          <div class="output-preview" :class="{ running: verticalLoading }">
            <video
              v-if="deliveryPreviewUrl"
              :src="deliveryPreviewUrl"
              controls
              preload="metadata"
              playsinline
            ></video>
            <div v-else class="empty-row">等待成片预览</div>
          </div>

          <div class="quick-publish-box">
            <div class="quick-publish-heading">
              <div>
                <span class="panel-kicker">Quick Publish</span>
                <strong>发布目标</strong>
              </div>
              <button
                v-if="deliveryPreviewUrl"
                type="button"
                class="mini-button"
                @click="openOutputPreview"
              >
                <Maximize2 class="icon-sm" aria-hidden="true" />
                全屏预览
              </button>
            </div>

            <div class="field-control select-control output-account-select" @focusout="handleOutputPublishDropdownFocusout">
              <span>平台 / 账号</span>
              <button
                type="button"
                class="select-trigger"
                aria-haspopup="listbox"
                :aria-expanded="outputPublishDropdownOpen"
                :disabled="publishComposerBusy || !publishComposerAccountOptions.length"
                @click="toggleOutputPublishDropdown"
                @keydown.escape.prevent="closeOutputPublishDropdown"
              >
                <strong>{{ publishComposerAccountLabel }}</strong>
                <ChevronDown class="icon-sm" aria-hidden="true" />
              </button>
              <div
                v-if="outputPublishDropdownOpen"
                class="select-menu"
                role="listbox"
              >
                <button
                  v-for="account in publishComposerAccountOptions"
                  :key="`output_${account.key}`"
                  type="button"
                  class="select-option account-select-option"
                  :class="{ active: selectedPublishComposerAccountKey === account.key }"
                  role="option"
                  :aria-selected="selectedPublishComposerAccountKey === account.key"
                  @click="selectOutputPublishAccount(account)"
                >
                  <span>{{ account.platformLabel }}</span>
                  <strong>{{ account.accountLabel }}</strong>
                </button>
              </div>
            </div>

            <button
              type="button"
              class="primary-action quick-publish-action"
              :class="{ waiting: !canQuickPublish }"
              :disabled="!canQuickPublish"
              @click="createPublishFromOutput('publish')"
            >
              <Rocket class="icon-sm" aria-hidden="true" />
              {{ quickPublishActionLabel }}
            </button>
          </div>
        </div>
        </GlassPanel>

        <GlassPanel class="ops-panel asset-library-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Library</span>
            <h3>成品库</h3>
          </div>
          <button type="button" class="mini-button" :disabled="publishLoading" @click="refreshAssetLibrary">
            <RefreshCw class="icon-sm" aria-hidden="true" />
            刷新
          </button>
        </div>

        <div class="compact-stats asset-library-stats">
          <div>
            <span>成品</span>
            <strong>{{ publishAssets.length }}</strong>
          </div>
          <div>
            <span>最新</span>
            <strong>{{ latestAssetTimeLabel }}</strong>
          </div>
        </div>

        <div class="asset-list">
          <button
            v-for="asset in visibleAssets"
            :key="asset.id"
            type="button"
            class="asset-row"
            @click="openAssetDetail(asset)"
          >
            <span class="asset-type-pill">{{ asset.typeLabel || '成品' }}</span>
            <div>
              <strong>{{ getAssetTitle(asset) }}</strong>
              <span>{{ asset.sourceMetaLine || formatTime(asset.updatedAt) }}</span>
            </div>
            <em>{{ formatFileSize(asset.sizeBytes) }}</em>
          </button>
          <div v-if="!visibleAssets.length" class="empty-row">暂无可查看成品</div>
        </div>
        </GlassPanel>

        <GlassPanel class="ops-panel autopilot-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Auto-Pilot</span>
            <h3>无人值守发布</h3>
          </div>
          <div class="panel-actions">
            <span class="state-chip" :class="{ on: autoPilotEnabled }">
              {{ autoPilotEnabled ? '已开启' : '未开启' }}
            </span>
            <button type="button" class="mini-button icon-mini" aria-label="配置无人值守发布" @click="openAutoPilotModal">
              <Settings class="icon-sm" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="compact-stats">
          <div>
            <span>素材</span>
            <strong>{{ publishStats.assetCount }}</strong>
          </div>
          <div>
            <span>任务</span>
            <strong>{{ publishStats.jobCount }}</strong>
          </div>
          <div>
            <span>平台</span>
            <strong>{{ publishStats.enabledPlatformCount }}</strong>
          </div>
        </div>

        <div class="plan-list">
          <div v-for="item in autoPilotPlans" :key="item.id" class="plan-row">
            <div>
              <strong>{{ item.title }}</strong>
              <span>{{ item.scheduledLabel || formatTime(item.scheduledAt) }}</span>
            </div>
            <span>{{ item.statusLabel }}</span>
          </div>
          <div v-if="!autoPilotPlans.length" class="empty-row">暂无托管计划</div>
        </div>
        </GlassPanel>

        <GlassPanel class="ops-panel account-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-kicker">Accounts</span>
              <h3>账号管理</h3>
            </div>
            <div class="panel-actions account-config-actions">
              <button type="button" class="mini-button" @click="openAddAccountConfig('wechatChannels')">
                <Plus class="icon-sm" aria-hidden="true" />
                添加配置
              </button>
              <Users class="panel-mark" aria-hidden="true" />
            </div>
          </div>

          <div class="account-list">
            <div v-for="account in accountCards" :key="account.key" class="account-row">
              <div>
                <strong>{{ account.label }}</strong>
                <span>{{ account.platformLabel }}</span>
              </div>
              <div class="account-row-actions">
                <button type="button" class="mini-button" :disabled="!canCheckAccount(account)" @click="$emit('check-login', account)">
                  {{ getAccountActionLabel(account) }}
                </button>
                <button type="button" class="mini-button subtle" @click="openEditAccountConfig(account)">
                  配置
                </button>
                <button v-if="canOpenAccountManager(account)" type="button" class="mini-button subtle" @click="openAccountManager(account)">
                  内容
                </button>
                <button type="button" class="mini-button subtle danger" @click="deleteAccountConfig(account)">
                  删除
                </button>
              </div>
            </div>
            <div v-if="!accountCards.length" class="empty-row">暂无账号配置</div>
          </div>
          <div class="account-config-picks">
            <button type="button" class="mini-button subtle" @click="openAddAccountConfig('wechatChannels')">添加视频号</button>
            <button type="button" class="mini-button subtle" @click="openAddAccountConfig('douyin')">添加抖音</button>
            <button type="button" class="mini-button subtle" @click="openAddAccountConfig('xiaohongshu')">添加小红书</button>
            <button type="button" class="mini-button subtle" @click="openAddAccountConfig('x')">添加 X</button>
          </div>
        </GlassPanel>

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
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  ClipboardList,
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
  Rocket,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users
} from 'lucide-vue-next';
import {
  activePublishStates,
  getAvatarTaskStatus,
  getGroupedMaterialTasks,
  getMaterialQueueKey,
  getVerticalTaskMaterialKey,
  normalizeUnifiedTaskForQueue,
  terminalPublishStates,
  waitingPublishStates
} from './materialDriven/dashboardTaskHelpers';

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

const getDbVerticalQueueTasks = () => {
  const inMemoryJobs = Array.isArray(verticalQueueStatus.value?.jobs) ? verticalQueueStatus.value.jobs : [];
  const byId = new Map(inMemoryJobs.map((job) => [String(job.id || ''), job]));
  for (const task of unifiedDbTasks.value) {
    if (task?.type !== 'vertical_queue') continue;
    const normalized = normalizeUnifiedTaskForQueue(task);
    if (!normalized?.id || byId.has(String(normalized.id))) continue;
    byId.set(String(normalized.id), normalized);
  }
  return Array.from(byId.values());
};

const getDbStandaloneTasks = () => {
  const byId = new Map((Array.isArray(standaloneDbTasks.value) ? standaloneDbTasks.value : []).map((task) => [String(task.id || ''), task]));
  for (const task of unifiedDbTasks.value) {
    if (task?.type !== 'standalone_vertical') continue;
    const normalized = normalizeUnifiedTaskForQueue(task);
    if (!normalized?.id || byId.has(String(normalized.id))) continue;
    byId.set(String(normalized.id), normalized);
  }
  return Array.from(byId.values());
};

const liveTaskItems = computed(() => {
  const items = [];
  const browserMaterialJobId = String(jobId.value || '').trim();
  const browserMaterialOutputPath = String(outputPath.value || '').trim();
  const browserMaterialKey = browserMaterialOutputPath ? `material:${browserMaterialOutputPath}` : '';
  const backgroundMaterialTasks = getGroupedMaterialTasks(readValue(props.materialDriven, 'activeTasks', []));
  const verticalTasksByMaterialKey = new Map();
  const mergedStandaloneTasks = getDbStandaloneTasks();
  for (const task of mergedStandaloneTasks) {
    const status = String(task?.status || '').trim();
    if (!['queued', 'running', 'failed', 'interrupted'].includes(status)) continue;
    const materialKey = getVerticalTaskMaterialKey(task);
    if (!materialKey) continue;
    const existing = verticalTasksByMaterialKey.get(materialKey);
    if (!existing || String(task.updatedAt || '').localeCompare(String(existing.updatedAt || '')) > 0) {
      verticalTasksByMaterialKey.set(materialKey, task);
    }
  }
  const hasCurrentTaskInBackground = backgroundMaterialTasks.some((task) => {
    const taskId = String(task?.id || '').trim();
    const taskKey = getMaterialQueueKey(task);
    return (browserMaterialJobId && taskId === browserMaterialJobId) ||
      (browserMaterialKey && (taskKey === browserMaterialKey || verticalTasksByMaterialKey.has(browserMaterialKey)));
  }) || Boolean(browserMaterialKey && verticalTasksByMaterialKey.has(browserMaterialKey));
  const materialWorkflowActive = Boolean(
    uploading.value ||
    rebuildingPlan.value ||
    rerenderingVideo.value ||
    (jobId.value && !finalVideoUrl.value)
  );
  const pushedBrowserMaterialCard = materialWorkflowActive && !hasCurrentTaskInBackground;

  if (pushedBrowserMaterialCard) {
    items.push({
      id: `material-${jobId.value || 'draft'}`,
      type: '主流程',
      title: materialSourceLabel.value || selectedFile.value?.name || outputPath.value || '素材驱动生产',
      statusLabel: combinedErrorText.value ? '需处理' : currentStepLabel.value,
      detail: productionStatusText.value || statusText.value || '正在推进素材驱动流程',
      progress: displayProgress.value,
      meta: jobId.value ? `任务 ${jobId.value}` : '本地任务',
      state: combinedErrorText.value ? 'danger' : 'running',
      order: combinedErrorText.value ? 0 : 10
    });
  }

  for (const task of backgroundMaterialTasks) {
    const taskId = String(task?.id || '').trim();
    const taskKey = getMaterialQueueKey(task);
    if (!taskId) continue;
    if (
      pushedBrowserMaterialCard &&
      ((browserMaterialJobId && taskId === browserMaterialJobId) || (browserMaterialKey && taskKey === browserMaterialKey))
    ) {
      continue;
    }
    const status = String(task?.status || '').trim();
    const isTerminal = ['completed', 'cancelled', 'published'].includes(status);
    if (isTerminal) continue;
    const taskTitle = getMaterialTaskTitle(task);
    const taskProgress = Number(task?.progress);
    const taskStep = Number(task?.currentStep || 0);
    const isResuming = materialResumingTaskIds.value.includes(taskId);
    const verticalTask = verticalTasksByMaterialKey.get(taskKey);
    const verticalStatus = String(verticalTask?.status || '').trim();
    const hasVerticalTask = Boolean(verticalTask);
    const mergedStatus = hasVerticalTask ? verticalStatus : status;
    const mergedProgress = hasVerticalTask && Number.isFinite(Number(verticalTask.progress))
      ? Math.max(Number(taskProgress || 0), Number(verticalTask.progress || 0))
      : taskProgress;
    items.push({
      id: `material-active-${taskId}`,
      taskId,
      outputPath: task?.outputPath || task?.outputDir || '',
      type: hasVerticalTask ? '竖屏' : getMaterialTaskTypeLabel(task),
      title: taskTitle,
      statusLabel: hasVerticalTask ? getStandaloneTaskStatusLabel(verticalTask) : getMaterialTaskStatusLabel(task),
      detail: isResuming ? '正在恢复 RunningHub 结果并准备进入下一步' : (
        hasVerticalTask ? getStandaloneTaskDetail(verticalTask) : getMaterialTaskDetail(task)
      ),
      progress: Number.isFinite(mergedProgress) ? Math.max(0, Math.min(100, isResuming ? Math.max(mergedProgress, 87) : mergedProgress)) : null,
      meta: hasVerticalTask ? (verticalTask.runtimeJobId || formatRelativeTaskTime(verticalTask.updatedAt || verticalTask.startedAt)) : (taskId ? `任务 ${taskId}` : formatRelativeTaskTime(task?.updatedAt || task?.startedAt)),
      state: mergedStatus === 'failed' || task?.error || verticalTask?.errorDetails ? 'danger' : (mergedStatus === 'queued' ? 'waiting' : 'running'),
      action: !hasVerticalTask && task?.avatarRenderState?.taskId && !task?.videoUrl ? 'resume-material' : '',
      actionBusy: isResuming,
      order: mergedStatus === 'failed' || task?.error ? 0 : (hasVerticalTask ? 30 : 12 + Math.max(0, taskStep))
    });
  }

  if (xaiLoading.value) {
    items.push({
      id: `xai-${activePartitionId.value || 'default'}`,
      type: '抓榜',
      title: `${activePartitionLabel.value} 热门榜单`,
      statusLabel: '抓取中',
      detail: xaiProgressMessage.value,
      progress: xaiProgressPercent.value,
      meta: xaiProgressLabel.value,
      state: 'running',
      order: 20
    });
  }

  if (verticalLoading.value) {
    items.push({
      id: 'standalone-current',
      type: '竖屏',
      title: verticalSourceTaskDir.value || '单条竖屏合成',
      statusLabel: verticalErrorText.value ? '需处理' : '合成中',
      detail: verticalStatusText.value || '正在生成竖屏版本',
      progress: verticalProgress.value,
      meta: readValue(props.standalone, 'activeDurationLabel', '') || '运行中',
      state: verticalErrorText.value ? 'danger' : 'running',
      order: verticalErrorText.value ? 1 : 30
    });
  }

  for (const task of standaloneDbTasks.value) {
    const status = String(task?.status || '').trim();
    if (!['queued', 'running', 'failed', 'interrupted'].includes(status)) continue;
    const materialKey = getVerticalTaskMaterialKey(task);
    const alreadyMergedIntoMaterial = Boolean(materialKey && (
      backgroundMaterialTasks.some((materialTask) => getMaterialQueueKey(materialTask) === materialKey) ||
      browserMaterialKey === materialKey
    ));
    if (alreadyMergedIntoMaterial) continue;
    items.push({
      id: `standalone-db-${task.id}`,
      type: '竖屏',
      title: task.sourceTaskDir || task.title || task.id,
      statusLabel: getStandaloneTaskStatusLabel(task),
      detail: getStandaloneTaskDetail(task),
      progress: Number.isFinite(Number(task.progress)) ? Math.max(0, Math.min(100, Number(task.progress))) : null,
      meta: task.runtimeJobId || formatRelativeTaskTime(task.updatedAt || task.startedAt),
      state: status === 'queued' ? 'waiting' : (status === 'failed' ? 'danger' : 'running'),
      order: status === 'failed' ? 1 : 32
    });
  }

  const queueJobs = getDbVerticalQueueTasks();
  for (const job of queueJobs) {
    const status = String(job?.status || '').trim();
    if (!['queued', 'running', 'transcribing', 'rendering', 'reviewing', 'reviewed', 'failed', 'cancelled', 'skipped'].includes(status)) {
      continue;
    }
    items.push({
      id: `vertical-${job.id}`,
      type: '渲染队列',
      title: job.title || job.author || job.id,
      statusLabel: getVerticalQueueStatusLabel(status),
      detail: job.message || getVerticalQueueStatusLabel(status),
      progress: Number.isFinite(Number(job.progress)) ? Math.max(0, Math.min(100, Number(job.progress))) : null,
      meta: formatRelativeTaskTime(job.updatedAt || job.startedAt || job.createdAt),
      state: ['failed', 'cancelled', 'skipped'].includes(status) ? 'danger' : (status === 'queued' ? 'waiting' : 'running'),
      order: status === 'queued' ? 45 : 35
    });
  }

  for (const job of readValue(props.publishCenter, 'jobs', []).filter((item) => !item.archived)) {
    const tasks = Array.isArray(job.platformTasks) ? job.platformTasks : [];
    const states = tasks.map((task) => getTaskState(task)).filter(Boolean);
    const jobState = String(job.status || '').trim();
    const activeState = states.find((state) => activePublishStates.has(state));
    const waitingState = states.find((state) => waitingPublishStates.has(state)) || (waitingPublishStates.has(jobState) ? jobState : '');
    const terminalState = states.find((state) => terminalPublishStates.has(state)) || (terminalPublishStates.has(jobState) ? jobState : '');
    const failedState = terminalState === 'failed' ? terminalState : '';
    const chosenState = activeState || failedState || waitingState || terminalState;
    if (!chosenState || chosenState === 'published') {
      continue;
    }

    const nextTask = tasks.find((task) => getTaskState(task) === chosenState) || tasks[0] || null;
    const progressValue = Number(nextTask?.runtime?.progress ?? 0);
    const scheduledAt = job.scheduledAt || '';
    items.push({
      id: `publish-${job.id}-${nextTask?.platform || 'job'}`,
      type: '发布',
      title: job.publishData?.title || job.asset?.compactLabel || job.asset?.label || job.id,
      statusLabel: getPublishJobLabel(job),
      detail: getPublishTaskDetail(job, nextTask, chosenState),
      progress: activeState && Number.isFinite(progressValue) ? Math.max(0, Math.min(100, progressValue)) : null,
      meta: scheduledAt ? formatTime(scheduledAt) : formatRelativeTaskTime(job.updatedAt || job.createdAt),
      state: chosenState === 'failed' ? 'danger' : (activeState ? 'running' : 'waiting'),
      order: chosenState === 'failed' ? 2 : (activeState ? 25 : 60)
    });
  }

  return items
    .sort((a, b) => a.order - b.order || String(a.meta || '').localeCompare(String(b.meta || '')))
    .slice(0, 10);
});

const activeTaskCount = computed(() => liveTaskItems.value.filter((item) => item.state === 'running').length);
const waitingTaskCount = computed(() => liveTaskItems.value.filter((item) => item.state === 'waiting').length);
const failedTaskCount = computed(() => liveTaskItems.value.filter((item) => item.state === 'danger').length);
const liveTaskSummaryLabel = computed(() => {
  if (failedTaskCount.value) return `${failedTaskCount.value} 个需处理`;
  if (activeTaskCount.value) return `${activeTaskCount.value} 运行 / ${waitingTaskCount.value} 等待`;
  if (waitingTaskCount.value) return `${waitingTaskCount.value} 个等待`;
  return '暂无任务';
});

const resumeMaterialTask = (item) => {
  const taskId = String(item?.taskId || '').trim();
  if (!taskId) return;
  emit('resume-material-task', {
    jobId: taskId,
    outputPath: item?.outputPath || ''
  });
};

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

const handlePublishAccountDropdownFocusout = (event) => {
  if (event.currentTarget?.contains(event.relatedTarget)) return;
  closePublishAccountDropdown();
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

const getMaterialTaskTitle = (task) => String(
  task?.sourcePost?.title ||
  task?.sourceMeta?.sourceAuthor ||
  task?.outputPath ||
  task?.id ||
  '素材驱动任务'
).trim();

const getMaterialTaskTypeLabel = (task) => {
  const status = String(task?.status || '').trim();
  if (status === 'generating_avatar' || Number(task?.currentStep || 0) === 6) return '数字人';
  if (Number(task?.currentStep || 0) >= 7) return '主流程';
  return '素材任务';
};

const getMaterialTaskStatusLabel = (task) => {
  const status = String(task?.status || '').trim();
  const avatarStatus = getAvatarTaskStatus(task);
  const currentStepValue = Number(task?.currentStep || 0);
  if (task?.error || ['failed', 'failure', 'error'].includes(status) || ['failed', 'failure', 'error'].includes(avatarStatus)) return '执行失败';
  if (['canceled', 'cancelled'].includes(status) || ['canceled', 'cancelled'].includes(avatarStatus)) return '已取消';
  if (status === 'generating_avatar' || currentStepValue === 6) return '数字人合成中';
  if (status === 'waiting_avatar') return '等待数字人';
  if (status === 'waiting_render') return '等待成片';
  if (status === 'running') return '执行中';
  return status || '运行中';
};

const getMaterialTaskDetail = (task) => {
  const runningHubTaskId = String(task?.avatarRenderState?.taskId || '').trim();
  const avatarStatus = getAvatarTaskStatus(task);
  const avatarError = String(task?.avatarRenderState?.error || task?.error || '').trim();
  if (['failed', 'failure', 'error'].includes(avatarStatus)) {
    return avatarError || (runningHubTaskId ? `RunningHub taskId ${runningHubTaskId} · 已失败` : '数字人合成失败');
  }
  if (['canceled', 'cancelled'].includes(avatarStatus)) {
    return runningHubTaskId ? `RunningHub taskId ${runningHubTaskId} · 已取消` : '数字人合成已取消';
  }
  const statusTextValue = String(task?.statusText || '').trim();
  const latestLog = Array.isArray(task?.logs) ? task.logs.slice().reverse().find((item) => item?.message || item) : null;
  const latestLogText = typeof latestLog === 'string' ? latestLog : String(latestLog?.message || '').trim();
  if (runningHubTaskId && (task?.status === 'generating_avatar' || Number(task?.currentStep || 0) === 6)) {
    return `RunningHub taskId ${runningHubTaskId} · 正在查询数字人合成结果`;
  }
  return statusTextValue || latestLogText || `步骤 ${Number(task?.currentStep || 0) || '-'}`;
};

const getStandaloneTaskStatusLabel = (task) => {
  const status = String(task?.status || '').trim();
  if (status === 'queued') return '竖屏排队中';
  if (status === 'failed' || task?.errorDetails) return '竖屏失败';
  if (status === 'interrupted') return '竖屏中断';
  if (status === 'running') return '竖屏合成中';
  return status || '竖屏处理中';
};

const getStandaloneTaskDetail = (task) => {
  const message = String(task?.message || '').trim();
  const stage = String(task?.stage || '').trim();
  const errorDetails = String(task?.errorDetails || '').trim();
  if (errorDetails) return errorDetails;
  if (message) return message;
  if (stage) return stage;
  return '数据库任务状态同步中';
};

const getVerticalQueueStatusLabel = (status) => ({
  queued: '排队中',
  running: '运行中',
  transcribing: 'ASR 打轴',
  rendering: '渲染中',
  reviewing: 'AI 审核中',
  reviewed: '审核完成',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  skipped: '已跳过'
}[String(status || '')] || String(status || '处理中'));

const getPlatformDisplayLabel = (platformKey) => {
  const platform = platformDefs.value.find((item) => item.key === platformKey);
  return platform?.label || platformKey || '平台';
};

const getPublishTaskDetail = (job, task, state) => {
  const platformLabel = getPlatformDisplayLabel(task?.platform);
  const accountLabel = task?.accountLabel || task?.accountId || job?.platformSelections?.[task?.platform]?.accountLabel || '';
  const message = String(task?.runtime?.lastMessage || task?.runtime?.message || '').trim();
  if (message) return `${platformLabel} · ${message}`;
  if (state === 'scheduled_wait') return `${platformLabel} · 等待定时触发`;
  if (state === 'need_login' || state === 'login_ready') return `${platformLabel} · 等待登录确认`;
  if (accountLabel) return `${platformLabel} · ${accountLabel}`;
  return platformLabel;
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

const formatRelativeTaskTime = (value) => {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const diffSeconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds || 1} 秒前`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  return formatTime(value);
};
</script>

<style scoped>
.automation-dashboard {
  display: grid;
  gap: 16px;
}

.command-strip {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 18px;
  align-items: stretch;
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  background:
    radial-gradient(circle at 8% 0%, color-mix(in srgb, var(--brand-a) 15%, transparent), transparent 34%),
    linear-gradient(145deg, color-mix(in srgb, var(--glass-panel-strong) 88%, var(--brand-a) 4%), var(--glass-panel));
  padding: 18px;
  box-shadow: var(--glass-shadow);
  overflow: hidden;
  backdrop-filter: blur(24px) saturate(1.18);
  animation: section-enter 0.46s ease both;
  transition: border-color 0.24s ease, box-shadow 0.24s ease, background 0.24s ease, transform 0.24s ease;
}

.command-strip::before {
  content: "";
  position: absolute;
  inset: 1px 18px auto;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--glass-highlight), transparent);
  opacity: 0.78;
  pointer-events: none;
}

.command-strip::after {
  content: "";
  position: absolute;
  inset: auto 18px 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--brand-a) 46%, transparent), transparent);
  opacity: 0.72;
  pointer-events: none;
}

.command-main,
.launch-pad,
.ops-panel {
  min-width: 0;
}

.eyebrow,
.panel-kicker,
.source-line,
.run-meta,
.tool-button,
.primary-action,
.source-picker,
.danger-button,
.status-badge,
.state-chip,
.mini-button {
  display: inline-flex;
  align-items: center;
}

.eyebrow {
  gap: 7px;
  color: var(--brand-a);
  font-size: 12px;
  font-weight: 800;
}

.command-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-top: 10px;
}

h2,
h3 {
  margin: 0;
  color: var(--strong-text);
}

h2 {
  font-size: 34px;
  line-height: 1.08;
}

h3 {
  font-size: 16px;
  line-height: 1.25;
}

.status-badge,
.state-chip {
  gap: 7px;
  min-height: 30px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  padding: 6px 10px;
  color: var(--muted);
  background: var(--glass-panel);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.state-ready .status-badge,
.state-running .status-badge,
.state-staged .status-badge,
.state-chip.on {
  border-color: rgba(20, 184, 166, 0.36);
  color: var(--brand-a);
  background: var(--brand-soft);
}

.state-danger .status-badge {
  border-color: rgba(239, 68, 68, 0.38);
  color: var(--danger);
  background: rgba(239, 68, 68, 0.1);
}

.source-line {
  gap: 8px;
  margin-top: 12px;
  color: var(--muted);
  font-size: 13px;
  word-break: break-word;
}

.progress-rail {
  position: relative;
  height: 8px;
  overflow: hidden;
  margin-top: 18px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--input-bg) 82%, transparent);
  border: 1px solid var(--line-soft);
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.progress-rail::after {
  content: "";
  position: absolute;
  inset: 0;
  width: 38%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.72), transparent);
  opacity: 0;
  transform: translateX(-140%);
  pointer-events: none;
}

.progress-rail span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand-a), var(--brand-b));
  box-shadow: 0 0 18px color-mix(in srgb, var(--brand-a) 32%, transparent);
  transition: width 0.24s ease;
}

.state-running .progress-rail span {
  background: linear-gradient(90deg, var(--brand-a), var(--brand-b));
}

.state-running .progress-rail::after {
  opacity: 0.76;
  animation: rail-shimmer 1.45s ease-in-out infinite;
}

.state-running .status-badge {
  animation: live-chip-pulse 1.8s ease-in-out infinite;
}

.run-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.run-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  padding: 6px 9px;
  color: var(--muted);
  background: var(--glass-panel);
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.launch-pad {
  display: grid;
  align-content: start;
  gap: 10px;
  border-left: 1px solid var(--line-soft);
  padding-left: 18px;
}

.source-picker,
.primary-action,
.tool-button,
.danger-button,
.mini-button {
  position: relative;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  border: 1px solid var(--glass-border);
  border-radius: 7px;
  padding: 9px 12px;
  color: var(--strong-text);
  background: var(--glass-panel);
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;
  text-decoration: none;
  box-shadow: 0 1px 0 var(--glass-highlight) inset, 0 8px 18px color-mix(in srgb, var(--brand-a) 7%, transparent);
  overflow: hidden;
  transition: border-color 0.22s ease, background 0.22s ease, color 0.22s ease, transform 0.22s ease, box-shadow 0.22s ease;
}

.source-picker::after,
.primary-action::after,
.tool-button::after,
.danger-button::after,
.mini-button::after {
  content: "";
  position: absolute;
  inset: -35% auto -35% -70%;
  width: 42%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.32), transparent);
  transform: skewX(-18deg);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.42s ease, opacity 0.28s ease;
}

.source-picker {
  justify-content: flex-start;
  color: var(--muted);
}

.source-picker span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-picker.disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.primary-action {
  min-height: 46px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand-a) 90%, white), var(--brand-b));
  border-color: var(--brand-a);
  color: #04110f;
  box-shadow: 0 15px 28px color-mix(in srgb, var(--brand-a) 22%, transparent), 0 1px 0 rgba(255, 255, 255, 0.45) inset;
}

.tool-button:hover,
.source-picker:hover,
.danger-button:hover,
.mini-button:hover,
.hot-row:hover {
  border-color: var(--line-strong);
  color: var(--strong-text);
  transform: translateY(-1px);
  box-shadow: 0 12px 22px color-mix(in srgb, var(--brand-a) 10%, transparent), 0 1px 0 var(--glass-highlight) inset;
}

.source-picker:hover::after,
.primary-action:hover::after,
.tool-button:hover::after,
.danger-button:hover::after,
.mini-button:hover::after {
  opacity: 1;
  transform: translateX(410%) skewX(-18deg);
}

.primary-action:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 18px 30px color-mix(in srgb, var(--brand-a) 26%, transparent);
}

.primary-action:disabled,
.tool-button:disabled,
.danger-button:disabled,
.mini-button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.tool-button.loading .icon-sm {
  animation: hot-refresh-spin 0.85s linear infinite;
}

.action-row,
.result-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 8px;
}

.local-upload {
  min-width: 0;
}

.local-upload span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.local-upload.disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.danger-button {
  min-height: 34px;
  color: var(--danger);
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.32);
}

.source-modal {
  display: grid;
  gap: 14px;
  width: min(760px, 100%);
  max-height: min(760px, calc(100vh - 40px));
  overflow: auto;
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--glass-panel-strong) 92%, var(--brand-a) 6%), var(--glass-panel)),
    var(--panel);
  box-shadow: 0 34px 90px rgba(0, 0, 0, 0.4), 0 1px 0 var(--glass-highlight) inset;
  backdrop-filter: blur(28px) saturate(1.18);
  padding: 16px;
}

:global(body.theme-light .source-modal) {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(252, 254, 255, 0.92)),
    var(--panel);
  box-shadow: var(--modal-shadow);
}

:global(body.theme-light .danger-button) {
  background: rgba(254, 242, 242, 0.72);
}

:global(body.theme-light .failure-box) {
  background: rgba(254, 242, 242, 0.68);
}

.modal-heading,
.modal-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.modal-actions {
  align-items: stretch;
}

.qr-modal {
  width: min(460px, 100%);
}

.qr-state-box {
  display: grid;
  justify-items: center;
  gap: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--glass-panel);
  padding: 18px;
  color: var(--text);
  text-align: center;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.qr-state-box.status-error {
  border-color: rgba(239, 68, 68, 0.32);
  background: rgba(239, 68, 68, 0.1);
}

.qr-state-box.status-logged_in {
  border-color: rgba(34, 197, 94, 0.3);
  background: rgba(34, 197, 94, 0.1);
}

.qr-state-box strong {
  color: var(--strong-text);
  font-size: 14px;
}

.qr-state-box span {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.qr-image {
  width: min(240px, 74vw);
  height: auto;
  border-radius: 8px;
  background: #fff;
  padding: 10px;
}

.picker-list {
  max-height: 420px;
  overflow: auto;
}

.picker-empty {
  display: grid;
  justify-items: center;
  gap: 10px;
}

.picker-empty strong {
  color: var(--strong-text);
}

.modal-upload {
  justify-self: stretch;
}

.autopilot-modal {
  width: min(980px, 100%);
}

.autopilot-config-strip,
.autopilot-summary-list,
.mode-toggle-row {
  display: grid;
  gap: 8px;
}

.autopilot-config-strip {
  grid-template-columns: repeat(2, minmax(0, 1fr)) minmax(150px, 0.7fr);
}

.toggle-row,
.field-control,
.summary-row,
.mode-toggle,
.autopilot-mode-section,
.autopilot-plan-row {
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--glass-panel);
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 44px;
  padding: 9px 11px;
  color: var(--strong-text);
  font-size: 13px;
  font-weight: 850;
}

.toggle-row input {
  accent-color: var(--brand-a);
}

.field-control {
  display: grid;
  gap: 6px;
  padding: 9px;
}

.field-control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.field-control-row > span {
  min-width: 0;
}

.field-control.compact {
  min-height: 44px;
  padding: 7px 9px;
}

.field-control span,
.platform-checks > span,
.summary-row span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 850;
}

.field-control input,
.field-control select,
.field-control textarea {
  min-width: 0;
  width: 100%;
  border: 1px solid var(--input-border);
  border-radius: 6px;
  outline: none;
  background: var(--input-bg);
  color: var(--strong-text);
  min-height: 34px;
  padding: 6px 8px;
  font-weight: 800;
  color-scheme: inherit;
}

.field-control .tool-button {
  width: auto;
  min-height: 32px;
  padding: 6px 9px;
  white-space: nowrap;
}

.field-control textarea {
  line-height: 1.5;
  resize: vertical;
}

.field-control input:disabled,
.field-control select:disabled,
.field-control textarea:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.autopilot-summary-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.summary-row {
  display: grid;
  gap: 5px;
  padding: 10px;
}

.summary-row strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--strong-text);
  font-size: 13px;
}

.mode-toggle-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mode-toggle {
  display: grid;
  gap: 5px;
  padding: 11px;
  color: var(--muted);
  text-align: left;
  cursor: pointer;
}

.mode-toggle strong {
  color: var(--strong-text);
  font-size: 14px;
}

.mode-toggle span {
  font-size: 12px;
  line-height: 1.35;
}

.mode-toggle.active {
  border-color: color-mix(in srgb, var(--brand-a) 60%, var(--line-soft));
  background: color-mix(in srgb, var(--brand-a) 14%, var(--glass-panel));
}

.autopilot-mode-list,
.autopilot-plan-editor {
  display: grid;
  gap: 10px;
}

.autopilot-mode-section {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.mode-section-heading,
.plan-row-title,
.panel-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.mode-section-heading strong,
.plan-row-title strong {
  color: var(--strong-text);
}

.mode-section-heading span {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
}

.autopilot-plan-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 10px;
}

.plan-row-title {
  grid-column: 1 / -1;
}

.danger-mini {
  color: var(--danger);
}

.icon-mini {
  width: 34px;
  min-height: 30px;
  padding: 6px;
}

.detail-modal {
  width: min(720px, 100%);
}

.asset-modal {
  width: min(1040px, 100%);
  overflow: hidden;
  padding: 0;
}

.asset-modal .modal-heading {
  padding: 16px 16px 0;
}

.asset-modal .modal-actions {
  border-top: 1px solid var(--line-soft);
  background: var(--glass-panel);
  padding: 12px 16px 16px;
}

.asset-detail-body {
  display: grid;
  grid-template-columns: minmax(280px, 0.95fr) minmax(300px, 1fr);
  gap: 14px;
  min-height: 0;
  padding: 0 16px;
}

.asset-preview {
  justify-self: center;
  width: min(100%, 360px);
  height: min(560px, calc(100vh - 210px));
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: #05070a;
  box-shadow: 0 18px 34px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.02) inset;
}

.asset-preview video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.publish-composer-modal {
  width: min(1040px, 100%);
  overflow: hidden;
  padding: 0;
}

.publish-composer-modal .modal-heading {
  padding: 16px 16px 0;
}

.publish-composer-modal .modal-actions {
  border-top: 1px solid var(--line-soft);
  background: var(--glass-panel);
  padding: 12px 16px 16px;
}

.publish-composer-grid {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(360px, 1fr);
  gap: 14px;
  padding: 0 16px 16px;
}

.publish-composer-preview {
  justify-self: center;
  width: min(100%, 320px);
  height: min(520px, calc(100vh - 240px));
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: #05070a;
}

.publish-composer-preview video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.publish-composer-form {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}

.publish-target-list {
  display: grid;
  gap: 8px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel-subtle);
  padding: 10px;
}

.publish-account-select {
  padding: 0;
  background: transparent;
  border: 0;
}

.account-select-option {
  display: grid;
  grid-template-columns: minmax(84px, 0.45fr) minmax(0, 1fr);
  gap: 10px;
}

.account-select-option span,
.account-select-option strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-select-option span {
  color: var(--muted);
  font-size: 12px;
}

.account-select-option strong {
  color: var(--strong-text);
  font-size: 13px;
}

.publish-composer-feedback {
  display: grid;
  gap: 4px;
  border-radius: 7px;
  padding: 9px 10px;
  font-size: 12px;
  line-height: 1.5;
}

.publish-composer-feedback.pending {
  border: 1px solid color-mix(in srgb, var(--brand-a) 26%, var(--line-soft));
  background: color-mix(in srgb, var(--brand-a) 8%, var(--glass-panel));
  color: var(--strong-text);
}

.publish-composer-feedback.error {
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--line-soft));
  background: color-mix(in srgb, var(--danger) 8%, var(--glass-panel));
  color: var(--danger);
}

.publish-composer-feedback span {
  color: inherit;
  opacity: 0.88;
}

.asset-detail-side {
  display: grid;
  align-content: start;
  gap: 10px;
  min-height: 0;
  max-height: calc(100vh - 194px);
  overflow: auto;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--glass-panel);
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
  padding: 12px;
}

:global(body.theme-light .asset-modal .modal-actions),
:global(body.theme-light .publish-composer-modal .modal-actions) {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.82)),
    transparent;
}

:global(body.theme-light .asset-detail-side) {
  background: rgba(255, 255, 255, 0.68);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.88) inset, 0 8px 20px rgba(75, 122, 150, 0.04);
}

:global(body.theme-light .asset-detail-grid div),
:global(body.theme-light .asset-tag-list span) {
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.82) inset;
}

.asset-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.asset-tag-list span {
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--muted);
  padding: 5px 7px;
  font-size: 12px;
  font-weight: 800;
}

.detail-title {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
}

.detail-title strong {
  color: var(--strong-text);
  font-size: 18px;
  line-height: 1.45;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.asset-detail-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.asset-detail-grid div:last-child {
  grid-column: 1 / -1;
}

.detail-grid div,
.detail-copy {
  display: grid;
  gap: 6px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--panel-soft);
  padding: 10px;
}

.detail-grid span,
.detail-copy span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 850;
}

.detail-grid strong {
  min-width: 0;
  overflow: hidden;
  color: var(--strong-text);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-copy p {
  min-width: 0;
  margin: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.partition-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.partition-tabs button {
  min-height: 34px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--panel-soft);
  color: var(--muted);
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;
}

.partition-tabs button.active {
  border-color: rgba(20, 184, 166, 0.36);
  background: var(--brand-soft);
  color: var(--brand-a);
}

.cockpit-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.9fr);
  align-items: stretch;
  gap: 16px;
}

.cockpit-column {
  display: grid;
  align-content: stretch;
  gap: 16px;
  min-width: 0;
}

.cockpit-main-column {
  grid-template-rows: auto auto minmax(0, 1fr);
}

.support-section {
  display: grid;
  gap: 12px;
  margin-top: 0;
}

.support-overview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.support-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.cockpit-support-section .support-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
}

.cockpit-support-section .activity-panel {
  grid-column: 1 / -1;
}

.cockpit-support-section,
.cockpit-support-section .support-panel {
  min-height: 0;
}

.cockpit-support-section .support-panel {
  display: flex;
  flex-direction: column;
}

.cockpit-support-section .support-body {
  flex: 1;
}

.support-panel {
  padding: 0;
}

.intake-panel,
.output-panel,
.asset-library-panel,
.autopilot-panel,
.account-panel {
  padding: 16px;
}

.output-panel {
  z-index: 3;
}

.output-panel-open {
  z-index: 80;
}

.support-card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 64px;
  padding: 12px 14px;
}

.support-card-heading h3,
.support-overview h3 {
  margin: 0;
  color: var(--strong-text);
  font-size: 16px;
}

.support-summary-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.support-summary-metrics span {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: var(--glass-panel);
  color: var(--muted);
  padding: 5px 9px;
  font-size: 12px;
  font-weight: 850;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.support-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: var(--glass-panel);
  color: var(--muted);
  padding: 5px 9px;
  font-size: 12px;
  font-weight: 850;
  white-space: nowrap;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.support-status.active {
  border-color: color-mix(in srgb, var(--brand-a) 42%, var(--line-soft));
  color: var(--brand-a);
  background: color-mix(in srgb, var(--brand-a) 12%, var(--glass-panel));
}

.support-chevron {
  color: var(--muted);
  transition: transform 0.18s ease, color 0.18s ease;
}

.inline-fold[open] .support-chevron {
  color: var(--brand-a);
  transform: rotate(180deg);
}

.support-body {
  border-top: 1px solid var(--line-soft);
  padding: 12px 14px 14px;
}

.task-queue-list {
  display: grid;
  gap: 8px;
  max-height: 340px;
  overflow: auto;
  padding-right: 2px;
}

.task-queue-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 58px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--glass-panel);
  padding: 10px;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.task-queue-row.state-running {
  border-color: color-mix(in srgb, var(--brand-a) 32%, var(--line-soft));
  background: color-mix(in srgb, var(--brand-a) 8%, var(--glass-panel));
}

.task-queue-row.state-waiting {
  background: color-mix(in srgb, var(--input-bg) 58%, var(--glass-panel));
}

.task-queue-row.state-danger {
  border-color: rgba(239, 68, 68, 0.34);
  background: rgba(239, 68, 68, 0.1);
}

.task-type-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--input-bg) 78%, transparent);
  color: var(--muted);
  padding: 4px 7px;
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
}

.task-queue-main {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.task-queue-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.task-queue-title strong {
  min-width: 0;
  overflow: hidden;
  color: var(--strong-text);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-queue-title em {
  flex: none;
  color: var(--brand-a);
  font-size: 12px;
  font-style: normal;
  font-weight: 850;
}

.task-queue-main > span,
.task-queue-meta {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-queue-meta {
  max-width: 132px;
  justify-self: end;
}

.task-queue-side {
  display: grid;
  justify-items: end;
  gap: 6px;
  min-width: 0;
}

.task-action-button {
  min-height: 28px;
  padding: 5px 9px;
}

.spin-icon {
  animation: hot-refresh-spin 0.9s linear infinite;
}

.mini-progress-rail {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--input-bg) 82%, transparent);
}

.mini-progress-rail span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand-a), var(--brand-b));
  transition: width 0.24s ease;
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.panel-kicker {
  display: block;
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 850;
}

.panel-mark {
  width: 22px;
  height: 22px;
  color: var(--muted);
}

.panel-mark.ready {
  color: var(--ok);
}

.panel-mark.danger {
  color: var(--danger);
}

.hot-list,
.source-hot-list,
.asset-list,
.step-list,
.plan-list,
.issue-list,
.log-list,
.account-list {
  display: grid;
  gap: 8px;
}

.source-toolbar {
  display: grid;
  grid-template-columns: minmax(210px, 1fr) auto auto;
  gap: 8px;
  margin-bottom: 10px;
  position: relative;
  z-index: 20;
}

.hot-refresh-progress {
  height: 6px;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: var(--input-bg);
  margin: -2px 0 12px;
}

.hot-refresh-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand-a), var(--brand-b));
  transition: width 0.2s ease;
}

.source-refresh-progress {
  margin-top: -4px;
}

.hot-refresh-status {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin: -4px 0 12px;
  color: var(--muted-text);
  font-size: 12px;
}

.hot-refresh-status strong {
  color: var(--strong-text);
  font-size: 12px;
}

.hot-refresh-status span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-refresh-status {
  margin-top: -8px;
}

.partition-select {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  position: relative;
  z-index: 30;
  min-height: 40px;
  border: 1px solid var(--input-border);
  border-radius: 7px;
  background: var(--glass-panel);
  padding: 5px 7px 5px 10px;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.partition-select:focus-within {
  border-color: var(--brand-a);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-a) 22%, transparent);
  z-index: 80;
}

.partition-select span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 850;
}

.partition-trigger {
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--strong-text);
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 30px;
  padding: 0;
  font-weight: 850;
  cursor: pointer;
}

.partition-trigger strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.partition-trigger .icon-sm {
  color: var(--muted);
  flex: none;
  transition: transform 0.18s ease, color 0.18s ease;
}

.partition-trigger[aria-expanded="true"] .icon-sm {
  color: var(--brand-a);
  transform: rotate(180deg);
}

.partition-menu {
  position: absolute;
  z-index: 90;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  display: grid;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--input-border);
  border-radius: 7px;
  background: color-mix(in srgb, var(--glass-panel-strong) 88%, white 12%);
  box-shadow: var(--glass-shadow);
  backdrop-filter: blur(22px) saturate(1.18);
  pointer-events: auto;
}

.partition-option {
  width: 100%;
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: color-mix(in srgb, var(--input-bg) 84%, transparent);
  color: var(--strong-text);
  display: flex;
  align-items: center;
  padding: 7px 9px;
  font-size: 13px;
  font-weight: 850;
  text-align: left;
  cursor: pointer;
}

.partition-option:hover,
.partition-option:focus-visible {
  border-color: var(--input-border);
  background: var(--glass-panel);
  outline: none;
}

.partition-option.active {
  border-color: color-mix(in srgb, var(--brand-a) 60%, var(--input-border));
  background: color-mix(in srgb, var(--brand-a) 16%, var(--glass-panel));
  color: var(--strong-text);
}

.select-control {
  position: relative;
}

.select-trigger {
  min-width: 0;
  width: 100%;
  min-height: 34px;
  border: 1px solid var(--input-border);
  border-radius: 6px;
  outline: none;
  background: var(--glass-panel);
  color: var(--strong-text);
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  font-weight: 850;
  cursor: pointer;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.select-trigger:hover:not(:disabled),
.select-trigger[aria-expanded="true"] {
  border-color: color-mix(in srgb, var(--brand-a) 44%, var(--input-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-a) 12%, transparent), 0 1px 0 var(--glass-highlight) inset;
}

.select-trigger strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.select-trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.select-trigger .icon-sm {
  color: var(--muted);
  flex: none;
  transition: transform 0.18s ease, color 0.18s ease;
}

.select-trigger[aria-expanded="true"] .icon-sm {
  color: var(--brand-a);
  transform: rotate(180deg);
}

.select-menu {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  display: grid;
  gap: 4px;
  max-height: min(260px, 44vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  border: 1px solid var(--input-border);
  border-radius: 7px;
  background: var(--glass-panel-strong);
  box-shadow: var(--glass-shadow);
  backdrop-filter: blur(22px) saturate(1.18);
}

.select-menu::-webkit-scrollbar {
  width: 7px;
}

.select-menu::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--brand-a) 38%, transparent);
}

.select-option {
  width: 100%;
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: color-mix(in srgb, var(--input-bg) 84%, transparent);
  color: var(--strong-text);
  display: flex;
  align-items: center;
  padding: 7px 9px;
  font-size: 13px;
  font-weight: 850;
  text-align: left;
  cursor: pointer;
}

.select-option:hover,
.select-option:focus-visible {
  border-color: var(--input-border);
  background: var(--glass-panel);
  outline: none;
}

.select-option.active {
  border-color: color-mix(in srgb, var(--brand-a) 60%, var(--input-border));
  background: color-mix(in srgb, var(--brand-a) 16%, var(--glass-panel));
}

.select-option:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.source-hot-list {
  max-height: 268px;
  overflow: auto;
  position: relative;
  z-index: 1;
  padding-right: 2px;
}

.asset-list {
  margin-top: 14px;
  max-height: 248px;
  overflow: auto;
  position: relative;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: linear-gradient(180deg, var(--panel-subtle), color-mix(in srgb, var(--input-bg) 74%, transparent));
  box-shadow: inset 0 1px 0 var(--glass-highlight), inset 0 -18px 24px color-mix(in srgb, var(--brand-a) 5%, transparent);
  padding: 8px;
}

.hot-row,
.source-hot-card,
.asset-row,
.step-row,
.plan-row,
.issue-row,
.log-row,
.account-row {
  display: grid;
  gap: 10px;
  align-items: center;
  min-height: 46px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--glass-panel);
  padding: 10px;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.source-hot-card {
  grid-template-columns: 34px minmax(0, 1fr) auto;
}

.asset-row {
  grid-template-columns: auto minmax(0, 1fr) auto;
  width: 100%;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  box-shadow: 0 8px 18px color-mix(in srgb, var(--brand-a) 7%, transparent), 0 1px 0 var(--glass-highlight) inset;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.asset-row:hover,
.asset-row:focus-visible {
  border-color: color-mix(in srgb, var(--brand-a) 40%, var(--line-soft));
  background: color-mix(in srgb, var(--brand-a) 8%, var(--glass-panel));
  transform: translateY(-1px);
  box-shadow: 0 12px 24px color-mix(in srgb, var(--brand-a) 11%, transparent), 0 1px 0 var(--glass-highlight) inset;
}

.asset-row div {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.asset-row strong,
.asset-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-row strong {
  color: var(--strong-text);
  font-size: 13px;
}

.asset-row span,
.asset-row em {
  color: var(--muted);
  font-size: 12px;
}

.asset-row em {
  font-style: normal;
  font-weight: 850;
}

.asset-type-pill {
  border-radius: 6px;
  background: color-mix(in srgb, var(--input-bg) 78%, transparent);
  color: var(--muted);
  padding: 5px 7px;
  font-size: 11px;
  font-weight: 850;
}

.rank-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--input-bg) 78%, transparent);
  color: var(--muted);
  font-size: 12px;
  font-weight: 900;
}

.hot-main {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.hot-main strong {
  min-width: 0;
  overflow: hidden;
  color: var(--strong-text);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hot-main span {
  color: var(--muted);
  font-size: 12px;
}

.hot-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.hot-stats em {
  border-radius: 6px;
  background: color-mix(in srgb, var(--input-bg) 78%, transparent);
  color: var(--muted);
  padding: 3px 6px;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
}

.hot-actions {
  display: grid;
  gap: 6px;
  min-width: 104px;
}

.hot-row {
  grid-template-columns: 32px minmax(0, 1fr) auto;
  width: 100%;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.hot-row span,
.step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--input-bg) 78%, transparent);
  color: var(--muted);
  font-size: 12px;
  font-weight: 900;
}

.hot-row strong,
.step-copy strong,
.plan-row strong,
.issue-row strong,
.account-row strong,
.output-metric strong,
.log-row strong {
  min-width: 0;
  overflow: hidden;
  color: var(--strong-text);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hot-row em,
.step-copy span,
.plan-row span,
.issue-row span,
.account-row span,
.output-metric span,
.health-score span,
.log-row span {
  color: var(--muted);
  font-size: 12px;
  font-style: normal;
}

.step-row {
  grid-template-columns: 32px minmax(0, 1fr) 70px;
}

.step-copy,
.plan-row div,
.issue-row,
.account-row div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.step-state {
  justify-self: end;
  color: var(--muted);
  font-size: 12px;
  font-weight: 850;
}

.step-row.complete .step-index,
.step-row.active .step-index {
  background: var(--brand-soft);
  color: var(--brand-a);
}

.step-row.complete .step-state,
.step-row.active .step-state {
  color: var(--brand-a);
}

.step-row.danger .step-index,
.step-row.danger .step-state {
  color: var(--danger);
}

.output-summary,
.compact-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.asset-library-stats {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.output-metric,
.compact-stats div {
  display: grid;
  gap: 5px;
  min-height: 62px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--glass-panel);
  padding: 10px;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.compact-stats span {
  color: var(--muted);
  font-size: 12px;
}

.compact-stats strong {
  color: var(--strong-text);
  font-size: 18px;
}

.failure-box {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 10px;
  margin: 12px 0;
  border: 1px solid rgba(239, 68, 68, 0.32);
  border-radius: 7px;
  background: rgba(239, 68, 68, 0.1);
  padding: 10px;
  color: var(--danger);
}

.failure-box div {
  display: grid;
  gap: 4px;
}

.failure-box strong {
  color: var(--strong-text);
  font-size: 13px;
}

.failure-box span {
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}

.failure-actions,
.vertical-retry-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.danger-mini {
  border-color: rgba(239, 68, 68, 0.28);
  color: var(--danger);
  background: rgba(239, 68, 68, 0.08);
}

.vertical-delivery-card {
  display: grid;
  gap: 10px;
  margin-top: 12px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.04)),
    var(--glass-panel);
  padding: 12px;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.vertical-delivery-card.state-running {
  border-color: color-mix(in srgb, var(--brand-a) 30%, var(--line-soft));
  background: color-mix(in srgb, var(--brand-a) 8%, var(--glass-panel));
  animation: live-card-breathe 2.2s ease-in-out infinite;
}

.vertical-delivery-card.state-ready {
  border-color: color-mix(in srgb, var(--brand-b) 30%, var(--line-soft));
  background: color-mix(in srgb, var(--brand-b) 8%, var(--glass-panel));
}

.vertical-delivery-card.state-danger {
  border-color: rgba(239, 68, 68, 0.32);
  background: rgba(239, 68, 68, 0.1);
}

.vertical-delivery-copy {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.vertical-delivery-copy > .icon-sm {
  margin-top: 2px;
  color: var(--brand-a);
}

.vertical-delivery-card.state-ready .vertical-delivery-copy > .icon-sm {
  color: var(--brand-b);
}

.vertical-delivery-card.state-danger .vertical-delivery-copy > .icon-sm {
  color: var(--danger);
}

.vertical-delivery-card.state-running .vertical-delivery-copy > .icon-sm {
  animation: live-icon-float 1.5s ease-in-out infinite;
}

.vertical-delivery-copy div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.vertical-delivery-copy strong {
  color: var(--strong-text);
  font-size: 13px;
}

.vertical-delivery-copy span {
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
}

.vertical-progress-rail {
  position: relative;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--input-bg) 82%, transparent);
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.vertical-progress-rail::after {
  content: "";
  position: absolute;
  inset: 0;
  width: 42%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.78), transparent);
  transform: translateX(-140%);
  animation: rail-shimmer 1.25s ease-in-out infinite;
  pointer-events: none;
}

.vertical-progress-rail span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand-a), var(--brand-b));
  box-shadow: 0 0 16px color-mix(in srgb, var(--brand-a) 28%, transparent);
  transition: width 0.24s ease;
}

.output-workbench {
  display: grid;
  grid-template-columns: 124px minmax(0, 1fr);
  gap: 12px;
  margin-top: 12px;
  align-items: stretch;
}

.output-preview {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 210px;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.04)),
    color-mix(in srgb, var(--input-bg) 80%, transparent);
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.output-preview::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(115deg, transparent 18%, rgba(255, 255, 255, 0.34) 42%, transparent 66%);
  opacity: 0;
  pointer-events: none;
  transform: translateX(-120%);
}

.output-preview.running {
  border-color: color-mix(in srgb, var(--brand-a) 36%, var(--line-soft));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-a) 10%, transparent), 0 1px 0 var(--glass-highlight) inset;
}

.output-preview.running::after {
  opacity: 0.56;
  animation: preview-scan 2.1s ease-in-out infinite;
}

.output-preview video {
  width: 100%;
  height: 100%;
  min-height: 210px;
  object-fit: cover;
  background: #020617;
}

.quick-publish-box {
  position: relative;
  z-index: 5;
  display: grid;
  gap: 10px;
  align-content: start;
  min-width: 0;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--glass-panel);
  padding: 12px;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.quick-publish-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.quick-publish-heading strong {
  display: block;
  color: var(--strong-text);
  font-size: 14px;
}

.output-account-select {
  position: relative;
  z-index: 90;
}

.output-account-select .select-menu {
  top: auto;
  bottom: calc(100% + 6px);
  z-index: 120;
  max-height: min(188px, 34vh);
}

.quick-publish-action {
  width: 100%;
  min-height: 38px;
  margin-top: 2px;
}

.quick-publish-action.waiting {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--brand-a) 62%, white 12%), color-mix(in srgb, var(--brand-b) 56%, white 14%), color-mix(in srgb, var(--brand-a) 62%, white 12%));
  background-size: 220% 100%;
  animation: progress-flow 1.8s linear infinite;
}

.quick-publish-action.waiting:disabled {
  opacity: 0.76;
}

.output-preview-modal {
  width: min(920px, calc(100vw - 28px));
  max-height: min(900px, calc(100vh - 28px));
  overflow: auto;
}

.output-preview-frame {
  display: grid;
  place-items: center;
  min-height: min(78vh, 760px);
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: #020617;
  overflow: hidden;
}

.output-preview-frame video {
  width: 100%;
  height: min(78vh, 760px);
  object-fit: contain;
  background: #020617;
}

.plan-row,
.account-row {
  grid-template-columns: minmax(0, 1fr) auto;
}

.support-row-actions,
.account-row-actions,
.account-config-picks,
.account-config-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.account-config-actions {
  flex-wrap: nowrap;
}

.account-config-picks {
  justify-content: flex-start;
  margin-top: 10px;
}

.account-config-modal {
  width: min(560px, calc(100vw - 32px));
  max-height: min(760px, calc(100vh - 32px));
  overflow: auto;
}

.account-config-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.account-config-field {
  min-height: auto;
}

.account-config-field span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.account-config-field em {
  color: var(--brand-a);
  font-size: 11px;
  font-style: normal;
  font-weight: 900;
}

.account-config-input {
  width: 100%;
  min-width: 0;
  min-height: 36px;
  border: 1px solid var(--input-border);
  border-radius: 6px;
  outline: none;
  background: var(--input-bg);
  color: var(--strong-text);
  padding: 7px 9px;
  font-size: 13px;
  font-weight: 850;
  color-scheme: inherit;
}

select.account-config-input {
  appearance: none;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--muted) 50%),
    linear-gradient(135deg, var(--muted) 50%, transparent 50%);
  background-position:
    calc(100% - 16px) 15px,
    calc(100% - 11px) 15px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  padding-right: 30px;
}

.account-config-input:focus {
  border-color: color-mix(in srgb, var(--brand-a) 58%, var(--input-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-a) 14%, transparent);
}

.account-config-input.missing-field {
  border-color: color-mix(in srgb, var(--danger) 76%, var(--input-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 12%, transparent);
}

.account-config-form .issue-box {
  grid-column: 1 / -1;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--line-soft));
  border-radius: 7px;
  background: color-mix(in srgb, var(--danger) 8%, var(--glass-panel));
  color: var(--danger);
  padding: 9px 10px;
  font-size: 12px;
  font-weight: 850;
}

.plan-row > span {
  color: var(--brand-a);
  font-weight: 850;
}

.support-row-actions > span {
  color: var(--brand-a);
  font-size: 12px;
  font-weight: 850;
}

.account-row-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(42px, auto));
  min-width: 96px;
  justify-content: end;
}

.account-row-actions .mini-button {
  min-height: 28px;
  padding: 5px 8px;
  font-size: 12px;
}

.health-score {
  display: grid;
  grid-template-columns: 12px auto minmax(0, 1fr);
  gap: 9px;
  align-items: center;
  margin-bottom: 12px;
}

.health-score strong {
  color: var(--strong-text);
  font-size: 13px;
}

.health-dot {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  background: var(--muted);
}

.status-ok,
.status-pass {
  background: var(--ok);
}

.status-warn {
  background: var(--warn);
}

.status-fail,
.status-error {
  background: var(--danger);
}

.mini-button {
  min-height: 32px;
  padding: 6px 10px;
  color: var(--brand-a);
}

.mini-button.subtle {
  color: var(--muted);
}

.mini-button.subtle.danger {
  color: var(--danger);
}

.issue-row,
.log-row {
  min-height: 42px;
}

.log-row {
  grid-template-columns: 70px minmax(0, 1fr);
}

.empty-row {
  border: 1px dashed var(--line-soft);
  border-radius: 7px;
  padding: 12px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}

.icon {
  width: 18px;
  height: 18px;
  flex: none;
}

.icon-sm {
  width: 15px;
  height: 15px;
  flex: none;
}

@keyframes hot-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes progress-flow {
  from {
    background-position: 0% 50%;
  }
  to {
    background-position: 220% 50%;
  }
}

@keyframes rail-shimmer {
  0% {
    transform: translateX(-145%);
  }
  58%,
  100% {
    transform: translateX(265%);
  }
}

@keyframes live-chip-pulse {
  0%,
  100% {
    box-shadow: 0 1px 0 var(--glass-highlight) inset, 0 0 0 0 color-mix(in srgb, var(--brand-a) 22%, transparent);
  }
  50% {
    box-shadow: 0 1px 0 var(--glass-highlight) inset, 0 0 0 5px color-mix(in srgb, var(--brand-a) 10%, transparent);
  }
}

@keyframes live-card-breathe {
  0%,
  100% {
    box-shadow: 0 1px 0 var(--glass-highlight) inset, 0 0 0 0 color-mix(in srgb, var(--brand-a) 14%, transparent);
  }
  50% {
    box-shadow: 0 1px 0 var(--glass-highlight) inset, 0 0 0 4px color-mix(in srgb, var(--brand-a) 8%, transparent);
  }
}

@keyframes live-icon-float {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-2px) rotate(-5deg);
  }
}

@keyframes preview-scan {
  0% {
    transform: translateX(-125%);
  }
  55%,
  100% {
    transform: translateX(125%);
  }
}

@keyframes section-enter {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.994);
    filter: blur(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}

@media (max-width: 980px) {
  .command-strip,
  .cockpit-layout {
    grid-template-columns: 1fr;
  }

  .support-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .launch-pad {
    border-left: 0;
    border-top: 1px solid var(--line-soft);
    padding-left: 0;
    padding-top: 16px;
  }

}

@media (max-width: 720px) {
  .command-strip,
  .ops-panel {
    padding: 14px;
  }

  .command-title-row,
  .panel-heading {
    flex-direction: column;
  }

  .action-row,
  .result-actions,
  .output-workbench,
  .output-summary,
  .compact-stats,
  .source-toolbar,
  .asset-detail-body,
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .asset-modal {
    max-height: calc(100vh - 24px);
    overflow: auto;
  }

  .asset-modal .modal-heading,
  .asset-detail-body,
  .asset-modal .modal-actions,
  .publish-composer-modal .modal-heading,
  .publish-composer-grid,
  .publish-composer-modal .modal-actions {
    padding-left: 12px;
    padding-right: 12px;
  }

  .publish-composer-modal {
    max-height: calc(100vh - 24px);
    overflow: auto;
  }

  .publish-composer-grid {
    grid-template-columns: 1fr;
  }

  .account-config-form {
    grid-template-columns: 1fr;
  }

  .support-grid {
    grid-template-columns: 1fr;
  }

  .support-overview,
  .support-card-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .asset-preview,
  .asset-detail-side {
    max-height: none;
  }

  .asset-preview {
    width: min(100%, 320px);
    height: min(62vh, 520px);
  }

  .publish-composer-preview {
    width: min(100%, 300px);
    height: min(52vh, 460px);
  }

  .source-hot-card {
    grid-template-columns: 28px minmax(0, 1fr);
  }

  .hot-actions {
    grid-column: 2;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    min-width: 0;
  }

  .hot-row {
    grid-template-columns: 28px minmax(0, 1fr);
  }

  .hot-row em {
    grid-column: 2;
  }

  .task-queue-row {
    grid-template-columns: 1fr;
  }

  .task-type-pill,
  .task-queue-meta {
    justify-self: start;
  }

  .task-queue-meta {
    max-width: 100%;
  }

  .step-row {
    grid-template-columns: 28px minmax(0, 1fr);
  }

  .step-state {
    grid-column: 2;
    justify-self: start;
  }
}
</style>

const path = require('path');
const fs = require('fs');
const {
  readReviewConfig,
  writeReviewConfig,
  createReviewRecord,
  updateReviewRecord,
  getReviewRecord,
  getReviewHistory,
  deleteReviewRecord
} = require('./store');
const { executeReviewScript } = require('./executor');
const { enqueueRegenerationFromReview } = require('./regenerate');

function makeJobId() {
  return `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function buildDefaultMetadata(videoPath) {
  const ext = path.extname(String(videoPath || ''));
  const baseName = path.basename(String(videoPath || ''), ext);
  const normalizedTitle = baseName
    .replace(/_\[\d+分\]$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: normalizedTitle,
    suggestedTitle: normalizedTitle,
    suggestedShortTitle: normalizedTitle,
    sourceSummary: '',
    subtitles: [],
    aiReview: null
  };
}

function readJsonSafe(filePath, fallbackValue = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return fallbackValue;
  }
}

function enrichMetadataFromRuntimeFiles(videoPath, metadata) {
  const next = { ...(metadata || {}) };
  const normalizedPath = path.normalize(String(videoPath || ''));
  const projectRoot = process.cwd();

  const subtitleItems = Array.isArray(next.subtitles) ? next.subtitles.filter(Boolean) : [];
  const hasSubtitles = subtitleItems.length > 0;
  const hasSummary = String(next.sourceSummary || '').trim().length > 0;
  const hasTitle = String(next.suggestedTitle || next.title || '').trim().length > 0;

  const pathPatterns = [
    {
      publicPrefix: path.join(projectRoot, 'public', 'xai_vertical_queue') + path.sep,
      dataRoot: path.join(projectRoot, 'data', 'uploads', 'xai_vertical_queue')
    },
    {
      publicPrefix: path.join(projectRoot, 'public', 'runtime_jobs') + path.sep,
      dataRoot: path.join(projectRoot, 'data', 'uploads', 'runtime_jobs')
    }
  ];

  for (const pattern of pathPatterns) {
    const normalizedPrefix = path.normalize(pattern.publicPrefix);
    if (!normalizedPath.startsWith(normalizedPrefix)) continue;
    const relativePath = normalizedPath.slice(normalizedPrefix.length);
    const [jobId] = relativePath.split(/[\\/]/);
    if (!jobId) break;

    const runtimeDir = path.join(pattern.dataRoot, jobId);
    if (!fs.existsSync(runtimeDir)) break;

    if (!hasSubtitles) {
      const runtimeSubtitles = readJsonSafe(path.join(runtimeDir, 'subtitles.json'), []);
      if (Array.isArray(runtimeSubtitles) && runtimeSubtitles.length > 0) {
        next.subtitles = runtimeSubtitles;
      }
    }

    if (!hasSummary) {
      const audioJson = readJsonSafe(path.join(runtimeDir, 'audio.json'), null);
      const summaryText = String(
        audioJson?.summary_zh ||
        audioJson?.summary ||
        audioJson?.text_zh ||
        audioJson?.text ||
        ''
      ).trim();
      if (summaryText) {
        next.sourceSummary = summaryText;
      }
    }

    if (!hasTitle) {
      const contentJson = readJsonSafe(path.join(runtimeDir, 'content.json'), null);
      const titleText = String(contentJson?.title || '').trim();
      if (titleText) {
        next.title = titleText;
        next.suggestedTitle = titleText;
        next.suggestedShortTitle = titleText;
      }
    }

    break;
  }

  return next;
}

function createReviewHandlers(deps) {
  const { sendError, readMediaMetadata, writeMediaMetadata, verticalQueueService } = deps;

  return {
    // 获取审核配置
    getConfig: (_req, res) => {
      try {
        const config = readReviewConfig();
        res.json({
          success: true,
          config: {
            ...config,
            enabled: Boolean(config.enabled),
            auto_skip_on_error: Boolean(config.auto_skip_on_error),
            require_manual_confirm: Boolean(config.require_manual_confirm),
            save_review_history: Boolean(config.save_review_history)
          }
        });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'REVIEW_CONFIG_READ_FAILED',
          stage: 'review.config',
          error: '读取审核配置失败',
          details: err.message
        });
      }
    },

    // 更新审核配置
    updateConfig: (req, res) => {
      try {
        const config = req.body;
        writeReviewConfig(config);
        const updated = readReviewConfig();
        res.json({
          success: true,
          config: {
            ...updated,
            enabled: Boolean(updated.enabled),
            auto_skip_on_error: Boolean(updated.auto_skip_on_error),
            require_manual_confirm: Boolean(updated.require_manual_confirm),
            save_review_history: Boolean(updated.save_review_history)
          }
        });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'REVIEW_CONFIG_UPDATE_FAILED',
          stage: 'review.config',
          error: '更新审核配置失败',
          details: err.message
        });
      }
    },

    // 执行视频审核
    reviewVideo: async (req, res) => {
      try {
        const { videoPath, assetId } = req.body;

        if (!videoPath) {
          return sendError(res, {
            status: 400,
            code: 'REVIEW_VIDEO_PATH_MISSING',
            stage: 'review.start',
            error: '缺少视频路径'
          });
        }

        // 检查视频文件存在
        if (!fs.existsSync(videoPath)) {
          return sendError(res, {
            status: 404,
            code: 'REVIEW_VIDEO_NOT_FOUND',
            stage: 'review.start',
            error: '视频文件不存在'
          });
        }

        // 读取配置
        const config = readReviewConfig();

        if (!config.enabled) {
          return res.json({
            success: true,
            skipped: true,
            reason: 'review_disabled'
          });
        }

        // 创建审核记录
        const reviewId = makeJobId();
        const metadataPath = `${videoPath}.meta.json`;
        const metadata = enrichMetadataFromRuntimeFiles(
          videoPath,
          readMediaMetadata(videoPath) || buildDefaultMetadata(videoPath)
        );
        if (!fs.existsSync(metadataPath)) {
          writeMediaMetadata(videoPath, metadata);
        } else {
          writeMediaMetadata(videoPath, metadata);
        }

        createReviewRecord({
          id: reviewId,
          asset_id: assetId || path.basename(videoPath),
          video_path: videoPath,
          review_status: 'reviewing',
          config_snapshot: config
        });

        // 执行审核脚本
        try {
          const result = await executeReviewScript(videoPath, metadataPath, config);

          // 更新数据库记录
          updateReviewRecord(reviewId, {
            review_status: result.status,
            overall_score: result.overall_score,
            content_quality_score: result.scores.content,
            subtitle_accuracy_score: result.scores.subtitle,
            title_appeal_score: result.scores.title,
            editing_quality_score: result.scores.editing,
            content_analysis: result.content_analysis,
            subtitle_issues: result.subtitle_analysis,
            title_suggestions: result.title_analysis,
            editing_feedback: result.editing_analysis,
            fix_suggestions: result.fix_suggestions
          });

          // 更新元数据
          metadata.aiReview = {
            reviewId,
            status: result.status,
            overallScore: result.overall_score,
            scores: {
              contentQuality: result.scores.content,
              subtitleAccuracy: result.scores.subtitle,
              titleAppeal: result.scores.title,
              editingQuality: result.scores.editing
            },
            reviewedAt: new Date().toISOString(),
            fixSuggestions: result.fix_suggestions,
            manuallySkipped: false
          };
          writeMediaMetadata(videoPath, metadata);

          res.json({
            success: true,
            reviewId,
            videoPath,
            renamed: false,
            result: {
              status: result.status,
              overall_score: result.overall_score,
              scores: result.scores,
              fix_suggestions: result.fix_suggestions,
              passed: result.passed
            }
          });

        } catch (err) {
          // 审核失败
          updateReviewRecord(reviewId, {
            review_status: 'failed',
            error_message: err.message,
            error_details: JSON.stringify({
              stack: err.stack || '',
              code: err.code || '',
              stage: err.stage || '',
              details: err.details || '',
              hint: err.hint || '',
              stdoutTail: err.stdoutTail || '',
              stderrTail: err.stderrTail || '',
              protocol: err.protocol || null
            }, null, 2)
          });

          if (config.auto_skip_on_error) {
            // 自动跳过
            metadata.aiReview = {
              reviewId,
              status: 'skipped',
              reason: 'auto_skip_on_error',
              error: err.message,
              reviewedAt: new Date().toISOString()
            };
            writeMediaMetadata(videoPath, metadata);

            return res.json({
              success: true,
              skipped: true,
              reason: 'auto_skip_on_error',
              error: err.message
            });
          }

          throw err;
        }

      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'REVIEW_EXECUTION_FAILED',
          stage: 'review.execute',
          error: '执行视频审核失败',
          details: err.message
        });
      }
    },

    // 手动跳过审核
    skipReview: (req, res) => {
      try {
        const { videoPath, assetId, reason } = req.body;

        if (!videoPath) {
          return sendError(res, {
            status: 400,
            code: 'REVIEW_VIDEO_PATH_MISSING',
            stage: 'review.skip',
            error: '缺少视频路径'
          });
        }

        const reviewId = makeJobId();
        const metadata = enrichMetadataFromRuntimeFiles(
          videoPath,
          readMediaMetadata(videoPath) || buildDefaultMetadata(videoPath)
        );
        if (!fs.existsSync(`${videoPath}.meta.json`)) {
          writeMediaMetadata(videoPath, metadata);
        } else {
          writeMediaMetadata(videoPath, metadata);
        }

        // 记录跳过
        createReviewRecord({
          id: reviewId,
          asset_id: assetId || path.basename(videoPath),
          video_path: videoPath,
          review_status: 'skipped',
          config_snapshot: {}
        });

        updateReviewRecord(reviewId, {
          review_status: 'skipped'
        });

        metadata.aiReview = {
          reviewId,
          status: 'skipped',
          reason: reason || 'manual_skip',
          manuallySkipped: true,
          reviewedAt: new Date().toISOString()
        };
        writeMediaMetadata(videoPath, metadata);

        res.json({ success: true, reviewId, skipped: true });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'REVIEW_SKIP_FAILED',
          stage: 'review.skip',
          error: '跳过审核失败',
          details: err.message
        });
      }
    },

    // 获取审核历史
    getHistory: (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const result = getReviewHistory(limit, offset);

        res.json({
          success: true,
          ...result
        });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'REVIEW_HISTORY_READ_FAILED',
          stage: 'review.history',
          error: '读取审核历史失败',
          details: err.message
        });
      }
    },

    // 获取单个审核记录
    getReview: (req, res) => {
      try {
        const { reviewId } = req.params;
        const record = getReviewRecord(reviewId);

        if (!record) {
          return sendError(res, {
            status: 404,
            code: 'REVIEW_NOT_FOUND',
            stage: 'review.get',
            error: '审核记录不存在'
          });
        }

        res.json({
          success: true,
          record
        });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'REVIEW_GET_FAILED',
          stage: 'review.get',
          error: '获取审核记录失败',
          details: err.message
        });
      }
    },

    // 删除审核记录
    deleteReview: (req, res) => {
      try {
        const { reviewId } = req.params;
        deleteReviewRecord(reviewId);

        res.json({
          success: true
        });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'REVIEW_DELETE_FAILED',
          stage: 'review.delete',
          error: '删除审核记录失败',
          details: err.message
        });
      }
    },

    // 根据审核建议重新生成视频
    regenerateVideo: async (req, res) => {
      try {
        const { videoPath } = req.body;

        if (!videoPath) {
          return sendError(res, {
            status: 400,
            code: 'REVIEW_VIDEO_PATH_MISSING',
            stage: 'review.regenerate',
            error: '缺少视频路径'
          });
        }

        // 读取视频元数据
        const metadata = readMediaMetadata(videoPath);
        if (!metadata) {
          return sendError(res, {
            status: 404,
            code: 'REVIEW_METADATA_NOT_FOUND',
            stage: 'review.regenerate',
            error: '视频元数据不存在'
          });
        }

        const aiReview = metadata.aiReview;
        if (!aiReview || !aiReview.fixSuggestions || aiReview.fixSuggestions.length === 0) {
          return sendError(res, {
            status: 400,
            code: 'REVIEW_NO_SUGGESTIONS',
            stage: 'review.regenerate',
            error: '该视频没有可用的修复建议'
          });
        }

        const { job, adjustments } = enqueueRegenerationFromReview({
          videoPath,
          metadata,
          verticalQueueService,
          writeMediaMetadata,
          trigger: 'manual',
          sourceReview: aiReview
        });

        res.json({
          success: true,
          jobId: job.id,
          adjustments: {
            titleChanged: adjustments.needsNewTitle,
            newTitle: adjustments.suggestedTitle,
            subtitlesRegenerated: adjustments.needsSubtitleRegeneration,
            appliedSuggestionsCount: adjustments.highPrioritySuggestions.length,
            repairProfile: adjustments.repairProfile,
            repairFocus: adjustments.repairFocus,
            repairSummary: adjustments.repairSummary
          },
          message: '视频已加入重新生成队列'
        });

      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'REVIEW_REGENERATE_FAILED',
          stage: 'review.regenerate',
          error: '重新生成视频失败',
          details: err.message
        });
      }
    }
  };
}

module.exports = {
  createReviewHandlers
};

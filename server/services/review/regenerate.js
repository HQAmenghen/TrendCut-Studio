function buildRegenerationAdjustments(fixSuggestions = []) {
  const adjustments = {
    needsNewTitle: false,
    suggestedTitle: null,
    needsSubtitleRegeneration: false,
    needsContentReview: false,
    highPrioritySuggestions: []
  };

  for (const suggestion of Array.isArray(fixSuggestions) ? fixSuggestions : []) {
    if (!suggestion || typeof suggestion !== 'object') continue;

    if (suggestion.severity === 'high') {
      adjustments.highPrioritySuggestions.push(suggestion);
    }

    if (suggestion.category === 'title') {
      adjustments.needsNewTitle = true;
      const match = String(suggestion.suggestion || '').match(/可以尝试[：:]\s*(.+)/);
      if (match) {
        adjustments.suggestedTitle = String(match[1] || '').trim() || null;
      }
    }

    if (suggestion.category === 'subtitle' && suggestion.severity === 'high') {
      adjustments.needsSubtitleRegeneration = true;
    }

    if (suggestion.category === 'content' || suggestion.category === 'editing') {
      adjustments.needsContentReview = true;
    }
  }

  return adjustments;
}

function enqueueRegenerationFromReview({
  videoPath,
  metadata,
  verticalQueueService,
  writeMediaMetadata,
  trigger = 'manual',
  sourceReview = null
}) {
  if (!videoPath) {
    const error = new Error('缺少视频路径');
    error.code = 'REVIEW_VIDEO_PATH_MISSING';
    throw error;
  }
  if (!metadata) {
    const error = new Error('视频元数据不存在');
    error.code = 'REVIEW_METADATA_NOT_FOUND';
    throw error;
  }

  const aiReview = sourceReview || metadata.aiReview;
  if (!aiReview || !Array.isArray(aiReview.fixSuggestions) || aiReview.fixSuggestions.length === 0) {
    const error = new Error('该视频没有可用的修复建议');
    error.code = 'REVIEW_NO_SUGGESTIONS';
    throw error;
  }

  const sourceType = metadata.sourceType;
  const hasSourceInfo = metadata.videoUrl || metadata.sourceSummary;
  if (!hasSourceInfo) {
    const error = new Error('该视频缺少源信息，无法重新生成');
    error.code = 'REVIEW_NO_SOURCE_INFO';
    error.hint = '只有通过自动流水线生成的视频才支持重新生成';
    throw error;
  }

  if (!verticalQueueService || typeof verticalQueueService.enqueue !== 'function') {
    const error = new Error('视频生成服务不可用');
    error.code = 'REVIEW_QUEUE_SERVICE_UNAVAILABLE';
    throw error;
  }

  const adjustments = buildRegenerationAdjustments(aiReview.fixSuggestions);

  // 查找源视频路径
  let sourceVideoPath = null;
  if (metadata.taskDir) {
    // 尝试从任务目录中找到源视频
    const possibleSourcePath = require('path').join(metadata.taskDir, 'source.mp4');
    if (require('fs').existsSync(possibleSourcePath)) {
      sourceVideoPath = possibleSourcePath;
    }
  }

  // 如果找不到源视频，拒绝执行
  if (!sourceVideoPath) {
    const error = new Error('无法找到源视频文件，无法重新生成');
    error.code = 'REVIEW_SOURCE_VIDEO_NOT_FOUND';
    error.hint = '只有通过自动流水线生成的视频才支持重新生成，且源视频文件必须存在';
    throw error;
  }

  const regenerateParams = {
    sourceType: sourceType || 'manual',
    title: adjustments.suggestedTitle || metadata.suggestedTitle || metadata.title,
    summary: metadata.sourceSummary || '',
    videoUrl: metadata.videoUrl || '',
    author: metadata.author || '',
    postId: metadata.postId || '',
    postUrl: metadata.postUrl || metadata.sourceUrl || '',
    renderOptions: {
      regenerateSubtitles: adjustments.needsSubtitleRegeneration,
      originalVideoPath: sourceVideoPath,
      isRegeneration: true,
      previousReviewId: aiReview.reviewId,
      appliedSuggestions: adjustments.highPrioritySuggestions.map((s) => s.issue)
    }
  };

  const job = verticalQueueService.enqueue(regenerateParams);
  const previousAttemptCount = Number(metadata?.regeneration?.attemptCount || 0);

  metadata.regeneration = {
    status: 'queued',
    queueJobId: job.id,
    previousReviewScore: aiReview.overallScore,
    previousReviewId: aiReview.reviewId,
    trigger,
    appliedSuggestions: adjustments.highPrioritySuggestions.map((s) => ({
      category: s.category,
      issue: s.issue
    })),
    attemptCount: previousAttemptCount + 1,
    startedAt: new Date().toISOString()
  };

  writeMediaMetadata(videoPath, metadata);

  return { job, adjustments, metadata };
}

module.exports = {
  buildRegenerationAdjustments,
  enqueueRegenerationFromReview
};

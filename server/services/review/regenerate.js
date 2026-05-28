function buildRegenerationAdjustments(fixSuggestions = []) {
  const adjustments = {
    needsNewTitle: false,
    suggestedTitle: null,
    needsSubtitleRegeneration: false,
    needsContentReview: false,
    highPrioritySuggestions: [],
    repairProfile: 'balanced',
    repairFocus: [],
    renderOptions: {},
    repairSummary: []
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

function pickString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : 0;
}

function extractReviewScores(aiReview = {}) {
  const scores = aiReview?.scores || {};
  return {
    content: normalizeScore(scores.content ?? scores.contentQuality),
    subtitle: normalizeScore(scores.subtitle ?? scores.subtitleAccuracy),
    title: normalizeScore(scores.title ?? scores.titleAppeal),
    editing: normalizeScore(scores.editing ?? scores.editingQuality)
  };
}

function textHasAnyKeyword(text, keywords) {
  const normalized = String(text || '').toLowerCase();
  return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
}

function buildRepairPlan(aiReview = {}, adjustments = {}) {
  const scores = extractReviewScores(aiReview);
  const highPrioritySuggestions = Array.isArray(adjustments.highPrioritySuggestions)
    ? adjustments.highPrioritySuggestions
    : [];
  const issueTexts = highPrioritySuggestions.map((item) => `${item?.issue || ''} ${item?.suggestion || ''}`);

  const subtitleIssueDetected = adjustments.needsSubtitleRegeneration
    || scores.subtitle < 82
    || issueTexts.some((text) => textHasAnyKeyword(text, [
      '字幕', '时间轴', '同步', '断句', '漏字', '漏译', '错译', '双语', '英文', '挤', '不完整', '可读'
    ]));

  const editingIssueDetected = adjustments.needsContentReview
    || scores.editing < 78
    || issueTexts.some((text) => textHasAnyKeyword(text, [
      '剪辑', '节奏', '构图', '转场', '音频', '字幕挤压', '排版', '画面'
    ]));

  const titleIssueDetected = adjustments.needsNewTitle || scores.title < 72;
  const contentIssueDetected = scores.content < 72;

  const repairFocus = [];
  if (subtitleIssueDetected) repairFocus.push('subtitle');
  if (editingIssueDetected) repairFocus.push('editing');
  if (titleIssueDetected) repairFocus.push('title');
  if (contentIssueDetected) repairFocus.push('content');

  const aggressiveRepair = subtitleIssueDetected && (scores.subtitle < 75 || editingIssueDetected);
  const renderOptions = {
    titleFontSize: titleIssueDetected ? 96 : 104,
    titleMinSize: titleIssueDetected ? 46 : 52,
    titleMaxLines: titleIssueDetected ? 3 : 2,
    subtitleFontSize: aggressiveRepair ? 44 : 48,
    subtitleMinSize: aggressiveRepair ? 22 : 26,
    subtitleMaxLines: aggressiveRepair ? 3 : 2,
    subtitleOffsetY: aggressiveRepair ? 0 : 12,
    englishFontSize: aggressiveRepair ? 46 : 50,
    englishMinSize: aggressiveRepair ? 24 : 28,
    englishMaxLines: aggressiveRepair ? 3 : 2,
    asrOptions: {
      maxChunkDuration: aggressiveRepair ? 2.2 : 2.8,
      softChunkDuration: aggressiveRepair ? 1.6 : 2.2,
      maxVisibleChars: aggressiveRepair ? 18 : 22,
      maxWordsPerChunk: aggressiveRepair ? 6 : 8,
      pauseThreshold: aggressiveRepair ? 0.28 : 0.36,
      forceEnglishRescue: subtitleIssueDetected
    }
  };

  const repairSummary = [];
  if (subtitleIssueDetected) {
    repairSummary.push('重跑更激进的 ASR 切分，并放宽双语字幕排版');
  }
  if (editingIssueDetected) {
    repairSummary.push('压缩标题与字幕占位，降低因排版造成的剪辑扣分');
  }
  if (titleIssueDetected) {
    repairSummary.push('应用更强标题修复策略');
  }
  if (contentIssueDetected) {
    repairSummary.push('保留内容低分标记，但当前流水线只能做有限修补');
  }

  return {
    repairProfile: aggressiveRepair ? 'aggressive' : 'balanced',
    repairFocus,
    renderOptions,
    repairSummary,
    scores
  };
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
  const repairPlan = buildRepairPlan(aiReview, adjustments);
  const preservedTitle = pickString(
    adjustments.suggestedTitle,
    metadata.suggestedTitle,
    metadata.title,
    metadata.suggestedShortTitle
  );

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
    title: preservedTitle,
    summary: metadata.sourceSummary || '',
    videoUrl: metadata.videoUrl || '',
    author: metadata.author || '',
    postId: metadata.postId || '',
    postUrl: metadata.postUrl || metadata.sourceUrl || '',
    renderOptions: {
      ...repairPlan.renderOptions,
      regenerateSubtitles: adjustments.needsSubtitleRegeneration,
      originalVideoPath: sourceVideoPath,
      isRegeneration: true,
      previousReviewId: aiReview.reviewId,
      previousReviewScore: normalizeScore(aiReview.overallScore ?? aiReview.overall_score),
      previousReviewScores: extractReviewScores(aiReview),
      appliedSuggestions: adjustments.highPrioritySuggestions.map((s) => s.issue),
      repairProfile: repairPlan.repairProfile,
      repairFocus: repairPlan.repairFocus,
      repairSummary: repairPlan.repairSummary
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
    repairProfile: repairPlan.repairProfile,
    repairFocus: repairPlan.repairFocus,
    repairSummary: repairPlan.repairSummary,
    attemptCount: previousAttemptCount + 1,
    startedAt: new Date().toISOString()
  };

  adjustments.repairProfile = repairPlan.repairProfile;
  adjustments.repairFocus = repairPlan.repairFocus;
  adjustments.renderOptions = repairPlan.renderOptions;
  adjustments.repairSummary = repairPlan.repairSummary;

  writeMediaMetadata(videoPath, metadata);

  return { job, adjustments, metadata };
}

module.exports = {
  buildRegenerationAdjustments,
  pickString,
  enqueueRegenerationFromReview
};

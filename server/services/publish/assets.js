function createPublishAssetsService(deps) {
  const {
    fs,
    path,
    crypto,
    projectRoot,
    verticalPublicDir,
    verticalQueueRoot,
    getVerticalJobById,
    readJsonIfExists,
    readMediaMetadata,
    sanitizePublishDescriptionText
  } = deps;

  let publishAssetsCache = { expiresAt: 0, assets: [] };

  function findPreferredVideoFile(dirPath, preferredBaseName) {
    if (!fs.existsSync(dirPath)) return null;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.mp4'))
      .map((entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const stat = fs.statSync(fullPath);
        return {
          name: entry.name,
          fullPath,
          stat
        };
      });

    if (!entries.length) return null;

    const exact = entries.find((entry) => entry.name === preferredBaseName);
    if (exact) return exact.fullPath;

    const prefix = preferredBaseName.replace(/\.mp4$/i, '');
    const related = entries
      .filter((entry) => entry.name.startsWith(prefix))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    if (related.length) return related[0].fullPath;

    entries.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    return entries[0].fullPath;
  }

  function getPublishAssetTypeLabel(sourceType) {
    const map = {
      pipeline: '全链路混剪',
      standalone: '独立竖屏',
      standalone_runtime: '竖屏合成成片',
      xai_queue: 'XAI 批量竖屏'
    };
    return map[sourceType] || sourceType || '视频素材';
  }

  function truncateDisplayText(text, limit = 28) {
    const value = String(text || '').trim();
    if (!value) return '';
    return value.length > limit ? `${value.slice(0, limit)}...` : value;
  }

  function isDefaultFileTitle(value, label) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return true;
    const baseLabel = String(label || '').trim().toLowerCase();
    const defaultNames = new Set([
      baseLabel,
      'vertical output',
      'standalone output vertical',
      'output final',
      'output final vertical',
      'output 9 16',
      'output 16 9'
    ]);
    return defaultNames.has(text);
  }

  function extractSubtitleSnippet(subtitles, limit = 90) {
    if (!Array.isArray(subtitles)) return '';
    const joined = subtitles
      .map((item) => String(item?.zh || item?.text || '').trim())
      .filter(Boolean)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!joined) return '';
    return joined.length > limit ? `${joined.slice(0, limit)}...` : joined;
  }

  function sanitizePublishTitle(title, fallback = '今日热点速递') {
    const normalized = String(title || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized || fallback;
  }

  function pickString(...values) {
    for (const value of values) {
      const text = String(value || '').trim();
      if (text) return text;
    }
    return '';
  }

  function buildShortTitle(title, fallback = '热点速递') {
    const normalized = sanitizePublishTitle(title, fallback)
      .replace(/[？?！!。，“”"'‘’：:、]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return fallback;
    if (normalized.length <= 16) return normalized;
    return normalized.slice(0, 16).trim();
  }

  function buildPublishTags({ title = '', summary = '', sourceType = '' }) {
    const text = `${title} ${summary}`.toLowerCase();
    const tags = new Set();
    const addPreferred = (tag) => tags.add(tag);

    if (text.includes('比特币') || text.includes('bitcoin') || text.includes('btc')) addPreferred('比特币');
    if (
      text.includes('加密') ||
      text.includes('crypto') ||
      text.includes('token') ||
      text.includes('代币') ||
      text.includes('稳定币') ||
      text.includes('stablecoin')
    ) addPreferred('加密货币');
    if (
      text.includes('web3') ||
      text.includes('链上') ||
      text.includes('defi') ||
      text.includes('nft') ||
      text.includes('钱包')
    ) addPreferred('Web3');
    if (
      text.includes('区块链') ||
      text.includes('blockchain') ||
      text.includes('链上') ||
      text.includes('公链')
    ) addPreferred('区块链');
    if (
      text.includes('华尔街') ||
      text.includes('机构') ||
      text.includes('美股') ||
      text.includes('纳指') ||
      text.includes('金融') ||
      text.includes('markets')
    ) addPreferred('金融');
    if (text.includes('ai') || text.includes('人工智能') || text.includes('openai') || text.includes('模型')) addPreferred('AI');
    if (text.includes('web4')) addPreferred('Web4');

    if (sourceType === 'xai_queue') addPreferred('热点视频');
    if (sourceType === 'standalone_runtime') addPreferred('竖屏合成');
    if (text.includes('稳定币') || text.includes('stable')) addPreferred('稳定币');
    if (text.includes('支付')) addPreferred('支付');
    if (text.includes('华尔街')) addPreferred('华尔街');
    addPreferred('财经');
    addPreferred('短视频');

    const ordered = [
      '比特币',
      '加密货币',
      'Web3',
      '区块链',
      '金融',
      'AI',
      'Web4',
      '热点视频',
      '竖屏合成',
      '稳定币',
      '支付',
      '华尔街',
      '财经',
      '短视频'
    ];
    return ordered.filter((tag) => tags.has(tag)).slice(0, 8);
  }

  function buildPublishMetadata({ title = '', subtitles = [], summary = '', sourceType = '', sourceUrl = '', author = '' }) {
    const normalizedTitle = sanitizePublishTitle(title, sourceType === 'xai_queue' ? '热点视频速递' : '今日内容速递');
    const subtitleSnippet = extractSubtitleSnippet(subtitles);
    const summaryText = String(summary || '').replace(/^@[^-]+ -\s*/, '').trim();
    const sourceSummary = subtitleSnippet || summaryText;
    const descriptionSource = subtitleSnippet ? 'subtitles' : (summaryText ? 'post_summary' : 'none');
    const descriptionText = '';

    return {
      suggestedTitle: normalizedTitle,
      suggestedShortTitle: buildShortTitle(normalizedTitle, sourceType === 'xai_queue' ? '热点速递' : '内容速递'),
      suggestedDescription: sanitizePublishDescriptionText(descriptionText),
      suggestedTags: buildPublishTags({ title: normalizedTitle, summary: summaryText || subtitleSnippet, sourceType }),
      sourceSummary,
      descriptionSource,
      sourceUrl,
      author
    };
  }

  function isReviewCenterHidden(metadata = {}) {
    return Boolean(metadata?.reviewCenterHiddenAt || metadata?.reviewCenterHiddenReviewId);
  }

  function buildStandaloneRuntimeMetadata(jobDir) {
    const content = readJsonIfExists(path.join(jobDir, 'content.json'), {});
    const context = readJsonIfExists(path.join(jobDir, 'original_context.json'), {});
    const subtitles = readJsonIfExists(path.join(jobDir, 'subtitles.json'), []);
    const title = String(content?.title || context?.title || '').trim();
    const summary = String(context?.body || context?.summary || '').trim();

    return buildPublishMetadata({
      title,
      subtitles,
      summary,
      sourceType: 'standalone_runtime',
      sourceUrl: context?.postUrl || context?.sourceUrl || '',
      author: context?.author || ''
    });
  }

  function hasStandaloneRuntimeOutput(taskDir) {
    const normalizedTaskDir = String(taskDir || '').trim();
    if (!normalizedTaskDir) return false;
    const outputPath = path.join(normalizedTaskDir, 'standalone_output_vertical.mp4');
    return fs.existsSync(outputPath) && fs.statSync(outputPath).isFile();
  }

  function collectPublishAssets() {
    const assets = [];
    const addAsset = (label, fullPath, publicUrl, sourceType, metadata = {}) => {
      if (!fs.existsSync(fullPath)) return;
      const stat = fs.statSync(fullPath);
      const savedMetadata = readMediaMetadata(fullPath) || {};
      if (isReviewCenterHidden(savedMetadata) || isReviewCenterHidden(metadata)) return;
      const mergedSubtitles = Array.isArray(savedMetadata.subtitles) && savedMetadata.subtitles.length
        ? savedMetadata.subtitles
        : (Array.isArray(metadata.subtitles) ? metadata.subtitles : []);
      const metadataTitle = pickString(metadata.title, metadata.suggestedTitle, metadata.suggestedShortTitle);
      const savedTitle = pickString(
        savedMetadata.title,
        savedMetadata.suggestedTitle,
        savedMetadata.suggestedShortTitle
      );
      const preservedTitle = !isDefaultFileTitle(savedTitle, label) || !metadataTitle
        ? pickString(savedTitle, metadataTitle)
        : metadataTitle;
      const computedMetadata = buildPublishMetadata({
        title: preservedTitle,
        subtitles: mergedSubtitles,
        summary: savedMetadata.sourceSummary || metadata.sourceSummary || '',
        sourceType,
        sourceUrl: savedMetadata.sourceUrl || metadata.sourceUrl || '',
        author: savedMetadata.author || metadata.author || ''
      });
      const shouldPreferSubtitleSummary = computedMetadata.descriptionSource === 'subtitles';
      const mergedMetadata = {
        ...metadata,
        ...savedMetadata,
        title: preservedTitle,
        subtitles: mergedSubtitles,
        aiReview: savedMetadata.aiReview || metadata.aiReview || null,
        sourceSummary: shouldPreferSubtitleSummary
          ? computedMetadata.sourceSummary
          : (savedMetadata.sourceSummary || metadata.sourceSummary || computedMetadata.sourceSummary || ''),
        descriptionSource: shouldPreferSubtitleSummary
          ? computedMetadata.descriptionSource
          : (savedMetadata.descriptionSource || metadata.descriptionSource || computedMetadata.descriptionSource || 'none'),
        suggestedTitle: savedMetadata.suggestedTitle || metadata.suggestedTitle || computedMetadata.suggestedTitle || '',
        suggestedShortTitle: savedMetadata.suggestedShortTitle || metadata.suggestedShortTitle || computedMetadata.suggestedShortTitle || '',
        suggestedDescription: savedMetadata.suggestedDescription || metadata.suggestedDescription || computedMetadata.suggestedDescription || '',
        suggestedTags: Array.isArray(savedMetadata.suggestedTags) && savedMetadata.suggestedTags.length
          ? savedMetadata.suggestedTags
          : (metadata.suggestedTags || computedMetadata.suggestedTags || [])
      };
      const typeLabel = getPublishAssetTypeLabel(sourceType);
      const titleText = truncateDisplayText(
        mergedMetadata?.title ||
        mergedMetadata?.suggestedTitle ||
        mergedMetadata?.suggestedShortTitle ||
        label,
        34
      ).replace(/\s+/g, ' ').trim();
      const authorText = mergedMetadata?.author ? `@${mergedMetadata.author}` : '';
      assets.push({
        id: crypto.createHash('md5').update(fullPath).digest('hex').slice(0, 12),
        label,
        displayLabel: titleText ? `${typeLabel}｜${titleText}` : typeLabel,
        compactLabel: titleText || label,
        typeLabel,
        sourceMetaLine: [typeLabel, authorText].filter(Boolean).join(' · '),
        sourceType,
        path: fullPath,
        url: publicUrl ? `${publicUrl}?t=${stat.mtimeMs}` : '',
        sizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
        metadata: mergedMetadata
      });
    };

    const pipelineVideoPath = path.join(projectRoot, 'public', 'output_final.mp4');
    const pipelineVerticalPath = path.join(projectRoot, 'public', 'output_final_vertical.mp4');
    const pipelineConvertedVerticalPath = path.join(projectRoot, 'public', 'output_9_16.mp4');
    const pipelineConvertedHorizontalPath = path.join(projectRoot, 'public', 'output_16_9.mp4');
    const standaloneVideoPath = path.join(projectRoot, 'public', 'standalone_output_vertical.mp4');
    const pipelineMeta = readMediaMetadata(pipelineVideoPath);
    const standaloneMeta = readMediaMetadata(standaloneVideoPath);
    addAsset(
      '全链路混剪成片',
      pipelineVideoPath,
      '/output_final.mp4',
      'pipeline',
      buildPublishMetadata({
        title: pipelineMeta?.title,
        subtitles: pipelineMeta?.subtitles || [],
        sourceType: 'pipeline'
      })
    );
    addAsset(
      '全链路混剪竖屏成片',
      pipelineVerticalPath,
      '/output_final_vertical.mp4',
      'pipeline',
      buildPublishMetadata({
        title: pipelineMeta?.title,
        subtitles: pipelineMeta?.subtitles || [],
        sourceType: 'pipeline'
      })
    );
    addAsset(
      '全链路混剪转制 9:16',
      pipelineConvertedVerticalPath,
      '/output_9_16.mp4',
      'pipeline',
      buildPublishMetadata({
        title: pipelineMeta?.title,
        subtitles: pipelineMeta?.subtitles || [],
        sourceType: 'pipeline'
      })
    );
    addAsset(
      '全链路混剪转制 16:9',
      pipelineConvertedHorizontalPath,
      '/output_16_9.mp4',
      'pipeline',
      buildPublishMetadata({
        title: pipelineMeta?.title,
        subtitles: pipelineMeta?.subtitles || [],
        sourceType: 'pipeline'
      })
    );
    if (!hasStandaloneRuntimeOutput(standaloneMeta?.taskDir)) {
      addAsset(
        '独立竖屏成片',
        standaloneVideoPath,
        '/standalone_output_vertical.mp4',
        'standalone',
        buildPublishMetadata({
          title: standaloneMeta?.title,
          subtitles: standaloneMeta?.subtitles || [],
          sourceType: 'standalone'
        })
      );
    }

    const runtimeRoot = path.join(projectRoot, 'data', 'uploads', 'runtime_jobs');
    if (fs.existsSync(runtimeRoot)) {
      const dirs = fs.readdirSync(runtimeRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('standalone_'));
      for (const dir of dirs) {
        const jobDir = path.join(runtimeRoot, dir.name);
        const filePath = path.join(jobDir, 'standalone_output_vertical.mp4');
        if (!fs.existsSync(filePath)) continue;
        addAsset(
          `竖屏合成成片 ${dir.name}`,
          filePath,
          `/runtime_jobs/${dir.name}/standalone_output_vertical.mp4`,
          'standalone_runtime',
          buildStandaloneRuntimeMetadata(jobDir)
        );
      }
    }

    if (fs.existsSync(verticalPublicDir)) {
      const dirs = fs.readdirSync(verticalPublicDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      for (const dir of dirs) {
        const filePath = findPreferredVideoFile(path.join(verticalPublicDir, dir.name), 'vertical_output.mp4');
        if (!filePath) continue;
        const publicFileName = path.basename(filePath);
        const jobDir = path.join(verticalQueueRoot, dir.name);
        const content = readJsonIfExists(path.join(jobDir, 'content.json'), {});
        const subtitles = readJsonIfExists(path.join(jobDir, 'subtitles.json'), []);
        const runtimeJob = typeof getVerticalJobById === 'function' ? getVerticalJobById(dir.name) : null;
        addAsset(
          `XAI 批量竖屏 ${dir.name}`,
          filePath,
          `/xai_vertical_queue/${dir.name}/${publicFileName}`,
          'xai_queue',
          buildPublishMetadata({
            title: content?.title || runtimeJob?.title,
            subtitles,
            summary: runtimeJob?.summary,
            sourceType: 'xai_queue',
            sourceUrl: runtimeJob?.postUrl,
            author: runtimeJob?.author
          })
        );
      }
    }

    return assets.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  function getCachedPublishAssets(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && publishAssetsCache.expiresAt > now && Array.isArray(publishAssetsCache.assets)) {
      return publishAssetsCache.assets;
    }
    const assets = collectPublishAssets();
    publishAssetsCache = {
      assets,
      expiresAt: now + 10000
    };
    return assets;
  }

  function resetPublishAssetsCache() {
    publishAssetsCache = { expiresAt: 0, assets: [] };
  }

  return {
    buildShortTitle,
    buildPublishMetadata,
    isReviewCenterHidden,
    collectPublishAssets,
    getCachedPublishAssets,
    resetPublishAssetsCache
  };
}

module.exports = {
  createPublishAssetsService
};

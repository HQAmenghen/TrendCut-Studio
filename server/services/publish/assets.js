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

  function getPublishAssetTypeLabel(sourceType) {
    const map = {
      pipeline: '全链路混剪',
      standalone: '独立竖屏',
      xai_queue: 'XAI 批量竖屏'
    };
    return map[sourceType] || sourceType || '视频素材';
  }

  function truncateDisplayText(text, limit = 28) {
    const value = String(text || '').trim();
    if (!value) return '';
    return value.length > limit ? `${value.slice(0, limit)}...` : value;
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
    const descriptionText = '';

    return {
      suggestedTitle: normalizedTitle,
      suggestedShortTitle: buildShortTitle(normalizedTitle, sourceType === 'xai_queue' ? '热点速递' : '内容速递'),
      suggestedDescription: sanitizePublishDescriptionText(descriptionText),
      suggestedTags: buildPublishTags({ title: normalizedTitle, summary: summaryText || subtitleSnippet, sourceType }),
      sourceSummary: subtitleSnippet || summaryText,
      sourceUrl,
      author
    };
  }

  function collectPublishAssets() {
    const assets = [];
    const addAsset = (label, fullPath, publicUrl, sourceType, metadata = {}) => {
      if (!fs.existsSync(fullPath)) return;
      const stat = fs.statSync(fullPath);
      const typeLabel = getPublishAssetTypeLabel(sourceType);
      const titleText = truncateDisplayText(metadata?.suggestedTitle || metadata?.suggestedShortTitle || label, 34);
      const authorText = metadata?.author ? `@${metadata.author}` : '';
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
        metadata
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

    if (fs.existsSync(verticalPublicDir)) {
      const dirs = fs.readdirSync(verticalPublicDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      for (const dir of dirs) {
        const filePath = path.join(verticalPublicDir, dir.name, 'vertical_output.mp4');
        const jobDir = path.join(verticalQueueRoot, dir.name);
        const content = readJsonIfExists(path.join(jobDir, 'content.json'), {});
        const subtitles = readJsonIfExists(path.join(jobDir, 'subtitles.json'), []);
        const runtimeJob = typeof getVerticalJobById === 'function' ? getVerticalJobById(dir.name) : null;
        addAsset(
          `XAI 批量竖屏 ${dir.name}`,
          filePath,
          `/xai_vertical_queue/${dir.name}/vertical_output.mp4`,
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
    collectPublishAssets,
    getCachedPublishAssets,
    resetPublishAssetsCache
  };
}

module.exports = {
  createPublishAssetsService
};

const Database = require('better-sqlite3');

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
    sanitizePublishDescriptionText,
    assetIndexDbPath
  } = deps;

  let publishAssetsCache = { expiresAt: 0, assets: [] };
  const assetEntryCache = new Map();
  const metadataCache = new Map();
  const MAX_ENTRY_CACHE_SIZE = 500;
  const indexDbPath = assetIndexDbPath || (
    process.env.NODE_ENV === 'test'
      ? ':memory:'
      : path.join(projectRoot, 'data', 'publish_assets.db')
  );
  let indexDb = null;
  let indexStatements = null;

  function getIndexDb() {
    if (indexDb) return indexDb;
    try {
      if (indexDbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(indexDbPath), { recursive: true });
      }
      indexDb = new Database(indexDbPath);
      indexDb.pragma('journal_mode = WAL');
      indexDb.pragma('synchronous = NORMAL');
      indexDb.pragma('busy_timeout = 5000');
      indexDb.exec(`
        CREATE TABLE IF NOT EXISTS publish_assets (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          sourceType TEXT NOT NULL,
          signature TEXT NOT NULL,
          assetJson TEXT NOT NULL,
          updatedAt TEXT,
          lastSeenAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_publish_assets_source_updated ON publish_assets(sourceType, updatedAt DESC);
        CREATE INDEX IF NOT EXISTS idx_publish_assets_updated ON publish_assets(updatedAt DESC);
      `);
      indexStatements = {
        getByPath: indexDb.prepare('SELECT signature, assetJson FROM publish_assets WHERE path = ?'),
        upsert: indexDb.prepare(`
          INSERT INTO publish_assets (id, path, sourceType, signature, assetJson, updatedAt, lastSeenAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET
            id = excluded.id,
            sourceType = excluded.sourceType,
            signature = excluded.signature,
            assetJson = excluded.assetJson,
            updatedAt = excluded.updatedAt,
            lastSeenAt = excluded.lastSeenAt
        `),
        deleteByPath: indexDb.prepare('DELETE FROM publish_assets WHERE path = ?'),
        deleteMissing: indexDb.prepare('DELETE FROM publish_assets WHERE path NOT IN (SELECT value FROM json_each(?))')
      };
    } catch (err) {
      console.warn('[publish-assets] 索引库初始化失败，回退到内存缓存:', err.message);
      indexDb = null;
      indexStatements = null;
    }
    return indexDb;
  }

  function readIndexedAsset(fullPath, signature) {
    if (!getIndexDb() || !indexStatements) return null;
    try {
      const row = indexStatements.getByPath.get(fullPath);
      if (!row || row.signature !== signature) return null;
      return JSON.parse(row.assetJson);
    } catch (_err) {
      return null;
    }
  }

  function writeIndexedAsset(asset, signature) {
    if (!asset || !getIndexDb() || !indexStatements) return;
    try {
      indexStatements.upsert.run(
        asset.id,
        asset.path,
        asset.sourceType,
        signature,
        JSON.stringify(asset),
        asset.updatedAt || '',
        new Date().toISOString()
      );
    } catch (_err) {}
  }

  function deleteIndexedAsset(fullPath) {
    if (!fullPath || !getIndexDb() || !indexStatements) return;
    try {
      indexStatements.deleteByPath.run(fullPath);
    } catch (_err) {}
  }

  function deleteMissingIndexedAssets(seenPaths) {
    if (!getIndexDb() || !indexStatements || !Array.isArray(seenPaths) || !seenPaths.length) return;
    try {
      indexStatements.deleteMissing.run(JSON.stringify(seenPaths));
    } catch (_err) {}
  }

  function safeStat(filePath) {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;
      return fs.statSync(filePath);
    } catch (_err) {
      return null;
    }
  }

  function statFingerprint(filePath) {
    const stat = safeStat(filePath);
    if (!stat) return `${filePath}:missing`;
    return `${filePath}:${stat.isFile() ? 'f' : 'd'}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
  }

  function filesFingerprint(filePaths = []) {
    return filePaths.map((filePath) => statFingerprint(filePath)).join('|');
  }

  function rememberCacheEntry(cache, key, entry) {
    cache.set(key, entry);
    if (cache.size <= MAX_ENTRY_CACHE_SIZE) return entry;
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
    return entry;
  }

  function getCachedMetadata(key, dependencyPaths, builder) {
    const signature = filesFingerprint(dependencyPaths);
    const cached = metadataCache.get(key);
    if (cached && cached.signature === signature) {
      return cached.value;
    }
    const value = builder();
    rememberCacheEntry(metadataCache, key, { signature, value });
    return value;
  }

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
    const videoPath = path.join(jobDir, 'standalone_output_vertical.mp4');
    const mediaMeta = readMediaMetadata(videoPath);
    const content = readJsonIfExists(path.join(jobDir, 'content.json'), {});
    const context = readJsonIfExists(path.join(jobDir, 'original_context.json'), {});
    const subtitles = readJsonIfExists(path.join(jobDir, 'subtitles.json'), []);
    const title = String(content?.title || mediaMeta?.title || context?.title || '').trim();
    const summary = String(context?.body || context?.summary || '').trim();

    return {
      ...buildPublishMetadata({
        title,
        subtitles: mediaMeta?.subtitles || subtitles,
        summary,
        sourceType: 'standalone_runtime',
        sourceUrl: context?.postUrl || context?.sourceUrl || '',
        author: context?.author || ''
      }),
      sourceTaskDir: mediaMeta?.sourceTaskDir || ''
    };
  }

  function buildStandaloneRuntimeMetadataCached(jobDir) {
    return getCachedMetadata(
      `standalone_runtime:${jobDir}`,
      [
        path.join(jobDir, 'standalone_output_vertical.mp4.meta.json'),
        path.join(jobDir, 'content.json'),
        path.join(jobDir, 'original_context.json'),
        path.join(jobDir, 'subtitles.json')
      ],
      () => buildStandaloneRuntimeMetadata(jobDir)
    );
  }

  function buildQueueMetadataCached(dirName, filePath, runtimeJob = null) {
    const jobDir = path.join(verticalQueueRoot, dirName);
    const runtimeSignature = [
      runtimeJob?.updatedAt || '',
      runtimeJob?.title || '',
      runtimeJob?.summary || '',
      runtimeJob?.postUrl || '',
      runtimeJob?.author || ''
    ].join(':');
    return getCachedMetadata(
      `xai_queue:${dirName}:${runtimeSignature}`,
      [
        `${filePath}.meta.json`,
        path.join(jobDir, 'content.json'),
        path.join(jobDir, 'subtitles.json')
      ],
      () => {
        const content = readJsonIfExists(path.join(jobDir, 'content.json'), {});
        const subtitles = readJsonIfExists(path.join(jobDir, 'subtitles.json'), []);
        return buildPublishMetadata({
          title: content?.title || runtimeJob?.title,
          subtitles,
          summary: runtimeJob?.summary,
          sourceType: 'xai_queue',
          sourceUrl: runtimeJob?.postUrl,
          author: runtimeJob?.author
        });
      }
    );
  }

  function hasStandaloneRuntimeOutput(taskDir) {
    const normalizedTaskDir = String(taskDir || '').trim();
    if (!normalizedTaskDir) return false;
    const outputPath = path.join(normalizedTaskDir, 'standalone_output_vertical.mp4');
    return fs.existsSync(outputPath) && fs.statSync(outputPath).isFile();
  }

  function buildAsset(label, fullPath, publicUrl, sourceType, metadata, stat) {
    const savedMetadata = readMediaMetadata(fullPath) || {};
    if (isReviewCenterHidden(savedMetadata) || isReviewCenterHidden(metadata)) {
      return null;
    }
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
    return {
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
    };
  }

  function collectPublishAssets() {
    const assets = [];
    const seenPaths = [];
    const addAsset = (label, fullPath, publicUrl, sourceType, metadataInput = {}, dependencyPaths = [], signatureSalt = '') => {
      const stat = safeStat(fullPath);
      if (!stat || !stat.isFile()) return;
      seenPaths.push(fullPath);
      const cacheKey = `${sourceType}:${fullPath}`;
      const signature = [
        filesFingerprint([fullPath, `${fullPath}.meta.json`, ...dependencyPaths]),
        String(signatureSalt || '')
      ].join('||');
      const cached = assetEntryCache.get(cacheKey);
      if (cached && cached.signature === signature) {
        if (cached.asset) assets.push(cached.asset);
        return;
      }
      const indexedAsset = readIndexedAsset(fullPath, signature);
      if (indexedAsset) {
        rememberCacheEntry(assetEntryCache, cacheKey, { signature, asset: indexedAsset });
        assets.push(indexedAsset);
        return;
      }
      const metadata = typeof metadataInput === 'function' ? metadataInput() : (metadataInput || {});
      const asset = buildAsset(label, fullPath, publicUrl, sourceType, metadata, stat);
      if (!asset) {
        deleteIndexedAsset(fullPath);
        rememberCacheEntry(assetEntryCache, cacheKey, { signature, asset: null });
        return;
      }
      writeIndexedAsset(asset, signature);
      rememberCacheEntry(assetEntryCache, cacheKey, { signature, asset });
      assets.push(asset);
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
      () => buildPublishMetadata({
        title: pipelineMeta?.title,
        subtitles: pipelineMeta?.subtitles || [],
        sourceType: 'pipeline'
      }),
      [],
      filesFingerprint([`${pipelineVideoPath}.meta.json`])
    );
    addAsset(
      '全链路混剪竖屏成片',
      pipelineVerticalPath,
      '/output_final_vertical.mp4',
      'pipeline',
      () => buildPublishMetadata({
        title: pipelineMeta?.title,
        subtitles: pipelineMeta?.subtitles || [],
        sourceType: 'pipeline'
      }),
      [],
      filesFingerprint([`${pipelineVideoPath}.meta.json`])
    );
    addAsset(
      '全链路混剪转制 9:16',
      pipelineConvertedVerticalPath,
      '/output_9_16.mp4',
      'pipeline',
      () => buildPublishMetadata({
        title: pipelineMeta?.title,
        subtitles: pipelineMeta?.subtitles || [],
        sourceType: 'pipeline'
      }),
      [],
      filesFingerprint([`${pipelineVideoPath}.meta.json`])
    );
    addAsset(
      '全链路混剪转制 16:9',
      pipelineConvertedHorizontalPath,
      '/output_16_9.mp4',
      'pipeline',
      () => buildPublishMetadata({
        title: pipelineMeta?.title,
        subtitles: pipelineMeta?.subtitles || [],
        sourceType: 'pipeline'
      }),
      [],
      filesFingerprint([`${pipelineVideoPath}.meta.json`])
    );
    if (!hasStandaloneRuntimeOutput(standaloneMeta?.taskDir)) {
      addAsset(
        '独立竖屏成片',
        standaloneVideoPath,
        '/standalone_output_vertical.mp4',
        'standalone',
        () => buildPublishMetadata({
          title: standaloneMeta?.title,
          subtitles: standaloneMeta?.subtitles || [],
          sourceType: 'standalone'
        }),
        [],
        filesFingerprint([`${standaloneVideoPath}.meta.json`])
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
          () => buildStandaloneRuntimeMetadataCached(jobDir),
          [
            path.join(jobDir, 'content.json'),
            path.join(jobDir, 'original_context.json'),
            path.join(jobDir, 'subtitles.json')
          ],
          dir.name
        );
      }
    }

    if (fs.existsSync(verticalPublicDir)) {
      const dirs = fs.readdirSync(verticalPublicDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      for (const dir of dirs) {
        const filePath = findPreferredVideoFile(path.join(verticalPublicDir, dir.name), 'vertical_output.mp4');
        if (!filePath) continue;
        const publicFileName = path.basename(filePath);
        const runtimeJob = typeof getVerticalJobById === 'function' ? getVerticalJobById(dir.name) : null;
        addAsset(
          `XAI 批量竖屏 ${dir.name}`,
          filePath,
          `/xai_vertical_queue/${dir.name}/${publicFileName}`,
          'xai_queue',
          () => buildQueueMetadataCached(dir.name, filePath, runtimeJob),
          [
            path.join(verticalQueueRoot, dir.name, 'content.json'),
            path.join(verticalQueueRoot, dir.name, 'subtitles.json')
          ],
          [
            dir.name,
            runtimeJob?.updatedAt || '',
            runtimeJob?.title || '',
            runtimeJob?.summary || '',
            runtimeJob?.postUrl || '',
            runtimeJob?.author || ''
          ].join(':')
        );
      }
    }

    deleteMissingIndexedAssets(seenPaths);
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
    assetEntryCache.clear();
    metadataCache.clear();
  }

  function close() {
    if (!indexDb) return;
    try {
      indexDb.close();
    } catch (_err) {}
    indexDb = null;
    indexStatements = null;
  }

  function deletePublishAsset(assetId) {
    const normalizedAssetId = String(assetId || '').trim();
    if (!normalizedAssetId) return null;

    const asset = collectPublishAssets().find((item) => item.id === normalizedAssetId);
    if (!asset) return null;

    const targetPath = path.resolve(asset.path);
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      resetPublishAssetsCache();
      return null;
    }

    fs.rmSync(targetPath, { force: true });
    const metadataPath = `${targetPath}.meta.json`;
    const deletedMetadata = fs.existsSync(metadataPath) && fs.statSync(metadataPath).isFile();
    if (deletedMetadata) {
      fs.rmSync(metadataPath, { force: true });
    }

    resetPublishAssetsCache();
    return {
      asset,
      deletedPath: targetPath,
      deletedMetadata
    };
  }

  return {
    buildShortTitle,
    buildPublishMetadata,
    isReviewCenterHidden,
    collectPublishAssets,
    getCachedPublishAssets,
    deletePublishAsset,
    resetPublishAssetsCache,
    close
  };
}

module.exports = {
  createPublishAssetsService
};

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPublishAssetsService } = require('../assets');

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

describe('publish assets collection', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-assets-'));
    fs.mkdirSync(path.join(tempRoot, 'public'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'projects'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('includes completed standalone vertical runtime videos but not material horizontal outputs', () => {
    const materialProjectDir = path.join(tempRoot, 'projects', 'material_1778210404130_b9ab2b25');
    fs.mkdirSync(materialProjectDir, { recursive: true });
    fs.writeFileSync(path.join(materialProjectDir, 'output_final.mp4'), 'horizontal half product');

    const runtimeJobDir = path.join(tempRoot, 'data', 'uploads', 'runtime_jobs', 'standalone_1778214630863_4ff35aa7');
    fs.mkdirSync(runtimeJobDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeJobDir, 'standalone_output_vertical.mp4'), 'vertical final video');
    fs.writeFileSync(path.join(runtimeJobDir, 'standalone_input.mp4'), 'source video');
    const publicStandalonePath = path.join(tempRoot, 'public', 'standalone_output_vertical.mp4');
    fs.writeFileSync(publicStandalonePath, 'latest mutable alias');
    writeJson(`${publicStandalonePath}.meta.json`, {
      taskDir: runtimeJobDir,
      title: '以太坊被低估'
    });
    writeJson(path.join(runtimeJobDir, 'content.json'), {
      title: '以太坊被低估'
    });
    writeJson(path.join(runtimeJobDir, 'original_context.json'), {
      body: 'Tom Lee predicts Ethereum to $62,500 per coin.',
      postUrl: 'https://x.com/example/status/1'
    });
    writeJson(path.join(runtimeJobDir, 'subtitles.json'), [
      { zh: '以太坊被低估' }
    ]);

    const service = createPublishAssetsService({
      fs,
      path,
      crypto: require('crypto'),
      projectRoot: tempRoot,
      verticalPublicDir: path.join(tempRoot, 'public', 'xai_vertical_queue'),
      verticalQueueRoot: path.join(tempRoot, 'data', 'uploads', 'xai_vertical_queue'),
      getVerticalJobById: jest.fn(),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      readMediaMetadata: (videoPath) => {
        const metadataPath = `${videoPath}.meta.json`;
        if (!fs.existsSync(metadataPath)) return null;
        return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      },
      sanitizePublishDescriptionText: (text) => String(text || '').trim()
    });

    const assets = service.collectPublishAssets();
    const standaloneAsset = assets.find((asset) => asset.sourceType === 'standalone_runtime');

    expect(standaloneAsset).toEqual(expect.objectContaining({
      label: '竖屏合成成片 standalone_1778214630863_4ff35aa7',
      path: path.join(runtimeJobDir, 'standalone_output_vertical.mp4'),
      sourceType: 'standalone_runtime',
      typeLabel: '竖屏合成成片'
    }));
    expect(standaloneAsset.url).toMatch(/^\/runtime_jobs\/standalone_1778214630863_4ff35aa7\/standalone_output_vertical\.mp4\?t=/);
    expect(standaloneAsset.metadata).toEqual(expect.objectContaining({
      sourceUrl: 'https://x.com/example/status/1',
      suggestedTitle: '以太坊被低估',
      sourceSummary: '以太坊被低估'
    }));
    expect(assets.some((asset) => asset.path.endsWith(path.join('material_1778210404130_b9ab2b25', 'output_final.mp4')))).toBe(false);
    expect(assets.some((asset) => asset.path.endsWith('standalone_input.mp4'))).toBe(false);
    expect(assets.some((asset) => asset.sourceType === 'standalone')).toBe(false);
  });

  test('excludes videos hidden by review center deletion', () => {
    const runtimeJobDir = path.join(tempRoot, 'data', 'uploads', 'runtime_jobs', 'standalone_1778214630863_hidden');
    fs.mkdirSync(runtimeJobDir, { recursive: true });
    const videoPath = path.join(runtimeJobDir, 'standalone_output_vertical.mp4');
    fs.writeFileSync(videoPath, 'hidden vertical final video');
    writeJson(`${videoPath}.meta.json`, {
      title: '已删除审核记录的视频',
      reviewCenterHiddenAt: '2026-05-11T08:00:00.000Z',
      reviewCenterHiddenReviewId: 'auto_1778214630863'
    });
    writeJson(path.join(runtimeJobDir, 'content.json'), {
      title: '已删除审核记录的视频'
    });

    const service = createPublishAssetsService({
      fs,
      path,
      crypto: require('crypto'),
      projectRoot: tempRoot,
      verticalPublicDir: path.join(tempRoot, 'public', 'xai_vertical_queue'),
      verticalQueueRoot: path.join(tempRoot, 'data', 'uploads', 'xai_vertical_queue'),
      getVerticalJobById: jest.fn(),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      readMediaMetadata: (candidatePath) => {
        const metadataPath = `${candidatePath}.meta.json`;
        if (!fs.existsSync(metadataPath)) return null;
        return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      },
      sanitizePublishDescriptionText: (text) => String(text || '').trim()
    });

    const assets = service.collectPublishAssets();

    expect(assets).toHaveLength(0);
  });
});

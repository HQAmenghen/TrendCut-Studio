const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../store', () => ({
  readReviewConfig: jest.fn(),
  writeReviewConfig: jest.fn(),
  createReviewRecord: jest.fn(),
  updateReviewRecord: jest.fn(),
  getReviewRecord: jest.fn(),
  getReviewHistory: jest.fn(),
  deleteReviewRecord: jest.fn()
}));

jest.mock('../executor', () => ({
  executeReviewScript: jest.fn()
}));

const store = require('../store');
const { executeReviewScript } = require('../executor');
const { createReviewHandlers } = require('../handlers');

function createResponse() {
  return {
    json: jest.fn()
  };
}

describe('review handlers persistence boundaries', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'review-handlers-'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('deleteReview hides metadata-only auto review records from review center', () => {
    const videoPath = path.join(tempRoot, 'vertical_output.mp4');
    const writeMediaMetadata = jest.fn();
    const resetPublishAssetsCache = jest.fn();
    const handlers = createReviewHandlers({
      sendError: jest.fn(),
      readMediaMetadata: jest.fn(() => ({
        suggestedTitle: '已审核视频',
        aiReview: {
          reviewId: 'auto_1778197633196',
          status: 'passed',
          overallScore: 70
        }
      })),
      writeMediaMetadata,
      resetPublishAssetsCache
    });

    store.getReviewRecord.mockReturnValue(null);
    store.deleteReviewRecord.mockReturnValue(0);

    const res = createResponse();
    handlers.deleteReview({
      params: { reviewId: 'auto_1778197633196' },
      query: { videoPath },
      body: {}
    }, res);

    expect(store.deleteReviewRecord).toHaveBeenCalledWith('auto_1778197633196');
    expect(writeMediaMetadata).toHaveBeenCalledTimes(1);
    const savedMetadata = writeMediaMetadata.mock.calls[0][1];
    expect(savedMetadata).toEqual(expect.objectContaining({
      suggestedTitle: '已审核视频',
      reviewCenterHiddenAt: expect.any(String),
      reviewCenterHiddenReviewId: 'auto_1778197633196'
    }));
    expect(savedMetadata.aiReview).toBeUndefined();
    expect(resetPublishAssetsCache).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      deletedRecords: 0,
      metadataCleared: true,
      reviewCenterHidden: true
    }));
  });

  test('reviewVideo persists failed review status to media metadata', async () => {
    const videoPath = path.join(tempRoot, 'output.mp4');
    fs.writeFileSync(videoPath, 'video');

    const sendError = jest.fn();
    const writeMediaMetadata = jest.fn();
    const resetPublishAssetsCache = jest.fn();
    const handlers = createReviewHandlers({
      sendError,
      readMediaMetadata: jest.fn(() => ({
        suggestedTitle: '待审核视频',
        reviewCenterHiddenAt: '2026-05-01T00:00:00.000Z',
        reviewCenterHiddenReviewId: 'old_review'
      })),
      writeMediaMetadata,
      resetPublishAssetsCache
    });

    store.readReviewConfig.mockReturnValue({
      enabled: 1,
      auto_skip_on_error: 0
    });
    executeReviewScript.mockRejectedValue(new Error('LLM unavailable'));

    const res = createResponse();
    await handlers.reviewVideo({
      body: {
        videoPath,
        assetId: 'asset_1'
      }
    }, res);

    expect(store.createReviewRecord).toHaveBeenCalledWith(expect.objectContaining({
      asset_id: 'asset_1',
      video_path: videoPath,
      review_status: 'reviewing'
    }));
    expect(writeMediaMetadata).toHaveBeenCalledWith(videoPath, expect.objectContaining({
      suggestedTitle: '待审核视频',
      aiReview: expect.objectContaining({
        status: 'reviewing'
      })
    }));
    expect(writeMediaMetadata.mock.calls[0][1].reviewCenterHiddenAt).toBeUndefined();
    expect(writeMediaMetadata.mock.calls[0][1].reviewCenterHiddenReviewId).toBeUndefined();
    expect(writeMediaMetadata).toHaveBeenCalledWith(videoPath, expect.objectContaining({
      suggestedTitle: '待审核视频',
      aiReview: expect.objectContaining({
        status: 'failed',
        error: 'LLM unavailable',
        manuallySkipped: false
      })
    }));
    expect(resetPublishAssetsCache).toHaveBeenCalled();
    expect(sendError).toHaveBeenCalledWith(res, expect.objectContaining({
      status: 500,
      code: 'REVIEW_EXECUTION_FAILED',
      stage: 'review.execute'
    }));
  });

  test('reviewVideo preserves runtime job title when no media metadata exists yet', async () => {
    const runtimeRoot = path.join(tempRoot, 'data', 'uploads', 'runtime_jobs');
    const jobDir = path.join(runtimeRoot, 'standalone_1778214630863_4ff35aa7');
    const videoPath = path.join(jobDir, 'standalone_output_vertical.mp4');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(videoPath, 'video');
    fs.writeFileSync(path.join(jobDir, 'content.json'), JSON.stringify({
      title: '以太坊被低估'
    }));

    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tempRoot);
    const sendError = jest.fn();
    const writeMediaMetadata = jest.fn();
    const resetPublishAssetsCache = jest.fn();
    const handlers = createReviewHandlers({
      sendError,
      readMediaMetadata: jest.fn(() => null),
      writeMediaMetadata,
      resetPublishAssetsCache
    });

    store.readReviewConfig.mockReturnValue({
      enabled: 1,
      auto_skip_on_error: 0
    });
    executeReviewScript.mockResolvedValue({
      status: 'passed',
      overall_score: 79,
      scores: {
        content: 80,
        subtitle: 82,
        title: 76,
        editing: 78
      },
      content_analysis: {},
      subtitle_analysis: {},
      title_analysis: {},
      editing_analysis: {},
      fix_suggestions: [],
      passed: true
    });

    const res = createResponse();
    try {
      await handlers.reviewVideo({
        body: {
          videoPath,
          assetId: 'asset_1'
        }
      }, res);
    } finally {
      cwdSpy.mockRestore();
    }

    const savedMetadataItems = writeMediaMetadata.mock.calls.map((call) => call[1]);
    expect(savedMetadataItems).toHaveLength(2);
    savedMetadataItems.forEach((metadata) => {
      expect(metadata).toEqual(expect.objectContaining({
        title: '以太坊被低估',
        suggestedTitle: '以太坊被低估',
        suggestedShortTitle: '以太坊被低估'
      }));
      expect(metadata.title).not.toBe('standalone output vertical');
    });
    expect(sendError).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      renamed: false
    }));
  });

  test('reviewVideo repairs default suggested title without losing saved title', async () => {
    const videoPath = path.join(tempRoot, 'vertical_output.mp4');
    fs.writeFileSync(videoPath, 'video');

    const sendError = jest.fn();
    const writeMediaMetadata = jest.fn();
    const resetPublishAssetsCache = jest.fn();
    const handlers = createReviewHandlers({
      sendError,
      readMediaMetadata: jest.fn(() => ({
        title: '黄仁勋警告\n不会AI的求职者没戏了？',
        suggestedTitle: 'vertical output',
        suggestedShortTitle: 'vertical output'
      })),
      writeMediaMetadata,
      resetPublishAssetsCache
    });

    store.readReviewConfig.mockReturnValue({
      enabled: 1,
      auto_skip_on_error: 0
    });
    executeReviewScript.mockResolvedValue({
      status: 'passed',
      overall_score: 82,
      scores: {
        content: 84,
        subtitle: 85,
        title: 80,
        editing: 81
      },
      content_analysis: {},
      subtitle_analysis: {},
      title_analysis: {},
      editing_analysis: {},
      fix_suggestions: [],
      passed: true
    });

    const res = createResponse();
    await handlers.reviewVideo({
      body: {
        videoPath,
        assetId: 'asset_2'
      }
    }, res);

    const savedMetadataItems = writeMediaMetadata.mock.calls.map((call) => call[1]);
    expect(savedMetadataItems).toHaveLength(2);
    savedMetadataItems.forEach((metadata) => {
      expect(metadata).toEqual(expect.objectContaining({
        title: '黄仁勋警告\n不会AI的求职者没戏了？',
        suggestedTitle: '黄仁勋警告\n不会AI的求职者没戏了？',
        suggestedShortTitle: '黄仁勋警告\n不会AI的求职者没戏了？'
      }));
      expect(metadata.suggestedTitle).not.toBe('vertical output');
    });
    expect(sendError).not.toHaveBeenCalled();
  });

  test('regenerateVideo recovers runtime content title before enqueueing subtitle repair', async () => {
    const queueRoot = path.join(tempRoot, 'data', 'uploads', 'xai_vertical_queue');
    const publicRoot = path.join(tempRoot, 'public', 'xai_vertical_queue');
    const jobDir = path.join(queueRoot, 'queue_title_repair');
    const videoPath = path.join(publicRoot, 'queue_title_repair', 'vertical_output.mp4');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.mkdirSync(path.dirname(videoPath), { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'source.mp4'), 'source video');
    fs.writeFileSync(path.join(jobDir, 'content.json'), JSON.stringify({
      title: '运行目录保留标题'
    }));
    fs.writeFileSync(videoPath, 'reviewed video');

    const sendError = jest.fn();
    const writeMediaMetadata = jest.fn();
    const enqueue = jest.fn((params) => ({ id: 'regen_title_repair', params }));
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tempRoot);
    const handlers = createReviewHandlers({
      sendError,
      readMediaMetadata: jest.fn(() => ({
        taskDir: jobDir,
        sourceType: 'xai_queue',
        videoUrl: 'https://cdn.example.com/source.mp4',
        title: 'vertical output',
        suggestedTitle: 'vertical output',
        suggestedShortTitle: '',
        aiReview: {
          reviewId: 'review_subtitle',
          overallScore: 65,
          scores: {
            content: 82,
            subtitle: 60,
            title: 86,
            editing: 80
          },
          fixSuggestions: [
            {
              category: 'subtitle',
              severity: 'high',
              issue: '字幕错位',
              suggestion: '重新打轴'
            }
          ]
        }
      })),
      writeMediaMetadata,
      verticalQueueService: { enqueue },
      resetPublishAssetsCache: jest.fn()
    });

    const res = createResponse();
    try {
      await handlers.regenerateVideo({
        body: { videoPath }
      }, res);
    } finally {
      cwdSpy.mockRestore();
    }

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      title: '运行目录保留标题'
    }));
    expect(writeMediaMetadata).toHaveBeenCalledWith(videoPath, expect.objectContaining({
      title: '运行目录保留标题',
      suggestedTitle: '运行目录保留标题',
      suggestedShortTitle: '运行目录保留标题',
      regeneration: expect.objectContaining({
        status: 'queued',
        queueJobId: 'regen_title_repair'
      })
    }));
    expect(sendError).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      jobId: 'regen_title_repair'
    }));
  });
});

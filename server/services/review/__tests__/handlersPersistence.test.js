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
});

const fs = require('fs');
const os = require('os');
const path = require('path');

const { enqueueRegenerationFromReview } = require('../regenerate');

describe('review regeneration title preservation', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'review-regenerate-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('uses the saved media title for subtitle-only regeneration jobs', () => {
    const taskDir = path.join(tempRoot, 'queue_job');
    fs.mkdirSync(taskDir, { recursive: true });
    const sourceVideoPath = path.join(taskDir, 'source.mp4');
    const reviewedVideoPath = path.join(tempRoot, 'public', 'vertical_output.mp4');
    fs.mkdirSync(path.dirname(reviewedVideoPath), { recursive: true });
    fs.writeFileSync(sourceVideoPath, 'source video');
    fs.writeFileSync(reviewedVideoPath, 'reviewed video');

    const enqueue = jest.fn((params) => ({ id: 'regen_job', params }));
    const writeMediaMetadata = jest.fn();
    const metadata = {
      taskDir,
      sourceType: 'xai_queue',
      videoUrl: 'https://cdn.example.com/source.mp4',
      title: '保留审核中心标题',
      suggestedTitle: '',
      aiReview: {
        reviewId: 'review_1',
        overallScore: 68,
        scores: {
          content: 82,
          subtitle: 60,
          title: 88,
          editing: 80
        },
        fixSuggestions: [
          {
            category: 'subtitle',
            severity: 'high',
            issue: '字幕时间轴错位',
            suggestion: '重新打轴'
          }
        ]
      }
    };

    const result = enqueueRegenerationFromReview({
      videoPath: reviewedVideoPath,
      metadata,
      verticalQueueService: { enqueue },
      writeMediaMetadata,
      trigger: 'manual'
    });

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      title: '保留审核中心标题'
    }));
    expect(result.adjustments.needsSubtitleRegeneration).toBe(true);
    expect(writeMediaMetadata).toHaveBeenCalledWith(reviewedVideoPath, expect.objectContaining({
      title: '保留审核中心标题',
      regeneration: expect.objectContaining({
        status: 'queued',
        queueJobId: 'regen_job'
      })
    }));
  });
});

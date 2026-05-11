const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildNarrationSummary, emitNarrationSummary } = require('../events');
const { taskClients } = require('../sharedState');

describe('material-driven progress events', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'material-driven-events-'));
    taskClients.clear();
  });

  afterEach(() => {
    taskClients.clear();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('builds narration summary directly from narration.json', () => {
    fs.writeFileSync(path.join(tempRoot, 'narration.json'), JSON.stringify({
      target_duration_sec: 12.5,
      full_text: '第一句口播。\n第二句口播。'
    }), 'utf8');

    expect(buildNarrationSummary({ outputPath: tempRoot })).toEqual({
      targetDuration: 12.5,
      charCount: 13,
      speed: 1,
      fullText: '第一句口播。\n第二句口播。'
    });
  });

  test('emits narration summary only once for the same file contents', () => {
    fs.writeFileSync(path.join(tempRoot, 'narration.json'), JSON.stringify({
      target_duration_sec: 10,
      full_text: '稳定显示口播稿'
    }), 'utf8');

    const writes = [];
    const client = {
      write: (chunk) => writes.push(chunk)
    };
    taskClients.set('job-1', new Set([client]));

    const task = { outputPath: tempRoot };
    expect(emitNarrationSummary('job-1', task)).toBe(true);
    expect(emitNarrationSummary('job-1', task)).toBe(false);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('narration_summary');
    expect(writes[0]).toContain('稳定显示口播稿');
  });
});

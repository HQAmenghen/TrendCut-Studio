const fs = require('fs');
const os = require('os');
const path = require('path');

const { _test } = require('../autoStart');

describe('material-driven AutoPilot avatar reference gate', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autostart-avatar-reference-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function createTask(extra = {}) {
    const outputPath = path.join(tempRoot, `material_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    fs.mkdirSync(outputPath, { recursive: true });
    return {
      outputPath,
      avatarConfig: {
        renderProvider: 'runninghub'
      },
      ...extra
    };
  }

  test('fails before step 6 when aiman.mp4 exists but the motion reference video is missing', () => {
    const task = createTask();
    fs.writeFileSync(path.join(task.outputPath, 'aiman.mp4'), 'stale-avatar-video', 'utf8');
    fs.writeFileSync(path.join(task.outputPath, 'avatar_render_state.json'), JSON.stringify({
      provider: 'runninghub',
      status: 'downloaded',
      taskId: 'stale-task',
      remotePoseName: 'api/avatar_motion_source.mp4',
      nodeInfoList: [
        { nodeId: '279', fieldName: 'video', fieldValue: 'api/avatar_motion_source.mp4' }
      ]
    }), 'utf8');

    expect(() => _test.assertMotionReferenceReady(task)).toThrow('缺少数字人动作参考视频');
  });

  test('fails before step 6 when RunningHub state has no motion reference node proof', () => {
    const task = createTask();
    fs.writeFileSync(path.join(task.outputPath, 'aiman.mp4'), 'stale-avatar-video', 'utf8');
    fs.writeFileSync(path.join(task.outputPath, 'avatar_motion_source.mp4'), 'motion-reference', 'utf8');
    fs.writeFileSync(path.join(task.outputPath, 'avatar_render_state.json'), JSON.stringify({
      provider: 'runninghub',
      status: 'downloaded',
      taskId: 'pose-less-task',
      remotePoseName: '',
      nodeInfoList: [
        { nodeId: '6', fieldName: 'audio', fieldValue: 'api/avatar.wav' },
        { nodeId: '180', fieldName: 'image', fieldValue: 'api/avatar.png' }
      ]
    }), 'utf8');

    expect(() => _test.assertMotionReferenceReady(task)).toThrow('缺少动作参考视频节点输入');
  });

  test('allows step 6 only when the local reference and RunningHub pose input are both present', () => {
    const task = createTask();
    fs.writeFileSync(path.join(task.outputPath, 'aiman.mp4'), 'avatar-video', 'utf8');
    fs.writeFileSync(path.join(task.outputPath, 'avatar_motion_source.mp4'), 'motion-reference', 'utf8');
    fs.writeFileSync(path.join(task.outputPath, 'avatar_render_state.json'), JSON.stringify({
      provider: 'runninghub',
      status: 'downloaded',
      taskId: 'pose-task',
      remotePoseName: 'api/avatar_motion_source.mp4',
      nodeInfoList: [
        { nodeId: '279', fieldName: 'video', fieldValue: 'api/avatar_motion_source.mp4' }
      ]
    }), 'utf8');

    expect(() => _test.assertMotionReferenceReady(task)).not.toThrow();
  });
});

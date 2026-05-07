const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  listMaterialTasks,
  resolveMaterialTaskImport
} = require('../taskImport');

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

describe('vertical material task import', () => {
  let projectsDir;

  beforeEach(() => {
    projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vertical-task-import-'));
  });

  afterEach(() => {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  });

  test('lists completed material-driven tasks with task JSON summary', () => {
    const completedDir = path.join(projectsDir, 'material_done_123');
    const incompleteDir = path.join(projectsDir, 'material_pending_456');
    fs.mkdirSync(completedDir, { recursive: true });
    fs.mkdirSync(incompleteDir, { recursive: true });
    fs.writeFileSync(path.join(completedDir, 'output_final.mp4'), 'video');
    fs.writeFileSync(path.join(incompleteDir, 'material.mp4'), 'source');
    writeJson(path.join(completedDir, 'source_post.json'), {
      title: '任务来源标题',
      body: '任务来源正文',
      postUrl: 'https://example.com/post'
    });
    writeJson(path.join(completedDir, 'narration.json'), {
      full_text: '完整口播脚本'
    });
    writeJson(path.join(completedDir, 'subtitles.json'), [
      { time: [0, 1], zh: '中文字幕', en: 'English subtitle' }
    ]);

    const tasks = listMaterialTasks({ projectsDir });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'material_done_123',
      outputDir: 'material_done_123',
      title: '任务来源标题',
      videoUrl: '/projects/material_done_123/output_final.mp4',
      hasSubtitles: true,
      subtitleSource: 'subtitles.json',
      sourcePostUrl: 'https://example.com/post'
    });
    expect(tasks[0].scriptPreview).toBe('完整口播脚本');
  });

  test('resolves a selected task into standalone render inputs and recovers execution plan subtitles', () => {
    const taskDir = path.join(projectsDir, 'material_plan_only');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'output_final.mp4'), 'video');
    writeJson(path.join(taskDir, 'source_post.json'), {
      title: '执行计划标题',
      body: '执行计划正文'
    });
    writeJson(path.join(taskDir, 'narration.json'), {
      full_text: '执行计划口播'
    });
    writeJson(path.join(taskDir, 'subtitles.json'), []);
    writeJson(path.join(taskDir, 'execution_plan.json'), [
      {
        start_time: 0,
        end_time: 2,
        subtitle_text: '第一句',
        subtitle_en: 'First line'
      },
      {
        start_time: 2,
        end_time: 3,
        subtitle_text: '第一句'
      },
      {
        start_time: 3,
        end_time: 4,
        subtitle_text: '第二句',
        en: 'Second line'
      }
    ]);

    const resolved = resolveMaterialTaskImport({
      projectsDir,
      taskDir: 'material_plan_only'
    });

    expect(resolved).toMatchObject({
      outputDir: 'material_plan_only',
      title: '执行计划标题',
      subtitleSource: 'execution_plan.json',
      script: '执行计划口播'
    });
    expect(resolved.videoPath).toBe(path.join(taskDir, 'output_final.mp4'));
    expect(resolved.context).toEqual({
      title: '执行计划标题',
      body: '执行计划正文'
    });
    expect(resolved.subtitles).toEqual([
      { time: [0, 3], zh: '第一句', en: 'First line' },
      { time: [3, 4], zh: '第二句', en: 'Second line' }
    ]);
  });

  test('prefers final execution subtitles over raw material subtitles when both exist', () => {
    const taskDir = path.join(projectsDir, 'material_final_priority');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'output_final.mp4'), 'video');
    writeJson(path.join(taskDir, 'source_post.json'), {
      title: '最终口播任务'
    });
    writeJson(path.join(taskDir, 'subtitles.json'), [
      { time: [0, 2], zh: '素材原声字幕', en: 'Raw material subtitle' }
    ]);
    writeJson(path.join(taskDir, 'execution_plan.json'), [
      { start_time: 0, end_time: 2.5, subtitle_text: '数字人口播字幕' }
    ]);

    const resolved = resolveMaterialTaskImport({
      projectsDir,
      taskDir: 'material_final_priority'
    });

    expect(resolved.subtitleSource).toBe('execution_plan.json');
    expect(resolved.subtitles).toEqual([
      { time: [0, 2.5], zh: '数字人口播字幕' }
    ]);
  });

  test('prefers aiman subtitles over execution plan subtitles when both exist', () => {
    const taskDir = path.join(projectsDir, 'material_aiman_priority');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'output_final.mp4'), 'video');
    writeJson(path.join(taskDir, 'execution_plan.json'), [
      { start_time: 0, end_time: 3, subtitle_text: '执行计划字幕' }
    ]);
    writeJson(path.join(taskDir, 'aiman_subtitles.json'), [
      { time: [0, 1.2], zh: '数字人句一', en: 'Avatar line one' },
      { time: [1.2, 2.6], zh: '数字人句二', en: 'Avatar line two' }
    ]);

    const resolved = resolveMaterialTaskImport({
      projectsDir,
      taskDir: 'material_aiman_priority'
    });

    expect(resolved.subtitleSource).toBe('aiman_subtitles.json');
    expect(resolved.subtitles).toEqual([
      { time: [0, 1.2], zh: '数字人句一', en: 'Avatar line one' },
      { time: [1.2, 2.6], zh: '数字人句二', en: 'Avatar line two' }
    ]);
  });

  test('rejects task directory traversal', () => {
    expect(() => resolveMaterialTaskImport({
      projectsDir,
      taskDir: '../outside'
    })).toThrow('任务目录名无效');
  });
});

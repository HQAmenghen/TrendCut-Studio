const fs = require('fs');
const path = require('path');

function createTaskImportError(message, options = {}) {
  const error = new Error(message);
  error.status = options.status || 400;
  error.code = options.code || 'STANDALONE_TASK_IMPORT_INVALID';
  error.stage = options.stage || 'standalone.task_import';
  error.hint = options.hint || '';
  return error;
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return fallback;
  }
}

function resolveDurationSeconds(...payloads) {
  for (const payload of payloads) {
    const value = Number(payload?.duration ?? payload?.durationSeconds ?? payload?.duration_sec ?? payload?.target_duration_sec);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function normalizeTaskDirName(taskDir) {
  const value = String(taskDir || '').trim();
  if (!value || value !== path.basename(value) || !/^material_[A-Za-z0-9_.-]+$/.test(value)) {
    throw createTaskImportError('任务目录名无效', {
      code: 'STANDALONE_TASK_DIR_INVALID',
      hint: '请从任务列表中选择素材驱动任务，不要手动输入路径'
    });
  }
  return value;
}

function resolveTaskDir(projectsDir, taskDir) {
  const safeTaskDir = normalizeTaskDirName(taskDir);
  const root = path.resolve(projectsDir);
  const resolved = path.resolve(root, safeTaskDir);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw createTaskImportError('任务目录名无效', {
      code: 'STANDALONE_TASK_DIR_INVALID',
      hint: '请选择 projects 目录下的素材驱动任务'
    });
  }
  return {
    outputDir: safeTaskDir,
    taskPath: resolved
  };
}

function pickString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function getNarrationText(narration) {
  const fullText = pickString(narration?.full_text, narration?.fullText);
  if (fullText) return fullText;
  if (Array.isArray(narration?.script_sections)) {
    return narration.script_sections
      .map((section) => pickString(section?.text))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function normalizeNarrationReferenceSubtitles(payload) {
  const text = getNarrationText(payload);
  if (!text) return [];
  const configuredDuration = Number(payload?.target_duration_sec ?? payload?.duration ?? payload?.duration_sec);
  const duration = Number.isFinite(configuredDuration) && configuredDuration > 0
    ? configuredDuration
    : Math.max(6, Math.ceil(text.length / 4));
  return [{
    time: [0, duration],
    zh: text,
    text
  }];
}

function collapseRepeatedAdjacentSubtitles(subtitles) {
  if (!Array.isArray(subtitles) || subtitles.length === 0) return [];
  const collapsed = [];

  for (const item of subtitles) {
    if (!item || typeof item !== 'object') continue;
    const time = Array.isArray(item.time) ? item.time : [item.start, item.end];
    const start = Number(time?.[0]);
    const end = Number(time?.[1]);
    const zh = pickString(item.zh, item.text, item.subtitle_text, item.subtitle);
    const en = pickString(item.en, item.english, item.subtitle_en);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || (!zh && !en)) continue;

    const previous = collapsed[collapsed.length - 1];
    if (previous && previous.zh === zh && (previous.en || '') === (en || '') && start >= previous.time[1] - 0.05) {
      previous.time[1] = Math.max(previous.time[1], end);
      continue;
    }

    const normalized = { time: [start, end] };
    if (zh) normalized.zh = zh;
    if (en) normalized.en = en;
    collapsed.push(normalized);
  }

  return collapsed;
}

function normalizeExistingSubtitles(payload) {
  if (!Array.isArray(payload) || payload.length === 0) return [];
  return collapseRepeatedAdjacentSubtitles(payload
    .map((item) => {
      const time = Array.isArray(item?.time) ? item.time : [item?.start, item?.end];
      const start = Number(time?.[0]);
      const end = Number(time?.[1]);
      const zh = pickString(item?.zh, item?.text, item?.subtitle_text, item?.subtitle);
      const en = pickString(item?.en, item?.english, item?.subtitle_en);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || (!zh && !en)) {
        return null;
      }
      const normalized = { time: [start, end] };
      if (zh) normalized.zh = zh;
      if (en) normalized.en = en;
      return normalized;
    })
    .filter(Boolean));
}

function normalizeExecutionPlanSubtitles(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];
  const subtitles = [];
  let current = null;

  for (const block of blocks) {
    const zh = pickString(block?.subtitle_zh, block?.zh_text, block?.subtitle_text, block?.text);
    const en = pickString(block?.subtitle_en, block?.en_text, block?.en, block?.english);
    if (!zh && !en) continue;

    const start = Number(block?.start_time ?? block?.timeline_start ?? block?.time?.[0] ?? 0);
    const end = Number(block?.end_time ?? block?.timeline_end ?? block?.time?.[1] ?? 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    if (current && current.zh === zh) {
      current.time[1] = Math.max(current.time[1], end);
      if (!current.en && en) current.en = en;
      continue;
    }

    if (current) subtitles.push(current);
    current = { time: [start, end] };
    if (zh) current.zh = zh;
    if (en) current.en = en;
  }

  if (current) subtitles.push(current);
  return collapseRepeatedAdjacentSubtitles(subtitles);
}

function normalizeAvatarSegmentSubtitles(payload) {
  const segments = Array.isArray(payload?.segments) ? payload.segments : [];
  if (segments.length === 0) return [];
  return collapseRepeatedAdjacentSubtitles(segments
    .map((segment) => {
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      const zh = pickString(segment?.text, segment?.subtitle_text, segment?.subtitle);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !zh) {
        return null;
      }
      return {
        time: [start, end],
        zh
      };
    })
    .filter(Boolean));
}

function readBestSubtitles(taskPath) {
  const subtitleFiles = [
    { fileName: 'aiman_subtitles.json', normalize: normalizeExistingSubtitles },
    { fileName: 'execution_plan.json', normalize: normalizeExecutionPlanSubtitles },
    { fileName: 'avatar_segments.json', normalize: normalizeAvatarSegmentSubtitles },
    { fileName: 'aiman_audio.json', normalize: normalizeExistingSubtitles },
    { fileName: 'subtitles.json', normalize: normalizeExistingSubtitles }
  ];

  for (const candidate of subtitleFiles) {
    const payload = readJsonSafe(path.join(taskPath, candidate.fileName), null);
    const subtitles = candidate.normalize(payload);
    if (subtitles.length > 0) {
      return {
        subtitles,
        subtitleSource: candidate.fileName
      };
    }
  }

  return {
    subtitles: [],
    subtitleSource: ''
  };
}

function resolveMaterialTaskImport(options = {}) {
  const { projectsDir, taskDir } = options;
  const { outputDir, taskPath } = resolveTaskDir(projectsDir, taskDir);
  if (!fs.existsSync(taskPath) || !fs.statSync(taskPath).isDirectory()) {
    throw createTaskImportError('任务目录不存在', {
      status: 404,
      code: 'STANDALONE_TASK_NOT_FOUND',
      hint: '请刷新任务列表后重新选择'
    });
  }

  const videoPath = path.join(taskPath, 'output_final.mp4');
  if (!fs.existsSync(videoPath) || !fs.statSync(videoPath).isFile()) {
    throw createTaskImportError('任务缺少可导入的成片 output_final.mp4', {
      status: 400,
      code: 'STANDALONE_TASK_VIDEO_MISSING',
      hint: '请选择已完成的素材驱动任务'
    });
  }

  const sourcePost = readJsonSafe(path.join(taskPath, 'source_post.json'), {});
  const narration = readJsonSafe(path.join(taskPath, 'narration.json'), {});
  const script = getNarrationText(narration);
  const { subtitles, subtitleSource } = readBestSubtitles(taskPath);
  const title = pickString(sourcePost?.title, narration?.title, sourcePost?.body, outputDir);
  const body = pickString(sourcePost?.body);

  return {
    outputDir,
    taskPath,
    videoPath,
    videoUrl: `/projects/${outputDir}/output_final.mp4`,
    title,
    context: title || body ? { title, body } : null,
    script,
    subtitles,
    subtitleSource,
    hasSubtitles: subtitles.length > 0,
    sourcePostUrl: pickString(sourcePost?.postUrl, sourcePost?.url),
    sourceMaterialUrl: pickString(sourcePost?.materialUrl, sourcePost?.material_url, sourcePost?.sourceMeta?.videoUrl),
    sourceMeta: sourcePost?.sourceMeta || {},
    durationSeconds: resolveDurationSeconds(readJsonSafe(path.join(taskPath, 'result.json'), {}), narration),
    updatedAt: fs.statSync(videoPath).mtime.toISOString()
  };
}

function resolveMaterialTaskImportUnchecked(options = {}) {
  const { projectsDir, taskDir } = options;
  const { outputDir, taskPath } = resolveTaskDir(projectsDir, taskDir);
  if (!fs.existsSync(taskPath) || !fs.statSync(taskPath).isDirectory()) {
    throw createTaskImportError('任务目录不存在', {
      status: 404,
      code: 'STANDALONE_TASK_NOT_FOUND',
      hint: '请刷新任务列表后重新选择'
    });
  }

  const videoPath = path.join(taskPath, 'output_final.mp4');
  const sourcePost = readJsonSafe(path.join(taskPath, 'source_post.json'), {});
  const narration = readJsonSafe(path.join(taskPath, 'narration.json'), {});
  const script = getNarrationText(narration);
  const { subtitles, subtitleSource } = readBestSubtitles(taskPath);
  const title = pickString(sourcePost?.title, narration?.title, sourcePost?.body, outputDir);
  const body = pickString(sourcePost?.body);
  const existingVideoPath = fs.existsSync(videoPath) && fs.statSync(videoPath).isFile()
    ? videoPath
    : '';

  return {
    outputDir,
    taskPath,
    videoPath: existingVideoPath || videoPath,
    videoUrl: existingVideoPath ? `/projects/${outputDir}/output_final.mp4` : '',
    title,
    context: title || body ? { title, body } : null,
    script,
    subtitles,
    subtitleSource,
    hasSubtitles: subtitles.length > 0,
    sourcePostUrl: pickString(sourcePost?.postUrl, sourcePost?.url),
    sourceMaterialUrl: pickString(sourcePost?.materialUrl, sourcePost?.material_url, sourcePost?.sourceMeta?.videoUrl),
    sourceMeta: sourcePost?.sourceMeta || {},
    durationSeconds: resolveDurationSeconds(readJsonSafe(path.join(taskPath, 'result.json'), {}), narration),
    updatedAt: existingVideoPath ? fs.statSync(existingVideoPath).mtime.toISOString() : fs.statSync(taskPath).mtime.toISOString()
  };
}

function listMaterialTasks(options = {}) {
  const { projectsDir, limit = 80 } = options;
  if (!projectsDir || !fs.existsSync(projectsDir)) return [];

  return fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^material_[A-Za-z0-9_.-]+$/.test(entry.name))
    .map((entry) => {
      try {
        return resolveMaterialTaskImport({ projectsDir, taskDir: entry.name });
      } catch (_err) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, Math.max(1, Number(limit) || 80))
    .map((task) => ({
      id: task.outputDir,
      outputDir: task.outputDir,
      title: task.title,
      videoUrl: task.videoUrl,
      updatedAt: task.updatedAt,
      hasSubtitles: task.hasSubtitles,
      subtitleSource: task.subtitleSource,
      subtitleCount: task.subtitles.length,
      sourcePostUrl: task.sourcePostUrl,
      scriptPreview: task.script.slice(0, 120)
    }));
}

module.exports = {
  listMaterialTasks,
  normalizeExecutionPlanSubtitles,
  normalizeAvatarSegmentSubtitles,
  normalizeNarrationReferenceSubtitles,
  collapseRepeatedAdjacentSubtitles,
  resolveMaterialTaskImport,
  resolveMaterialTaskImportUnchecked
};

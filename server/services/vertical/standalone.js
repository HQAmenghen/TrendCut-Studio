const fs = require('fs');
const path = require('path');
const {
  listMaterialTasks: listMaterialDrivenTasks,
  resolveMaterialTaskImport
} = require('./taskImport');

function resolveImportedAvatarAsrInput(taskImport) {
  if (!taskImport?.taskPath) return '';
  const candidates = [
    path.join(taskImport.taskPath, 'aiman.mp4'),
    path.join(taskImport.taskPath, 'avatar_qwen3tts.wav')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || '';
}

async function refreshImportedAvatarSubtitles(options = {}) {
  const {
    taskImport,
    projectsDir,
    runAsrScript,
    runPythonScript,
    sse,
    sendProgressEvent
  } = options;
  if (!taskImport?.taskPath || !taskImport?.outputDir) {
    return taskImport;
  }

  const avatarInputPath = resolveImportedAvatarAsrInput(taskImport);
  if (!avatarInputPath) {
    return taskImport;
  }

  if (sse) {
    sendProgressEvent(sse, {
      type: 'status',
      msg: `正在为任务 ${taskImport.outputDir} 的数字人口播重跑 ASR 并回写句级字幕...`
    });
  }

  await runPythonScript(runAsrScript, [
    '--input', avatarInputPath,
    '--audio-json', 'aiman_audio.json',
    '--subtitles-json', 'aiman_subtitles.json',
    '--speaker-scene-json', 'aiman_speaker_scene.json'
  ], {
    cwd: taskImport.taskPath,
    onStdout: (chunk) => {
      const lastLine = chunk.toString().trim().split('\n').pop();
      if (sse && lastLine) {
        sendProgressEvent(sse, { type: 'status', msg: lastLine });
      }
    },
    onStderr: (chunk) => {
      const errStr = chunk.toString();
      console.error(`[imported_avatar_asr stderr]: ${errStr}`);
    }
  });

  return resolveMaterialTaskImport({ projectsDir, taskDir: taskImport.outputDir });
}

function createStandaloneHandler(deps) {
  const {
    sendError,
    baseDir,
    pipelineDir,
    projectsDir,
    upload,
    getProgressClient,
    sendProgressEvent,
    createRuntimeJobDir,
    generateHotTitle,
    writeJsonFile,
    writeMediaMetadata,
    readJsonIfExists,
    runPythonScript
  } = deps;

  const middleware = upload.fields([{ name: 'video' }, { name: 'srt' }]);

  const listMaterialTasks = (_req, res) => {
    try {
      res.json({
        success: true,
        tasks: listMaterialDrivenTasks({ projectsDir })
      });
    } catch (error) {
      sendError(res, {
        status: error.status || 500,
        code: error.code || 'STANDALONE_TASK_LIST_FAILED',
        stage: error.stage || 'standalone.task_import',
        error: error.message || '读取素材驱动任务失败',
        details: error.details || error.message,
        hint: error.hint || '请确认 projects 目录可读'
      });
    }
  };

  const handler = async (req, res) => {
    const clientId = req.body.clientId;
    if (!clientId) {
      return sendError(res, {
        status: 400,
        code: 'STANDALONE_CLIENT_ID_MISSING',
        stage: 'standalone.request',
        error: '缺少 clientId',
        hint: '请通过前端页面发起请求，确保 SSE 进度流已建立'
      });
    }
    const sse = getProgressClient(clientId);

    try {
      const taskDir = createRuntimeJobDir('standalone');
      const runAsrScript = path.join(pipelineDir, 'run_asr.py');
      const convertSrtScript = path.join(pipelineDir, 'convert_srt_to_json.py');
      const makeVerticalScript = path.join(pipelineDir, 'make_vertical_video.py');
      const renderOptions = req.body.renderOptions ? JSON.parse(req.body.renderOptions) : {};
      const resolvedRenderOptions = {
        ...renderOptions,
        titleMinSize: renderOptions.titleMinSize ?? renderOptions.titleMinFontSize,
        subtitleMinSize: renderOptions.subtitleMinSize ?? renderOptions.subtitleMinFontSize,
        englishFontSize: renderOptions.englishFontSize ?? renderOptions.englishSubtitleFontSize
      };
      const sourceTaskDir = String(req.body.sourceTaskDir || '').trim();
      let taskImport = sourceTaskDir
        ? resolveMaterialTaskImport({ projectsDir, taskDir: sourceTaskDir })
        : null;
      if (taskImport) {
        taskImport = await refreshImportedAvatarSubtitles({
          taskImport,
          projectsDir,
          runAsrScript,
          runPythonScript,
          sse,
          sendProgressEvent
        });
      }
      if (!req.files?.video && !taskImport) {
        return sendError(res, {
          status: 400,
          code: 'STANDALONE_VIDEO_MISSING',
          stage: 'standalone.request',
          error: '请上传需要转换的视频'
        });
      }

      const srtPath = path.join(taskDir, 'uploaded.srt');
      const contextJsonPath = path.join(taskDir, 'original_context.json');
      const narrationJsonPath = path.join(taskDir, 'narration.json');
      const contextPayload = req.body.context || taskImport?.context || '';
      if (contextPayload) {
        try {
          const parsed = typeof contextPayload === 'string' ? JSON.parse(contextPayload) : contextPayload;
          fs.writeFileSync(contextJsonPath, JSON.stringify(parsed, null, 2));
        } catch (e) {
          fs.writeFileSync(contextJsonPath, JSON.stringify({ body: contextPayload }, null, 2));
        }
      }

      const scriptPayload = req.body.script || (taskImport?.script ? { full_text: taskImport.script } : '');
      if (scriptPayload) {
        try {
          const parsed = typeof scriptPayload === 'string' ? JSON.parse(scriptPayload) : scriptPayload;
          fs.writeFileSync(narrationJsonPath, JSON.stringify(parsed, null, 2));
        } catch (e) {
          fs.writeFileSync(narrationJsonPath, JSON.stringify({ full_text: scriptPayload }, null, 2));
        }
      }

      const inputVideoPath = path.join(taskDir, 'standalone_input.mp4');
      if (taskImport) {
        fs.copyFileSync(taskImport.videoPath, inputVideoPath);
      } else {
        fs.renameSync(req.files.video[0].path, inputVideoPath);
      }
      console.log(`[Standalone] 视频已就位: ${inputVideoPath}`);

      const contentJsonPath = path.join(taskDir, 'content.json');
      const subsJsonPath = path.join(taskDir, 'subtitles.json');
      const shouldUseASR = req.body.useASR === 'true' || (
        !req.files?.srt &&
        req.body.useASR !== 'false' &&
        !req.body.subtitlesPayload &&
        !taskImport?.hasSubtitles
      );

      if (req.body.subtitlesPayload) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '检测到导入的 JSON 字幕，正在加载...' });
        try {
          // Verify valid JSON before writing
          const subs = JSON.parse(req.body.subtitlesPayload);
          fs.writeFileSync(subsJsonPath, req.body.subtitlesPayload);
          console.log(`[Standalone] 成功加载导入的 JSON 字幕，包含 ${Array.isArray(subs) ? subs.length : '未知数量'} 条记录`);
        } catch (e) {
          console.error('[Standalone] 导入的 JSON 字幕格式错误:', e);
          if (sse) sendProgressEvent(sse, { type: 'status', msg: 'JSON 字幕解析失败，将回退到无字幕方案或 ASR。' });
        }
      } else if (taskImport?.hasSubtitles) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: `已从任务 ${taskImport.outputDir} 加载 ${taskImport.subtitleSource} 字幕...` });
        fs.writeFileSync(subsJsonPath, JSON.stringify(taskImport.subtitles, null, 2));
      } else if (shouldUseASR) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '自动 ASR 打轴已开启，正在识别视频语音...' });
        console.log('[Standalone] 启动 ASR 任务...');
        await runPythonScript(runAsrScript, ['--input', 'standalone_input.mp4'], {
          cwd: taskDir,
          onStdout: (chunk) => {
            const lastLine = chunk.toString().trim().split('\n').pop();
            if (sse && lastLine) sendProgressEvent(sse, { type: 'status', msg: lastLine });
          },
          onStderr: (chunk) => {
            const errStr = chunk.toString();
            console.error(`[run_asr.py stderr]: ${errStr}`);
          }
        });
      } else if (req.files.srt) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '检测到 SRT 文件，正在转换为 JSON...' });
        fs.renameSync(req.files.srt[0].path, srtPath);
        await runPythonScript(convertSrtScript, [srtPath, subsJsonPath], {
          cwd: taskDir,
          onStderr: () => {}
        });
      } else {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '未提供字幕文件，将生成无字幕视频。' });
        fs.writeFileSync(subsJsonPath, '[]');
      }

      let finalTitle = String(req.body.title || '').trim();
      if (!finalTitle) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '未填写标题，正在根据字幕/背景信息自动生成热点标题...' });
        finalTitle = await generateHotTitle(taskDir, 'subtitles.json', {
          contextPath: fs.existsSync(contextJsonPath) ? contextJsonPath : null,
          scriptPath: fs.existsSync(narrationJsonPath) ? narrationJsonPath : null
        });
        if (sse) sendProgressEvent(sse, { type: 'status', msg: `自动标题：${finalTitle}` });
      }
      writeJsonFile(contentJsonPath, { title: finalTitle });

      if (sse) sendProgressEvent(sse, { type: 'progress', percent: 50, msg: '正在渲染动态竖屏视频...' });
      const outputName = 'standalone_output_vertical.mp4';
      const outputPath = path.join(taskDir, outputName);

      const makeVerticalArgs = [
        '--input', inputVideoPath,
        '--content', contentJsonPath,
        '--subtitles', subsJsonPath,
        '--output', outputPath,
        '--background', path.join(taskDir, 'background_generated.png'),
        '--sub-dir', path.join(taskDir, 'subtitle_cards'),
        '--title-font-size', String(resolvedRenderOptions.titleFontSize || 104),
        '--title-min-size', String(resolvedRenderOptions.titleMinSize || 52),
        '--title-max-lines', String(resolvedRenderOptions.titleMaxLines || 2),
        '--subtitle-font-size', String(resolvedRenderOptions.subtitleFontSize || 50),
        '--subtitle-min-size', String(resolvedRenderOptions.subtitleMinSize || 28),
        '--subtitle-max-lines', String(resolvedRenderOptions.subtitleMaxLines || 2),
        '--subtitle-offset-y', String(Number.isFinite(Number(resolvedRenderOptions.subtitleOffsetY)) ? Number(resolvedRenderOptions.subtitleOffsetY) : 20),
        '--english-font-size', String(resolvedRenderOptions.englishFontSize || 52),
        '--english-min-size', String(resolvedRenderOptions.englishMinSize || 30),
        '--english-max-lines', String(resolvedRenderOptions.englishMaxLines || 2)
      ];
      await runPythonScript(makeVerticalScript, makeVerticalArgs, {
        cwd: taskDir,
        onStderr: (chunk) => console.error(`[standalone_vertical stderr]: ${chunk}`)
      });

      const finalUrlPath = path.join(baseDir, 'public', outputName);
      fs.copyFileSync(outputPath, finalUrlPath);
      writeMediaMetadata(finalUrlPath, {
        taskType: 'standalone',
        taskDir,
        sourceTaskDir: taskImport?.outputDir || '',
        subtitleSource: taskImport?.subtitleSource || '',
        title: finalTitle,
        subtitles: readJsonIfExists(subsJsonPath, []),
        updatedAt: new Date().toISOString()
      });
      if (sse) sendProgressEvent(sse, { type: 'progress', percent: 100, msg: '🎉 动态竖屏生成完毕！' });
      res.json({
        success: true,
        videoUrl: `/${outputName}?t=${Date.now()}`,
        title: finalTitle,
        sourceTaskDir: taskImport?.outputDir || ''
      });
    } catch (error) {
      console.error('Standalone vertical failed:', error);
      sendError(res, {
        status: error.status || 500,
        code: error.code || 'STANDALONE_GENERATE_FAILED',
        stage: error.stage || 'standalone.pipeline',
        error: '单条竖屏生成失败',
        details: error.details || error.message,
        hint: error.hint || '请检查 ASR、SRT 转换、标题生成或竖屏渲染脚本日志'
      });
    }
  };

  return { middleware, handler, listMaterialTasks };
}

module.exports = {
  createStandaloneHandler
};

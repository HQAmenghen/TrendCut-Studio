const fs = require('fs');
const path = require('path');

function createStandaloneHandler(deps) {
  const {
    sendError,
    baseDir,
    pipelineDir,
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
      if (!req.files.video) {
        return sendError(res, {
          status: 400,
          code: 'STANDALONE_VIDEO_MISSING',
          stage: 'standalone.request',
          error: '请上传需要转换的视频'
        });
      }

      const inputVideoPath = path.join(taskDir, 'standalone_input.mp4');
      fs.renameSync(req.files.video[0].path, inputVideoPath);

      const contentJsonPath = path.join(taskDir, 'content.json');
      const subsJsonPath = path.join(taskDir, 'subtitles.json');
      const shouldUseASR = req.body.useASR === 'true' || (!req.files.srt && req.body.useASR !== 'false');

      if (shouldUseASR) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '自动 ASR 打轴已开启，正在识别视频语音...' });
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
        const srtPath = path.join(taskDir, 'uploaded.srt');
        fs.renameSync(req.files.srt[0].path, srtPath);
        await runPythonScript(convertSrtScript, [srtPath, subsJsonPath], {
          cwd: taskDir,
          onStderr: () => {}
        });
      } else {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '未提供字幕文件，将生成无字幕视频。' });
        fs.writeFileSync(subsJsonPath, '[]');
      }

      let finalTitle = (req.body.title || '').trim();
      if (!finalTitle) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '未填写标题，正在根据字幕自动生成热点标题...' });
        finalTitle = await generateHotTitle(taskDir, 'subtitles.json');
        if (sse) sendProgressEvent(sse, { type: 'status', msg: `自动标题：${finalTitle}` });
      }
      writeJsonFile(contentJsonPath, { title: finalTitle });

      if (sse) sendProgressEvent(sse, { type: 'progress', percent: 50, msg: '正在渲染动态竖屏视频...' });
      const outputName = 'standalone_output_vertical.mp4';
      const outputPath = path.join(taskDir, outputName);

      await runPythonScript(makeVerticalScript, [
          '--input', inputVideoPath,
          '--content', contentJsonPath,
          '--subtitles', subsJsonPath,
          '--output', outputPath,
          '--background', path.join(taskDir, 'background_generated.png'),
          '--sub-dir', path.join(taskDir, 'subtitle_cards'),
          '--title-font-size', String(renderOptions.titleFontSize || 104),
          '--title-min-size', String(renderOptions.titleMinSize || 52),
          '--title-max-lines', String(renderOptions.titleMaxLines || 2),
          '--subtitle-font-size', String(renderOptions.subtitleFontSize || 50),
          '--subtitle-min-size', String(renderOptions.subtitleMinSize || 28),
          '--subtitle-max-lines', String(renderOptions.subtitleMaxLines || 2),
          '--subtitle-offset-y', String(Number.isFinite(Number(renderOptions.subtitleOffsetY)) ? Number(renderOptions.subtitleOffsetY) : 20),
          '--english-font-size', String(renderOptions.englishFontSize || 52),
          '--english-min-size', String(renderOptions.englishMinSize || 30),
          '--english-max-lines', String(renderOptions.englishMaxLines || 2)
        ], {
          cwd: taskDir,
          onStderr: (chunk) => console.error(`[standalone_vertical stderr]: ${chunk}`)
        });

      const finalUrlPath = path.join(baseDir, 'public', outputName);
      fs.copyFileSync(outputPath, finalUrlPath);
      writeMediaMetadata(finalUrlPath, {
        taskType: 'standalone',
        taskDir,
        title: finalTitle,
        subtitles: readJsonIfExists(subsJsonPath, []),
        updatedAt: new Date().toISOString()
      });
      if (sse) sendProgressEvent(sse, { type: 'progress', percent: 100, msg: '🎉 动态竖屏生成完毕！' });
      res.json({ success: true, videoUrl: `/${outputName}?t=${Date.now()}`, title: finalTitle });
    } catch (error) {
      console.error('Standalone vertical failed:', error);
      sendError(res, {
        status: 500,
        code: error.code || 'STANDALONE_GENERATE_FAILED',
        stage: error.stage || 'standalone.pipeline',
        error: '单条竖屏生成失败',
        details: error.details || error.message,
        hint: error.hint || '请检查 ASR、SRT 转换、标题生成或竖屏渲染脚本日志'
      });
    }
  };

  return { middleware, handler };
}

module.exports = {
  createStandaloneHandler
};

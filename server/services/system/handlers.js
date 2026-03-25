function createSystemHandlers(deps) {
  const {
    fs,
    path,
    spawn,
    sendError,
    baseDir,
    pipelineDir,
    selfCheckService,
    editableJsonFiles,
    resolveEditableJsonPath,
    workflowPath,
    readWorkflow,
    extractWorkflowConfig,
    applyWorkflowConfig,
    writeWorkflow
  } = deps;

  return {
    getPresets: (_req, res) => {
      try {
        const audioDir = path.join(baseDir, 'public/presets/audio');
        const imageDir = path.join(baseDir, 'public/presets/image');

        const audioFiles = fs.existsSync(audioDir) ? fs.readdirSync(audioDir).filter((f) => f.endsWith('.wav') || f.endsWith('.mp3')) : [];
        const imageFiles = fs.existsSync(imageDir) ? fs.readdirSync(imageDir).filter((f) => f.match(/\.(png|jpg|jpeg)$/i)) : [];

        res.json({ success: true, audio: audioFiles, image: imageFiles });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'PRESETS_READ_FAILED',
          stage: 'system.presets',
          error: '读取预设素材失败',
          details: err.message,
          hint: '请检查 public/presets 目录是否存在且可访问'
        });
      }
    },
    getSelfCheck: (_req, res) => {
      try {
        res.json({ success: true, report: selfCheckService.run() });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'SELF_CHECK_FAILED',
          stage: 'system.self_check',
          error: '启动自检执行失败',
          details: err.message,
          hint: '请检查 Python、FFmpeg 与关键脚本路径配置'
        });
      }
    },
    getWorkflowConfig: (_req, res) => {
      try {
        const workflow = readWorkflow(workflowPath);
        res.json({ success: true, config: extractWorkflowConfig(workflow) });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'WORKFLOW_READ_FAILED',
          stage: 'system.workflow',
          error: '读取工作流配置失败',
          details: err.message,
          hint: '请检查 workflow_api.json 是否存在且 JSON 格式正确'
        });
      }
    },
    postWorkflowConfig: (req, res) => {
      try {
        const workflow = readWorkflow(workflowPath);
        const updated = applyWorkflowConfig(workflow, req.body || {});
        writeWorkflow(workflowPath, updated);
        res.json({ success: true, config: extractWorkflowConfig(updated) });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'WORKFLOW_WRITE_FAILED',
          stage: 'system.workflow',
          error: '保存工作流配置失败',
          details: err.message,
          hint: '请检查工作流字段和值是否合法'
        });
      }
    },
    listJsonFiles: (_req, res) => {
      try {
        const files = Array.from(editableJsonFiles).map((fileName) => {
          const fullPath = resolveEditableJsonPath(fileName);
          return {
            fileName,
            exists: !!(fullPath && fs.existsSync(fullPath))
          };
        });
        res.json({ success: true, files });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'JSON_LIST_FAILED',
          stage: 'system.json_files',
          error: '读取 JSON 文件列表失败',
          details: err.message
        });
      }
    },
    getJsonFile: (req, res) => {
      try {
        const fileName = req.params.fileName;
        const fullPath = resolveEditableJsonPath(fileName);
        if (!fullPath) return sendError(res, { status: 400, code: 'JSON_FILE_UNSUPPORTED', stage: 'system.json_files', error: '不支持的文件类型' });
        if (!fs.existsSync(fullPath)) return sendError(res, { status: 404, code: 'JSON_FILE_NOT_FOUND', stage: 'system.json_files', error: '文件不存在' });
        const content = fs.readFileSync(fullPath, 'utf-8');
        res.json({ success: true, fileName, content });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'JSON_READ_FAILED',
          stage: 'system.json_files',
          error: '读取 JSON 文件失败',
          details: err.message
        });
      }
    },
    postJsonFile: (req, res) => {
      try {
        const fileName = req.params.fileName;
        const fullPath = resolveEditableJsonPath(fileName);
        if (!fullPath) return sendError(res, { status: 400, code: 'JSON_FILE_UNSUPPORTED', stage: 'system.json_files', error: '不支持的文件类型' });
        if (typeof req.body.content !== 'string') return sendError(res, { status: 400, code: 'JSON_CONTENT_MISSING', stage: 'system.json_files', error: '缺少内容' });
        JSON.parse(req.body.content);
        fs.writeFileSync(fullPath, req.body.content, 'utf-8');
        res.json({ success: true });
      } catch (err) {
        sendError(res, {
          status: 500,
          code: 'JSON_WRITE_FAILED',
          stage: 'system.json_files',
          error: '保存 JSON 文件失败',
          details: err.message,
          hint: '请确认内容是合法 JSON 且目标文件可写'
        });
      }
    },
    optimizeText: (req, res) => {
      const text = req.body.text;
      if (!text) return sendError(res, { status: 400, code: 'TEXT_MISSING', stage: 'system.optimize_text', error: '缺少待优化文本' });
      const scriptPath = path.join(pipelineDir, 'optimize_text.py');
      const proc = spawn('python', [scriptPath, '--text', text]);
      let output = '';
      let err = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
      proc.stderr.on('data', (data) => {
        err += data.toString();
      });
      proc.on('close', (code) => {
        if (code === 0) res.json({ text: output.trim() });
        else sendError(res, { status: 500, code: 'OPTIMIZE_TEXT_FAILED', stage: 'system.optimize_text', error: '文案优化失败', details: err.trim() });
      });
    },
    convertVideo: (req, res) => {
      const ratio = req.body.ratio;
      if (!ratio) return sendError(res, { status: 400, code: 'RATIO_MISSING', stage: 'system.convert_video', error: '缺少目标比例' });
      const inputFile = path.join(baseDir, 'public', 'output_final.mp4');
      const outputName = ratio === '9:16' ? 'output_9_16.mp4' : 'output_16_9.mp4';
      const outputFile = path.join(baseDir, 'public', outputName);

      const proc = spawn('python', ['convert_ratio.py', '--ratio', ratio, '--input', inputFile, '--output', outputFile], { cwd: pipelineDir });
      let err = '';
      proc.stderr.on('data', (data) => {
        err += data.toString();
      });
      proc.on('close', (code) => {
        if (code === 0) res.json({ videoUrl: `/${outputName}?t=${Date.now()}` });
        else sendError(res, { status: 500, code: 'CONVERT_VIDEO_FAILED', stage: 'system.convert_video', error: '视频转比例失败', details: err.trim() });
      });
    }
  };
}

module.exports = {
  createSystemHandlers
};

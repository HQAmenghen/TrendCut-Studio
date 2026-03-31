const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REVIEW_SCRIPT_PATH = path.join(process.cwd(), 'python', 'review', 'ai_video_review.py');
const PROTOCOL_PREFIX = '__CODEX_PYTHON__';

function resolveReviewModel(config = {}) {
  const provider = String(process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'qwen') {
    return config.qwen_model || process.env.QWEN_VL_MODEL || 'qwen3-vl-flash';
  }
  return config.gemini_model || process.env.AI_REVIEW_GEMINI_MODEL || 'gemini-2.5-pro';
}

/**
 * 执行视频审核脚本
 * @param {string} videoPath - 视频文件路径
 * @param {string} metadataPath - 元数据文件路径
 * @param {object} config - 审核配置
 * @returns {Promise<object>} 审核结果
 */
async function executeReviewScript(videoPath, metadataPath, config) {
  return new Promise((resolve, reject) => {
    // 创建临时配置文件
    const configPath = path.join(os.tmpdir(), `review_config_${Date.now()}.json`);
    const outputPath = path.join(os.tmpdir(), `review_result_${Date.now()}.json`);

    try {
      const selectedModel = resolveReviewModel(config);
      fs.writeFileSync(configPath, JSON.stringify({
        min_pass_score: config.min_pass_score || 70,
        weights: {
          content: config.content_weight || 30,
          subtitle: config.subtitle_weight || 25,
          title: config.title_weight || 20,
          editing: config.editing_weight || 25
        },
        model: selectedModel
      }));
    } catch (err) {
      return reject(new Error(`创建配置文件失败: ${err.message}`));
    }

    const args = [
      REVIEW_SCRIPT_PATH,
      '--video', videoPath,
      '--metadata', metadataPath,
      '--config', configPath,
      '--output', outputPath
    ];

    const proc = spawn('python', args, {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      cwd: process.cwd()
    });

    let stdout = '';
    let stderr = '';
    const logs = [];
    const protocolEvents = [];
    let timeoutHandle = null;
    let isTimedOut = false;

    // 设置超时（5分钟）
    const TIMEOUT_MS = 5 * 60 * 1000;
    timeoutHandle = setTimeout(() => {
      isTimedOut = true;
      console.error('[AI Review] 审核超时，终止进程');
      try {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 5000);
      } catch (err) {
        console.error('[AI Review] 终止进程失败:', err);
      }
    }, TIMEOUT_MS);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;

      // 解析日志行
      text.split('\n').forEach(line => {
        if (line.trim()) {
          if (line.startsWith(PROTOCOL_PREFIX)) {
            try {
              protocolEvents.push(JSON.parse(line.slice(PROTOCOL_PREFIX.length)));
            } catch (_err) {
              // ignore malformed protocol lines
            }
          }
          logs.push(line);
          console.log(`[AI Review] ${line}`);
        }
      });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.error(`[AI Review Error] ${text}`);
    });

    proc.on('close', (code) => {
      // 清除超时
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      // 清理临时配置文件
      try {
        if (fs.existsSync(configPath)) {
          fs.unlinkSync(configPath);
        }
      } catch (err) {
        console.warn(`清理配置文件失败: ${err.message}`);
      }

      if (isTimedOut) {
        // 清理输出文件
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch (err) {
          // ignore
        }
        return reject(new Error('审核超时（5分钟），请检查网络连接或视频文件大小'));
      }

      if (code !== 0) {
        // 清理输出文件
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch (err) {
          // ignore
        }

        // 提取更有用的错误信息
        let errorMessage = `审核脚本执行失败 (exit code ${code})`;
        const protocolError = [...protocolEvents].reverse().find((event) => event?.type === 'error');

        if (protocolError?.payload) {
          const payload = protocolError.payload;
          errorMessage = payload.error || errorMessage;
          const error = new Error(errorMessage);
          error.code = payload.code;
          error.stage = payload.stage;
          error.details = payload.details || '';
          error.hint = payload.hint || '';
          error.protocol = payload;
          error.stdoutTail = stdout.split('\n').filter(Boolean).slice(-20).join('\n');
          error.stderrTail = stderr.split('\n').filter(Boolean).slice(-20).join('\n');
          return reject(error);
        }

        if (stderr) {
          const lines = stderr.split('\n').filter(l => l.trim());
          const lastError = lines[lines.length - 1];
          if (lastError) {
            errorMessage += `: ${lastError}`;
          }
        } else {
          const stdoutLines = stdout.split('\n').filter(l => l.trim() && !l.startsWith(PROTOCOL_PREFIX));
          const lastStdout = stdoutLines[stdoutLines.length - 1];
          if (lastStdout) {
            errorMessage += `: ${lastStdout}`;
          }
        }

        const error = new Error(errorMessage);
        error.stdoutTail = stdout.split('\n').filter(Boolean).slice(-20).join('\n');
        error.stderrTail = stderr.split('\n').filter(Boolean).slice(-20).join('\n');
        return reject(error);
      }

      // 读取审核结果
      try {
        if (!fs.existsSync(outputPath)) {
          console.error('[AI Review] 输出文件不存在:', outputPath);
          console.error('[AI Review] stdout:', stdout);
          console.error('[AI Review] stderr:', stderr);
          return reject(new Error('审核结果文件不存在，可能审核过程中出现了错误'));
        }

        const resultText = fs.readFileSync(outputPath, 'utf-8');
        console.log('[AI Review] 成功读取审核结果文件');

        const result = JSON.parse(resultText);

        // 清理输出文件
        try {
          fs.unlinkSync(outputPath);
        } catch (err) {
          console.warn(`清理输出文件失败: ${err.message}`);
        }

        resolve({
          ...result,
          logs
        });
      } catch (err) {
        console.error('[AI Review] 读取结果失败:', err);
        console.error('[AI Review] outputPath:', outputPath);
        console.error('[AI Review] 文件存在:', fs.existsSync(outputPath));
        reject(new Error(`读取审核结果失败: ${err.message}`));
      }
    });

    proc.on('error', (err) => {
      // 清除超时
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      // 清理临时文件
      try {
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (e) {
        // ignore
      }

      reject(new Error(`启动审核脚本失败: ${err.message}`));
    });
  });
}

module.exports = {
  executeReviewScript,
  REVIEW_SCRIPT_PATH
};

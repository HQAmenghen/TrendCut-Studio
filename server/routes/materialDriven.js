/**
 * 素材驱动工作流 API 路由
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const axios = require('axios');
const { spawn } = require('child_process');
const { makeJobId, ensureDir } = require('../core/runtime');
const { uploadToComfyUI, waitForCompletion } = require('../services/pipeline/comfy');
const { readWorkflow } = require('../services/pipeline/workflow');
const runtime = require('../config/runtime');

// 存储活跃的任务
const activeTasks = new Map();
// SSE 客户端（按 jobId 维度）
const taskClients = new Map();
const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function nowIso() {
    return new Date().toISOString();
}

function addTaskLog(task, message, type = 'info') {
    if (!task || !message) return;
    const line = {
        time: nowIso(),
        message: String(message).trim(),
        type
    };
    task.logs = Array.isArray(task.logs) ? [...task.logs, line].slice(-200) : [line];
    task.updatedAt = nowIso();
}

function collectStderr(task, chunk) {
    if (!task) return;
    const text = String(chunk || '');
    task.lastStderr = `${String(task.lastStderr || '')}${text}`.slice(-60000);
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^chunk:\s*\d+/i.test(line))
        .filter((line) => !/^frame_index:\s*\d+/i.test(line))
        .slice(-6);
    for (const line of lines) {
        addTaskLog(task, line, 'warning');
    }
}

function summarizeFailureMessage(task, code) {
    const stderrTail = String(task?.lastStderr || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-20)
        .join('\n');
    const exitMsg = `进程退出，代码: ${code}`;
    if (!stderrTail) return exitMsg;
    return `${exitMsg}\n${stderrTail.slice(-3000)}`;
}

function emitTaskEvent(jobId, eventName, payload = {}) {
    const clients = taskClients.get(jobId);
    if (!clients || clients.size === 0) return;
    const body = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
        try {
            res.write(body);
        } catch (_err) {}
    }
}

function closeTaskClients(jobId) {
    const clients = taskClients.get(jobId);
    if (!clients) return;
    for (const res of clients) {
        try {
            res.end();
        } catch (_err) {}
    }
    taskClients.delete(jobId);
}

function firstExistingFile(candidates = []) {
    for (const file of candidates) {
        if (!file) continue;
        try {
            if (fs.existsSync(file) && fs.statSync(file).isFile()) {
                return file;
            }
        } catch (_err) {}
    }
    return '';
}

function pickFirstFileInDir(dirPath) {
    try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => path.join(dirPath, entry.name));
        return files.length ? files[0] : '';
    } catch (_err) {
        return '';
    }
}

function readJsonSafe(filePath, fallback = null) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_err) {
        return fallback;
    }
}

async function downloadToFile(url, outputPath) {
    const writer = fs.createWriteStream(outputPath);
    const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
        timeout: 180000,
        httpsAgent: insecureHttpsAgent
    });
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

/**
 * 注册素材驱动工作流路由
 */
function registerMaterialDrivenRoutes(app, paths) {
    const upload = multer({ dest: paths.UPLOADS_DIR });

    async function autoGenerateAvatar(jobId, task) {
        const cfg = task.avatarConfig || {};
        const narrationPath = path.join(task.outputPath, 'narration.json');
        let narrationText = String(cfg.genText || '').trim();
        let narrationTargetDuration = 0;
        try {
            if (fs.existsSync(narrationPath)) {
                const payload = JSON.parse(fs.readFileSync(narrationPath, 'utf8'));
                const fromFile = String(payload?.full_text || '').trim();
                if (fromFile) narrationText = fromFile;
                narrationTargetDuration = Number(payload?.target_duration_sec || 0);
            }
        } catch (_err) {}
        if (!narrationText) {
            throw new Error('缺少可用口播文案（narration.json / genText）');
        }

        const audioPresetPath = cfg.audioPreset
            ? path.join(paths.PROJECT_ROOT, 'public', 'presets', 'audio', cfg.audioPreset)
            : '';
        const imagePresetPath = cfg.imagePreset
            ? path.join(paths.PROJECT_ROOT, 'public', 'presets', 'image', cfg.imagePreset)
            : '';

        const audioPath = firstExistingFile([
            cfg.audioUploadPath,
            audioPresetPath,
            pickFirstFileInDir(path.join(paths.PROJECT_ROOT, 'public', 'presets', 'audio'))
        ]);
        const imagePath = firstExistingFile([
            cfg.imageUploadPath,
            imagePresetPath,
            pickFirstFileInDir(path.join(paths.PROJECT_ROOT, 'public', 'presets', 'image'))
        ]);

        if (!audioPath) throw new Error('未找到可用音频素材（audio preset/upload）');
        if (!imagePath) throw new Error('未找到可用人物图片（image preset/upload）');

        const baseUrl = String(cfg.serverUrl || runtime.DEFAULT_COMFYUI_BASE_URL).trim();
        if (!baseUrl) throw new Error('未配置 ComfyUI 地址');

        task.status = 'generating_avatar';
        task.currentStep = 6;
        task.progress = Math.max(Number(task.progress || 0), 86);
        task.statusText = '正在自动生成数字人...';
        task.updatedAt = nowIso();
        addTaskLog(task, '自动调用 ComfyUI 生成数字人', 'info');
        emitTaskEvent(jobId, 'step', { step: 6, message: '步骤6: 自动生成数字人' });
        emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
        emitTaskEvent(jobId, 'status', { message: task.statusText });

        const remoteAudioName = await uploadToComfyUI(audioPath, baseUrl);
        const remoteImageName = await uploadToComfyUI(imagePath, baseUrl);
        const workflow = readWorkflow(paths.WORKFLOW_PATH);

        workflow['278'].inputs.text = narrationText;
        workflow['6'].inputs.audio = remoteAudioName;
        workflow['180'].inputs.image = remoteImageName;

        const randomSeed = Math.floor(Math.random() * 2147483647);
        workflow['27'].inputs.seed = randomSeed;
        workflow['278'].inputs.seed = randomSeed;

        const trimSeconds = Number(cfg.trimSeconds || 0);
        // 自动抬高数字人生成时长，避免“口播没说完就结束”
        // 优先使用 narration 目标时长，其次用字数粗估（中文按约 2.8 字/秒）
        const estimatedByText = narrationText ? Math.ceil(narrationText.length / 2.8) : 0;
        const requiredDuration = Math.max(
            12,
            Number.isFinite(narrationTargetDuration) ? narrationTargetDuration : 0,
            estimatedByText
        );
        const userMaxDuration = Number(cfg.maxDuration || 30);
        const maxDuration = Math.min(180, Math.max(userMaxDuration, requiredDuration + 6));
        workflow['50'].inputs.expression = `max(1, (a + (${trimSeconds})) * 25 + 1)`;
        const m = Math.floor(maxDuration / 60);
        const s = Math.floor(maxDuration % 60);
        workflow['7'].inputs.end_time = `${m}:${String(s).padStart(2, '0')}`;
        addTaskLog(task, `数字人目标时长已设置为 ${maxDuration}s（口播目标 ${requiredDuration}s）`, 'info');

        const promptRes = await axios.post(`${baseUrl}/prompt`, {
            prompt: workflow,
            client_id: `material_${jobId}`
        }, { httpsAgent: insecureHttpsAgent, timeout: 60000 });

        const promptId = promptRes?.data?.prompt_id;
        if (!promptId) throw new Error('ComfyUI 未返回 prompt_id');

        const videoUrl = await waitForCompletion(promptId, baseUrl);
        const aimanPath = path.join(task.outputPath, 'aiman.mp4');
        await downloadToFile(videoUrl, aimanPath);

        task.statusText = '数字人生成完成，继续执行混剪...';
        task.progress = Math.max(Number(task.progress || 0), 90);
        task.updatedAt = nowIso();
        addTaskLog(task, '数字人已生成：aiman.mp4', 'success');
        emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
        emitTaskEvent(jobId, 'status', { message: task.statusText });
    }

    function launchFromStep7(jobId, task) {
        const scriptPath = path.join(__dirname, '../../python/pipeline/run_material_driven.py');
        const materialPath = path.join(task.outputPath, 'material.mp4');
        const args = [
            scriptPath,
            materialPath,
            '--output-dir', task.outputPath,
            '--start-from', '7'
        ];
        if (!task.useSmartClip) {
            args.push('--no-smart-clip');
        }
        const pythonProcess = spawn('python', args, {
            cwd: task.outputPath,
            env: { ...process.env }
        });
        task.process = pythonProcess;
        task.status = 'running';
        task.currentStep = 7;
        task.progress = Math.max(Number(task.progress || 0), 92);
        task.updatedAt = nowIso();
        addTaskLog(task, '从步骤7继续执行', 'info');
        emitTaskEvent(jobId, 'step', { step: 7, message: '步骤7: 智能混剪' });

        pythonProcess.stdout.on('data', (data) => {
            const output = data.toString();
            task.lastStdout = `${String(task.lastStdout || '')}${output}`.slice(-40000);
            console.log(`[${jobId}] ${output}`);
            parseAndEmitProgress(jobId, output);
        });
        pythonProcess.stderr.on('data', (data) => {
            const error = data.toString();
            console.warn(`[${jobId}] WARN: ${error}`);
            collectStderr(task, error);
        });
        pythonProcess.on('close', (code) => {
            if (code === 0) {
                const outputDir = path.basename(task.outputPath);
                const videoUrl = `/projects/${outputDir}/output_final.mp4`;
                task.status = 'completed';
                task.progress = 100;
                task.currentStep = 8;
                task.statusText = '制作完成';
                task.videoUrl = videoUrl;
                task.completedAt = nowIso();
                task.updatedAt = nowIso();
                task.process = null;
                addTaskLog(task, '制作完成', 'success');
                emitTaskEvent(jobId, 'complete', { videoUrl });
                return;
            }
            const message = summarizeFailureMessage(task, code);
            task.status = 'failed';
            task.statusText = message;
            task.error = task.error || message;
            task.completedAt = nowIso();
            task.updatedAt = nowIso();
            task.process = null;
            addTaskLog(task, message, 'error');
            emitTaskEvent(jobId, 'error_event', { message });
        });
    }

    // 启动素材驱动工作流
    app.post('/api/material-driven/start', upload.fields([
        { name: 'material', maxCount: 1 },
        { name: 'audioFile', maxCount: 1 },
        { name: 'imageFile', maxCount: 1 }
    ]), async (req, res) => {
        try {
            const materialFile = req.files?.material?.[0];
            const audioUploadFile = req.files?.audioFile?.[0];
            const imageUploadFile = req.files?.imageFile?.[0];
            const materialUrl = req.body.materialUrl;

            if (!materialFile && !materialUrl) {
                return res.status(400).json({ error: '未上传素材文件或外部链接' });
            }

            const jobId = makeJobId();
            const useSmartClip = req.body.useSmartClip === 'true';
            const autoGenerate = req.body.autoGenerate === 'true';
            const outputDir = req.body.outputDir || `material_${jobId}`;

            // 创建输出目录
            const outputPath = path.join(paths.PROJECTS_DIR, outputDir);
            await ensureDir(outputPath);

            // 移动素材文件到输出目录或下载视频
            const materialPath = path.join(outputPath, 'material.mp4');
            if (materialFile) {
                fs.renameSync(materialFile.path, materialPath);
            } else if (materialUrl) {
                const writer = fs.createWriteStream(materialPath);
                const response = await axios({
                    url: materialUrl,
                    method: 'GET',
                    responseType: 'stream'
                });
                response.data.pipe(writer);
                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
            }

            // 启动Python脚本
            const scriptPath = path.join(__dirname, '../../python/pipeline/run_material_driven.py');
            const args = [
                scriptPath,
                materialPath,
                '--output-dir', outputPath
            ];

            if (!useSmartClip) {
                args.push('--no-smart-clip');
            }

            // 统一先执行到步骤5：
            // - autoGenerate=true: 由 Node 自动调 ComfyUI 生成数字人后再从步骤7续跑
            // - autoGenerate=false: 保持人工生成数字人后继续
            args.push('--end-at', '5');

            const pythonProcess = spawn('python', args, {
                cwd: outputPath,
                env: { ...process.env }
            });

            // 存储任务信息
            const task = {
                id: jobId,
                process: pythonProcess,
                outputPath,
                useSmartClip,
                autoGenerate,
                status: 'running',
                currentStep: 0,
                progress: 0,
                statusText: '工作流已启动',
                logs: [],
                startedAt: nowIso(),
                updatedAt: nowIso(),
                completedAt: null,
                error: '',
                videoUrl: '',
                outputDir,
                lastStdout: '',
                avatarConfig: {
                    genText: String(req.body.genText || '').trim(),
                    serverUrl: String(req.body.serverUrl || '').trim(),
                    trimSeconds: Number(req.body.trimSeconds || 0),
                    maxDuration: Number(req.body.maxDuration || 30),
                    audioPreset: String(req.body.audioPreset || '').trim(),
                    imagePreset: String(req.body.imagePreset || '').trim(),
                    audioUploadPath: audioUploadFile?.path || '',
                    imageUploadPath: imageUploadFile?.path || ''
                }
            };
            addTaskLog(task, '工作流已启动');
            activeTasks.set(jobId, task);

            // 处理输出
            pythonProcess.stdout.on('data', (data) => {
                const output = data.toString();
                const latest = activeTasks.get(jobId);
                if (latest) {
                    latest.lastStdout = `${String(latest.lastStdout || '')}${output}`.slice(-40000);
                }
                console.log(`[${jobId}] ${output}`);
                parseAndEmitProgress(jobId, output);
            });

            pythonProcess.stderr.on('data', (data) => {
                const error = data.toString();
                console.warn(`[${jobId}] WARN: ${error}`);
                const latest = activeTasks.get(jobId);
                if (latest) {
                    collectStderr(latest, error);
                }
            });

            pythonProcess.on('close', (code) => {
                const latest = activeTasks.get(jobId);
                if (code === 0) {
                    const hasFinalVideo = latest ? fs.existsSync(path.join(latest.outputPath, 'output_final.mp4')) : false;
                    if (latest && latest.autoGenerate && !hasFinalVideo) {
                        (async () => {
                            try {
                                await autoGenerateAvatar(jobId, latest);
                                launchFromStep7(jobId, latest);
                            } catch (err) {
                                latest.status = 'failed';
                                latest.error = err?.message || '自动生成数字人失败';
                                latest.statusText = latest.error;
                                latest.completedAt = nowIso();
                                latest.updatedAt = nowIso();
                                latest.process = null;
                                addTaskLog(latest, latest.error, 'error');
                                emitTaskEvent(jobId, 'error_event', { message: latest.error });
                            }
                        })();
                        return;
                    }
                    if (latest) {
                        latest.status = 'waiting_avatar';
                        latest.progress = Math.max(Number(latest.progress || 0), 80);
                        latest.currentStep = Math.max(Number(latest.currentStep || 0), 5);
                        latest.statusText = '前置步骤完成，等待数字人素材（aiman.mp4）后继续';
                        latest.updatedAt = nowIso();
                        latest.process = null;
                        addTaskLog(latest, latest.statusText, 'info');
                        emitTaskEvent(jobId, 'status', { message: latest.statusText });
                        emitTaskEvent(jobId, 'progress', { percent: latest.progress, message: latest.statusText });
                    }
                } else {
                    const step6MissingAiman = latest?.autoGenerate &&
                        String(latest?.lastStdout || '').includes('数字人视频未找到');
                    if (latest && step6MissingAiman) {
                        (async () => {
                            try {
                                await autoGenerateAvatar(jobId, latest);
                                launchFromStep7(jobId, latest);
                            } catch (err) {
                                latest.status = 'failed';
                                latest.error = err?.message || '自动生成数字人失败';
                                latest.statusText = latest.error;
                                latest.completedAt = nowIso();
                                latest.updatedAt = nowIso();
                                latest.process = null;
                                addTaskLog(latest, latest.error, 'error');
                                emitTaskEvent(jobId, 'error_event', { message: latest.error });
                            }
                        })();
                        return;
                    }
                    const message = summarizeFailureMessage(latest, code);
                    if (latest) {
                        latest.status = 'failed';
                        latest.statusText = message;
                        latest.error = latest.error || message;
                        latest.completedAt = nowIso();
                        latest.updatedAt = nowIso();
                        latest.process = null;
                        addTaskLog(latest, message, 'error');
                    }
                    emitTaskEvent(jobId, 'error_event', { message });
                }
            });

            res.json({
                jobId,
                outputPath: outputDir,
                message: '工作流已启动'
            });

        } catch (error) {
            console.error('启动工作流失败:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // 查询任务状态（支持刷新后恢复）
    app.get('/api/material-driven/status/:jobId', (req, res) => {
        const { jobId } = req.params;
        const task = activeTasks.get(jobId);
        if (!task) {
            return res.status(404).json({ error: '任务不存在' });
        }
        const narration = readJsonSafe(path.join(task.outputPath, 'narration.json'), null);
        const directorPlan = readJsonSafe(path.join(task.outputPath, 'director_final.json'), null);
        res.json({
            success: true,
            task: {
                id: task.id,
                status: task.status || 'unknown',
                currentStep: Number(task.currentStep || 0),
                progress: Number(task.progress || 0),
                statusText: task.statusText || '',
                logs: Array.isArray(task.logs) ? task.logs : [],
                startedAt: task.startedAt || null,
                updatedAt: task.updatedAt || null,
                completedAt: task.completedAt || null,
                error: task.error || '',
                videoUrl: task.videoUrl || '',
                outputPath: task.outputDir || '',
                narration: narration || null,
                directorPlan: Array.isArray(directorPlan) ? directorPlan : null
            }
        });
    });

    // SSE进度监听
    app.get('/api/material-driven/progress/:jobId', (req, res) => {
        const { jobId } = req.params;

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // 发送初始连接消息
        res.write(`event: status\ndata: ${JSON.stringify({ message: '已连接' })}\n\n`);

        let clients = taskClients.get(jobId);
        if (!clients) {
            clients = new Set();
            taskClients.set(jobId, clients);
        }
        clients.add(res);

        const task = activeTasks.get(jobId);
        if (task) {
            if (Number.isFinite(Number(task.currentStep)) && task.currentStep > 0) {
                res.write(`event: step\ndata: ${JSON.stringify({ step: task.currentStep, message: `步骤${task.currentStep}` })}\n\n`);
            }
            res.write(`event: progress\ndata: ${JSON.stringify({ percent: Number(task.progress || 0), message: task.statusText || '' })}\n\n`);
            if (task.status === 'completed' && task.videoUrl) {
                res.write(`event: complete\ndata: ${JSON.stringify({ videoUrl: task.videoUrl })}\n\n`);
            } else if (task.status === 'failed' && task.error) {
                res.write(`event: error_event\ndata: ${JSON.stringify({ message: task.error })}\n\n`);
            }
        }

        // 保持连接
        const keepAlive = setInterval(() => {
            res.write(`:keepalive\n\n`);
        }, 15000);

        req.on('close', () => {
            clearInterval(keepAlive);
            const set = taskClients.get(jobId);
            if (set) {
                set.delete(res);
                if (set.size === 0) {
                    taskClients.delete(jobId);
                }
            }
        });
    });

    // 继续工作流（从步骤7开始）
    app.post('/api/material-driven/continue/:jobId', async (req, res) => {
        try {
            const { jobId } = req.params;
            const task = activeTasks.get(jobId);

            if (!task) {
                return res.status(404).json({ error: '任务不存在' });
            }

            // 启动步骤7
            const scriptPath = path.join(__dirname, '../../python/pipeline/run_material_driven.py');
            const materialPath = path.join(task.outputPath, 'material.mp4');
            const args = [
                scriptPath,
                materialPath,
                '--output-dir', task.outputPath,
                '--start-from', '7'
            ];

            if (!task.useSmartClip) {
                args.push('--no-smart-clip');
            }

            const pythonProcess = spawn('python', args, {
                cwd: task.outputPath,
                env: { ...process.env }
            });

            // 更新任务
            task.process = pythonProcess;
            task.status = 'running';
            task.progress = Math.max(Number(task.progress || 0), 70);
            task.currentStep = 7;
            task.statusText = '继续执行混剪';
            task.error = '';
            task.updatedAt = nowIso();
            addTaskLog(task, '从步骤7继续执行', 'info');
            emitTaskEvent(jobId, 'status', { message: '继续执行混剪...' });

            // 处理输出
            pythonProcess.stdout.on('data', (data) => {
                const output = data.toString();
                console.log(`[${jobId}] ${output}`);
                parseAndEmitProgress(jobId, output);
            });

            pythonProcess.stderr.on('data', (data) => {
                const error = data.toString();
                console.warn(`[${jobId}] WARN: ${error}`);
                collectStderr(task, error);
            });

            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    const outputDir = path.basename(task.outputPath);
                    const videoUrl = `/projects/${outputDir}/output_final.mp4`;
                    task.status = 'completed';
                    task.progress = 100;
                    task.currentStep = 8;
                    task.statusText = '制作完成';
                    task.videoUrl = videoUrl;
                    task.completedAt = nowIso();
                    task.updatedAt = nowIso();
                    task.process = null;
                    addTaskLog(task, '制作完成', 'success');
                    emitTaskEvent(jobId, 'complete', { videoUrl });
                } else {
                    const message = summarizeFailureMessage(task, code);
                    task.status = 'failed';
                    task.statusText = message;
                    task.error = task.error || message;
                    task.completedAt = nowIso();
                    task.updatedAt = nowIso();
                    task.process = null;
                    addTaskLog(task, message, 'error');
                    emitTaskEvent(jobId, 'error_event', { message });
                }
            });

            res.json({ message: '继续执行' });

        } catch (error) {
            console.error('继续工作流失败:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // 重试步骤
    app.post('/api/material-driven/retry/:jobId', async (req, res) => {
        try {
            const { jobId } = req.params;
            const { step } = req.body;
            const task = activeTasks.get(jobId);

            if (!task) {
                return res.status(404).json({ error: '任务不存在' });
            }

            // 停止当前进程
            if (task.process) {
                task.process.kill();
            }

            // 重新启动从指定步骤
            const scriptPath = path.join(__dirname, '../../python/pipeline/run_material_driven.py');
            const materialPath = path.join(task.outputPath, 'material.mp4');
            const args = [
                scriptPath,
                materialPath,
                '--output-dir', task.outputPath,
                '--start-from', String(step)
            ];

            if (!task.useSmartClip) {
                args.push('--no-smart-clip');
            }

            const pythonProcess = spawn('python', args, {
                cwd: task.outputPath,
                env: { ...process.env }
            });

            task.process = pythonProcess;
            task.status = 'running';
            task.currentStep = step;
            task.statusText = `重试步骤${step}`;
            task.error = '';
            task.updatedAt = nowIso();
            addTaskLog(task, `开始重试步骤${step}`, 'info');
            emitTaskEvent(jobId, 'status', { message: `重试步骤${step}...` });

            // 处理输出
            pythonProcess.stdout.on('data', (data) => {
                const output = data.toString();
                console.log(`[${jobId}] ${output}`);
                parseAndEmitProgress(jobId, output);
            });

            pythonProcess.stderr.on('data', (data) => {
                const error = data.toString();
                console.warn(`[${jobId}] WARN: ${error}`);
                collectStderr(task, error);
            });

            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    const outputDir = path.basename(task.outputPath);
                    const videoUrl = `/projects/${outputDir}/output_final.mp4`;
                    task.status = 'completed';
                    task.progress = 100;
                    task.currentStep = 8;
                    task.statusText = '制作完成';
                    task.videoUrl = videoUrl;
                    task.completedAt = nowIso();
                    task.updatedAt = nowIso();
                    task.process = null;
                    addTaskLog(task, '制作完成', 'success');
                    emitTaskEvent(jobId, 'complete', { videoUrl });
                } else {
                    const message = summarizeFailureMessage(task, code);
                    task.status = 'failed';
                    task.statusText = message;
                    task.error = task.error || message;
                    task.completedAt = nowIso();
                    task.updatedAt = nowIso();
                    task.process = null;
                    addTaskLog(task, message, 'error');
                    emitTaskEvent(jobId, 'error_event', { message });
                }
            });

            res.json({ message: '重试已启动' });

        } catch (error) {
            console.error('重试失败:', error);
            res.status(500).json({ error: error.message });
        }
    });
}

/**
 * 解析Python输出并发送SSE事件
 */
function parseAndEmitProgress(jobId, output) {
    const task = activeTasks.get(jobId);
    const lines = output.split('\n');

    for (const line of lines) {
        const message = line.trim();
        if (!message) continue;
        if (task) {
            task.statusText = message;
            task.updatedAt = nowIso();
            addTaskLog(task, message, 'info');
        }

        // 解析步骤
        const stepMatch = line.match(/步骤(\d+):/);
        if (stepMatch) {
            const step = parseInt(stepMatch[1]);
            if (task) task.currentStep = step;
            emitTaskEvent(jobId, 'step', {
                step,
                message
            });
            continue;
        }

        // 解析进度
        const progressMatch = line.match(/(\d+)%/);
        if (progressMatch) {
            const percent = parseInt(progressMatch[1]);
            if (task) task.progress = percent;
            emitTaskEvent(jobId, 'progress', {
                percent,
                message
            });
            continue;
        }

        // 解析规划摘要
        if (line.includes('规划摘要')) {
            // 尝试从后续行解析
            const summaryMatch = output.match(/总时长:\s*([\d.]+)秒.*素材占比:\s*([\d.]+)%.*数字人占比:\s*([\d.]+)%/s);
            if (summaryMatch) {
                emitTaskEvent(jobId, 'plan_summary', {
                    totalDuration: parseFloat(summaryMatch[1]),
                    materialRatio: parseFloat(summaryMatch[2]),
                    aimanRatio: parseFloat(summaryMatch[3])
                });
            }
            continue;
        }

        // 解析解说词摘要
        if (line.includes('解说词摘要')) {
            const summaryMatch = output.match(/目标时长:\s*([\d.]+)秒.*字数:\s*(\d+)字.*语速:\s*([\d.]+)字\/秒/s);
            if (summaryMatch) {
                let fullText = '';
                try {
                    const narrationPath = path.join(task?.outputPath || '', 'narration.json');
                    const narration = readJsonSafe(narrationPath, {});
                    fullText = String(narration?.full_text || '').trim();
                } catch (_err) {}
                emitTaskEvent(jobId, 'narration_summary', {
                    targetDuration: parseFloat(summaryMatch[1]),
                    charCount: parseInt(summaryMatch[2]),
                    speed: parseFloat(summaryMatch[3]),
                    fullText
                });
            }
            continue;
        }

        // 普通状态消息
        emitTaskEvent(jobId, 'status', { message });
    }
}

module.exports = { registerMaterialDrivenRoutes };

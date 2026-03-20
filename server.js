const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const app = express();
app.use(express.static('public')); // 提供前端页面
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// 存储全局的 SSE (Server-Sent Events) 客户端连接，用于给前端推进度条
const clients = new Map();
const WORKFLOW_PATH = path.join(__dirname, 'workflow_api.json');
const PIPELINE_DIR = path.join(__dirname, 'pipeline_scripts');
const EDITABLE_JSON_FILES = new Set(['workflow_api.json', 'audio.json', 'result.json', 'director.json']);

function readWorkflow() {
    return JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf-8'));
}

function writeWorkflow(workflow) {
    fs.writeFileSync(WORKFLOW_PATH, JSON.stringify(workflow, null, 2), 'utf-8');
}

function extractWorkflowConfig(workflow) {
    return {
        positivePrompt: workflow["114"]?.inputs?.positive_prompt || '',
        negativePrompt: workflow["114"]?.inputs?.negative_prompt || '',
        steps: workflow["27"]?.inputs?.steps ?? 4,
        cfg: workflow["27"]?.inputs?.cfg ?? 1,
        shift: workflow["27"]?.inputs?.shift ?? 11,
        scheduler: workflow["27"]?.inputs?.scheduler || 'dpm++_sde',
        seed: workflow["27"]?.inputs?.seed ?? 1,
        audioSpeed: workflow["278"]?.inputs?.speed ?? 1,
        scaleLength: workflow["186"]?.inputs?.value ?? 1024,
        frameRate: workflow["151"]?.inputs?.frame_rate ?? 25,
        outputCrf: workflow["151"]?.inputs?.crf ?? 19,
        outputFormat: workflow["151"]?.inputs?.format || 'video/h264-mp4',
        videoModel: workflow["176"]?.inputs?.model || '',
        lora: workflow["269"]?.inputs?.lora || '',
        loraStrength: workflow["269"]?.inputs?.strength ?? 0.5
    };
}

function applyWorkflowConfig(workflow, config = {}) {
    if (config.positivePrompt !== undefined) workflow["114"].inputs.positive_prompt = String(config.positivePrompt);
    if (config.negativePrompt !== undefined) workflow["114"].inputs.negative_prompt = String(config.negativePrompt);
    if (config.steps !== undefined) workflow["27"].inputs.steps = Number(config.steps);
    if (config.cfg !== undefined) workflow["27"].inputs.cfg = Number(config.cfg);
    if (config.shift !== undefined) workflow["27"].inputs.shift = Number(config.shift);
    if (config.scheduler !== undefined) workflow["27"].inputs.scheduler = String(config.scheduler);
    if (config.seed !== undefined) {
        const seed = Number(config.seed);
        workflow["27"].inputs.seed = seed;
        workflow["278"].inputs.seed = seed;
    }
    if (config.audioSpeed !== undefined) workflow["278"].inputs.speed = Number(config.audioSpeed);
    if (config.scaleLength !== undefined) workflow["186"].inputs.value = Number(config.scaleLength);
    if (config.frameRate !== undefined) workflow["151"].inputs.frame_rate = Number(config.frameRate);
    if (config.outputCrf !== undefined) workflow["151"].inputs.crf = Number(config.outputCrf);
    if (config.outputFormat !== undefined) workflow["151"].inputs.format = String(config.outputFormat);
    if (config.videoModel !== undefined) workflow["176"].inputs.model = String(config.videoModel);
    if (config.lora !== undefined) workflow["269"].inputs.lora = String(config.lora);
    if (config.loraStrength !== undefined) workflow["269"].inputs.strength = Number(config.loraStrength);
    return workflow;
}

function resolveEditableJsonPath(fileName) {
    if (!EDITABLE_JSON_FILES.has(fileName)) {
        return null;
    }
    if (fileName === 'workflow_api.json') {
        return WORKFLOW_PATH;
    }
    return path.join(PIPELINE_DIR, fileName);
}

function buildFallbackTitleFromSubtitles(subtitlesPath) {
    try {
        if (!fs.existsSync(subtitlesPath)) return "这条消息可能正在改变支付格局";
        const subtitles = JSON.parse(fs.readFileSync(subtitlesPath, "utf-8"));
        const joined = (Array.isArray(subtitles) ? subtitles : [])
            .map((item) => String(item?.zh || item?.text || "").trim())
            .filter(Boolean)
            .join("");
        if (!joined) return "这条消息可能正在改变支付格局";
        return joined.slice(0, 18) + (joined.length > 18 ? "..." : "");
    } catch (_err) {
        return "这条消息可能正在改变支付格局";
    }
}

async function generateHotTitle(pipelineDir, subtitlesFileName = "subtitles.json") {
    const subtitlesPath = path.join(pipelineDir, subtitlesFileName);
    return new Promise((resolve) => {
        const proc = spawn("python", ["generate_title.py", "--subtitles", subtitlesFileName], { cwd: pipelineDir });
        let output = "";
        let errorOutput = "";
        proc.stdout.on("data", (data) => {
            output += data.toString();
        });
        proc.stderr.on("data", (data) => {
            errorOutput += data.toString();
        });
        proc.on("close", (code) => {
            if (code === 0 && output.trim()) {
                resolve(output.trim());
            } else {
                console.error(`generate_title.py failed: ${errorOutput.trim()}`);
                resolve(buildFallbackTitleFromSubtitles(subtitlesPath));
            }
        });
    });
}

// 给前端提供获取本地预设列表的接口
app.get('/api/presets', (req, res) => {
    try {
        const audioDir = path.join(__dirname, 'public/presets/audio');
        const imageDir = path.join(__dirname, 'public/presets/image');
        
        const audioFiles = fs.existsSync(audioDir) ? fs.readdirSync(audioDir).filter(f => f.endsWith('.wav') || f.endsWith('.mp3')) : [];
        const imageFiles = fs.existsSync(imageDir) ? fs.readdirSync(imageDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i)) : [];
        
        res.json({ success: true, audio: audioFiles, image: imageFiles });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/workflow-config', (req, res) => {
    try {
        const workflow = readWorkflow();
        res.json({ success: true, config: extractWorkflowConfig(workflow) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/workflow-config', (req, res) => {
    try {
        const workflow = readWorkflow();
        const updated = applyWorkflowConfig(workflow, req.body || {});
        writeWorkflow(updated);
        res.json({ success: true, config: extractWorkflowConfig(updated) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/json-files', (req, res) => {
    try {
        const files = Array.from(EDITABLE_JSON_FILES).map((fileName) => {
            const fullPath = resolveEditableJsonPath(fileName);
            return {
                fileName,
                exists: !!(fullPath && fs.existsSync(fullPath))
            };
        });
        res.json({ success: true, files });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/json-files/:fileName', (req, res) => {
    try {
        const fileName = req.params.fileName;
        const fullPath = resolveEditableJsonPath(fileName);
        if (!fullPath) return res.status(400).json({ error: '不支持的文件类型' });
        if (!fs.existsSync(fullPath)) return res.status(404).json({ error: '文件不存在' });
        const content = fs.readFileSync(fullPath, 'utf-8');
        res.json({ success: true, fileName, content });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/json-files/:fileName', (req, res) => {
    try {
        const fileName = req.params.fileName;
        const fullPath = resolveEditableJsonPath(fileName);
        if (!fullPath) return res.status(400).json({ error: '不支持的文件类型' });
        if (typeof req.body.content !== 'string') return res.status(400).json({ error: '缺少内容' });
        JSON.parse(req.body.content);
        fs.writeFileSync(fullPath, req.body.content, 'utf-8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 前端连接这个接口来监听进度条事件
app.get('/api/progress', (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) return res.status(400).send('Missing clientId');

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    clients.set(clientId, res);
    
    req.on('close', () => {
        clients.delete(clientId);
    });
});

// 上传文件到云端
async function uploadToComfyUI(filePath, baseUrl) {
    const form = new FormData();
    form.append('image', fs.createReadStream(filePath)); 
    form.append('type', 'input');
    form.append('subfolder', '');
    
    const res = await axios.post(`${baseUrl}/upload/image`, form, {
        headers: { ...form.getHeaders() },
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
    });
    return res.data.name; 
}

// 轮询视频生成结果 (兜底)
async function waitForCompletion(promptId, baseUrl) {
    return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
            try {
                const res = await axios.get(`${baseUrl}/history/${promptId}`, {
                    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
                });
                const history = res.data[promptId];
                if (history) {
                    clearInterval(interval);
                    
                    const outputs = history.outputs;
                    if (outputs && outputs["151"]) {
                        const mediaList = outputs["151"].videos || outputs["151"].gifs;
                        if (mediaList && mediaList.length > 0) {
                            const videoInfo = mediaList[0];
                            const videoUrl = `${baseUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=${videoInfo.type}&subfolder=${videoInfo.subfolder}`;
                            resolve(videoUrl);
                            return;
                        }
                    }
                    reject(new Error("任务完成，但未找到视频输出"));
                }
            } catch (e) {
                // 忽略网络波动
            }
        }, 3000); 
    });
}

// 监听云端 ComfyUI 的 WebSocket 获取真实进度
function listenComfyUIProgress(clientId, baseUrl) {
    try {
        const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws?clientId=${clientId}`;
        const ws = new WebSocket(wsUrl, { rejectUnauthorized: false });

        ws.on('open', () => console.log(`已连接 ComfyUI 进度通道: ${clientId}`));

        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            const sse = clients.get(clientId);

            if (msg.type === 'progress' && sse) {
                const percent = Math.round((msg.data.value / msg.data.max) * 100);
                sse.write(`data: ${JSON.stringify({ type: 'progress', percent: percent, msg: '正在努力渲染视频帧...' })}\n\n`);
            } else if (msg.type === 'executing' && sse) {
                if (msg.data.node) {
                    sse.write(`data: ${JSON.stringify({ type: 'status', msg: `当前运行节点ID: ${msg.data.node}` })}\n\n`);
                }
            }
        });

        ws.on('close', () => console.log(`WebSocket 断开: ${clientId}`));
        ws.on('error', () => {}); 
        
        return ws;
    } catch(err) {
        console.error("WS 连接失败:", err);
    }
}

// 核心生成接口
app.post('/api/generate', upload.fields([{ name: 'audio' }, { name: 'image' }]), async (req, res) => {
    let ws = null;
    try {
        const text = req.body.text;
        const clientId = req.body.clientId;
        const baseUrl = req.body.serverUrl || 'https://u920820-82c4-2ba7d3b1.westc.seetacloud.com:8443';
        const trimSeconds = parseFloat(req.body.trimSeconds || 0);
        const maxDuration = parseFloat(req.body.maxDuration || 10);
        
        const useAudioPreset = req.body.useAudioPreset === 'true';
        const useImagePreset = req.body.useImagePreset === 'true';

        // 决定使用上传文件还是本地预设文件
        let audioPath, imagePath;

        if (useAudioPreset) {
            if (!req.body.audioPreset) return res.status(400).json({ error: '未选择音频预设' });
            audioPath = path.join(__dirname, 'public/presets/audio', req.body.audioPreset);
            if (!fs.existsSync(audioPath)) return res.status(400).json({ error: '音频预设文件不存在，请检查 /public/presets/audio 目录' });
        } else {
            if (!req.files['audio']) return res.status(400).json({ error: '请上传音频文件' });
            audioPath = req.files['audio'][0].path;
        }

        if (useImagePreset) {
            if (!req.body.imagePreset) return res.status(400).json({ error: '未选择人物照片预设' });
            imagePath = path.join(__dirname, 'public/presets/image', req.body.imagePreset);
            if (!fs.existsSync(imagePath)) return res.status(400).json({ error: '人物预设文件不存在，请检查 /public/presets/image 目录' });
        } else {
            if (!req.files['image']) return res.status(400).json({ error: '请上传人物图片' });
            imagePath = req.files['image'][0].path;
        }

        if (!text || !clientId) {
            return res.status(400).json({ error: '请提供完整的文字内容' });
        }

        const sse = clients.get(clientId);
        if(sse) sse.write(`data: ${JSON.stringify({ type: 'status', msg: '正在把照片和声音上传到云端...' })}\n\n`);

        const remoteAudioName = await uploadToComfyUI(audioPath, baseUrl);
        const remoteImageName = await uploadToComfyUI(imagePath, baseUrl);
        
        ws = listenComfyUIProgress(clientId, baseUrl);

        if(sse) sse.write(`data: ${JSON.stringify({ type: 'status', msg: '正在组装AI指令，准备开始施法...' })}\n\n`);
        const workflowData = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
        const workflow = JSON.parse(workflowData);
        const workflowConfig = req.body.workflowConfig ? JSON.parse(req.body.workflowConfig) : null;
        if (workflowConfig) {
            applyWorkflowConfig(workflow, workflowConfig);
        }

        workflow["278"]["inputs"]["text"] = text;
        workflow["6"]["inputs"]["audio"] = remoteAudioName;
        workflow["180"]["inputs"]["image"] = remoteImageName;

        const randomSeed = Math.floor(Math.random() * 2147483647);
        workflow["27"]["inputs"]["seed"] = randomSeed;
        workflow["278"]["inputs"]["seed"] = randomSeed;

        workflow["50"]["inputs"]["expression"] = `max(1, (a + (${trimSeconds})) * 25 + 1)`;

        // 修改节点 7 (AudioCrop) 的最大时长，以防原版的 0:10 限制
        const m = Math.floor(maxDuration / 60);
        const s = Math.floor(maxDuration % 60);
        workflow["7"]["inputs"]["end_time"] = `${m}:${s.toString().padStart(2, '0')}`;

        const promptRes = await axios.post(`${baseUrl}/prompt`, { 
            prompt: workflow,
            client_id: clientId 
        }, {
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });
        
        const promptId = promptRes.data.prompt_id;
        
        const videoUrl = await waitForCompletion(promptId, baseUrl);
        
        if (ws) ws.close();
        res.json({ success: true, videoUrl: videoUrl });

    } catch (error) {
        if (ws) ws.close();
        console.error('执行失败:', error.message);
        res.status(500).json({ error: error.message });
    }
});

const { spawn } = require("child_process");

// 优雅地重构 runScript，使其更健壮
function runPipelineScript(scriptArgs, options) {
    return new Promise((resolve, reject) => {
        const { sse, progress, msg } = options;
        if(sse) sse.write(`data: ${JSON.stringify({ type: "progress", percent: progress, msg })}\n\n`);
        
        const proc = spawn("python", scriptArgs, { cwd: options.cwd });
        let errorOutput = "";

        proc.stdout.on("data", (data) => {
            const lastLine = data.toString().trim().split("\n").pop();
            if(sse && lastLine) sse.write(`data: ${JSON.stringify({ type: "status", msg: lastLine })}\n\n`);
        });
        
        proc.stderr.on("data", (data) => {
            const errStr = data.toString();
            errorOutput += errStr;
            console.error(`[${scriptArgs[0]} stderr]: ${errStr}`);
            if(sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "⚠️ " + errStr.trim().split("\n").pop() })}\n\n`);
        });
        
        proc.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${scriptArgs[0]} 失败: ${errorOutput.split("\n").slice(-2).join(" ")}`));
            }
        });
    });
}

app.post("/api/run-pipeline", upload.fields([{ name: "aiman" }, { name: "material" }]), async (req, res) => {
    const clientId = req.body.clientId;
    if (!clientId) return res.status(400).json({ error: "Missing clientId" });
    const sse = clients.get(clientId);
    try {
        const pipelineDir = path.join(__dirname, "pipeline_scripts");
        if (!req.files["aiman"] || !req.files["material"]) {
            return res.status(400).json({ error: "请上传数字人视频和空镜头素材视频" });
        }
        const aimanPath = path.join(pipelineDir, "aiman.mp4");
        const materialPath = path.join(pipelineDir, "material.mp4");
        const outputPath = path.join(__dirname, "public/output_final.mp4");
        // ... (file cleanup)
        fs.renameSync(req.files["aiman"][0].path, aimanPath);
        fs.renameSync(req.files["material"][0].path, materialPath);
        
        await runPipelineScript(["run_asr.py"], { sse, progress: 10, msg: "1/5: 正在 ASR 识别与翻译...", cwd: pipelineDir });
        await runPipelineScript(["video_vlm.py"], { sse, progress: 30, msg: "2/5: 正在 VLM 分析画面...", cwd: pipelineDir });
        await runPipelineScript(["run_director.py"], { sse, progress: 50, msg: "3/5: AI 导演思考剧本...", cwd: pipelineDir });
        
        const buildArgs = ["build_video.py"];
        if (req.body.withSubtitles === "false") {
            buildArgs.push("--no-subs");
        }
        await runPipelineScript(buildArgs, { sse, progress: 70, msg: "4/5: FFmpeg 正在合成视频...", cwd: pipelineDir });

        const finalSourcePath = path.join(pipelineDir, "output_final.mp4");
        let finalUrl = "/output_final.mp4";
        
        if (req.body.generateVertical === "true") {
             const contentJsonPath = path.join(pipelineDir, "content.json");
             let verticalTitle = (req.body.verticalTitle || "").trim();
             if (!verticalTitle) {
                 if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "未填写竖屏标题，正在自动生成热点标题..." })}\n\n`);
                 verticalTitle = await generateHotTitle(pipelineDir, "subtitles.json");
                 if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: `自动标题：${verticalTitle}` })}\n\n`);
             }
             fs.writeFileSync(contentJsonPath, JSON.stringify({ title: verticalTitle }, null, 2), "utf-8");
             const verticalOutputName = "output_final_vertical.mp4";
             await runPipelineScript(["make_vertical_video.py", "--input", "output_final.mp4", "--output", verticalOutputName], { sse, progress: 90, msg: "5/5: 生成动态竖屏...", cwd: pipelineDir });
             fs.copyFileSync(path.join(pipelineDir, verticalOutputName), path.join(__dirname, "public", verticalOutputName));
             finalUrl = "/" + verticalOutputName;
        } else {
             fs.copyFileSync(finalSourcePath, outputPath);
        }
        
        if(sse) sse.write(`data: ${JSON.stringify({ type: "progress", percent: 100, msg: "🎉 视频生成完毕！" })}\n\n`);
        res.json({ success: true, videoUrl: finalUrl + "?t=" + Date.now() });

    } catch (error) {
        console.error("Pipeline failed:", error);
        res.status(500).json({ error: error.message });
    }
});


// ================= 新增：文案润色接口 =================
app.post("/api/optimize-text", express.json(), (req, res) => {
    const text = req.body.text;
    if (!text) return res.status(400).json({ error: "Missing text" });
    const { spawn } = require("child_process");
    const scriptPath = path.join(__dirname, "pipeline_scripts", "optimize_text.py");
    const proc = spawn("python", [scriptPath, "--text", text]);
    let output = "";
    let err = "";
    proc.stdout.on("data", (data) => output += data.toString());
    proc.stderr.on("data", (data) => err += data.toString());
    proc.on("close", (code) => {
        if (code === 0) res.json({ text: output.trim() });
        else res.status(500).json({ error: err });
    });
});

// ================= 新增：比例转换接口 =================
app.post("/api/convert-video", express.json(), (req, res) => {
    const ratio = req.body.ratio;
    if (!ratio) return res.status(400).json({ error: "Missing ratio" });
    const pipelineDir = path.join(__dirname, "pipeline_scripts");
    const inputFile = path.join(pipelineDir, "output_final.mp4");
    const outputName = ratio === "9:16" ? "output_9_16.mp4" : "output_16_9.mp4";
    const outputFile = path.join(__dirname, "public", outputName);
    
    const { spawn } = require("child_process");
    const proc = spawn("python", ["convert_ratio.py", "--ratio", ratio, "--input", inputFile, "--output", outputFile], { cwd: pipelineDir });
    let err = "";
    proc.stderr.on("data", (data) => err += data.toString());
    proc.on("close", (code) => {
        if (code === 0) res.json({ videoUrl: "/" + outputName + "?t=" + Date.now() });
        else res.status(500).json({ error: err });
    });
});


// ================= 新增：独立竖屏生成接口 =================
app.post("/api/generate-vertical-standalone", upload.fields([{ name: "video" }, { name: "srt" }]), async (req, res) => {
    const clientId = req.body.clientId;
    if (!clientId) return res.status(400).json({ error: "Missing clientId" });
    const sse = clients.get(clientId);

    try {
        const pipelineDir = path.join(__dirname, "pipeline_scripts");
        if (!req.files["video"]) {
            return res.status(400).json({ error: "请上传需要转换的视频" });
        }
        
        // --- Prepare files ---
        const inputVideoPath = path.join(pipelineDir, "standalone_input.mp4");
        fs.renameSync(req.files["video"][0].path, inputVideoPath);
        
        const contentJsonPath = path.join(pipelineDir, "content.json");

        const subsJsonPath = path.join(pipelineDir, "subtitles.json");
        const shouldUseASR = req.body.useASR === "true" || (!req.files["srt"] && req.body.useASR !== "false");

        if (shouldUseASR) {
            if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "自动 ASR 打轴已开启，正在识别视频语音..." })}\n\n`);
            await new Promise((resolve, reject) => {
                const proc = spawn("python", ["run_asr.py", "--input", "standalone_input.mp4"], { cwd: pipelineDir });
                let errorOutput = "";
                proc.stdout.on("data", (data) => {
                    const lastLine = data.toString().trim().split("\n").pop();
                    if (sse && lastLine) sse.write(`data: ${JSON.stringify({ type: "status", msg: lastLine })}\n\n`);
                });
                proc.stderr.on("data", (data) => {
                    const errStr = data.toString();
                    errorOutput += errStr;
                    console.error(`[run_asr.py stderr]: ${errStr}`);
                });
                proc.on("close", (code) => {
                    code === 0 ? resolve() : reject(new Error(`run_asr.py failed: ${errorOutput.trim()}`));
                });
            });
        } else if (req.files["srt"]) {
            if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "检测到 SRT 文件，正在转换为 JSON..." })}\n\n`);
            const srtPath = path.join(pipelineDir, "uploaded.srt");
            fs.renameSync(req.files["srt"][0].path, srtPath);
            await new Promise((resolve, reject) => {
                const proc = spawn("python", ["convert_srt_to_json.py", srtPath, subsJsonPath], { cwd: pipelineDir });
                let errorOutput = "";
                proc.stderr.on("data", (data) => {
                    errorOutput += data.toString();
                });
                proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`SRT to JSON conversion failed: ${errorOutput.trim()}`)));
            });
        } else {
            if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "未提供字幕文件，将生成无字幕视频。" })}\n\n`);
            fs.writeFileSync(subsJsonPath, "[]");
        }

        let finalTitle = (req.body.title || "").trim();
        if (!finalTitle) {
            if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "未填写标题，正在根据字幕自动生成热点标题..." })}\n\n`);
            finalTitle = await generateHotTitle(pipelineDir, "subtitles.json");
            if (sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: `自动标题：${finalTitle}` })}\n\n`);
        }
        fs.writeFileSync(contentJsonPath, JSON.stringify({ title: finalTitle }, null, 2), "utf-8");

        // --- Run script ---
        if(sse) sse.write(`data: ${JSON.stringify({ type: "progress", percent: 50, msg: "正在渲染动态竖屏视频..." })}\n\n`);
        const outputName = "standalone_output_vertical.mp4";
        const outputPath = path.join(pipelineDir, outputName);
        
        await new Promise((resolve, reject) => {
            const proc = spawn("python", ["make_vertical_video.py", "--input", inputVideoPath, "--output", outputPath], { cwd: pipelineDir });
            proc.stderr.on("data", (data) => console.error(`[standalone_vertical stderr]: ${data}`));
            proc.on("close", (code) => code === 0 ? resolve() : reject(new Error('make_vertical_video.py failed')));
        });

        // --- Return result ---
        const finalUrlPath = path.join(__dirname, "public", outputName);
        fs.copyFileSync(outputPath, finalUrlPath);
        if(sse) sse.write(`data: ${JSON.stringify({ type: "progress", percent: 100, msg: "🎉 动态竖屏生成完毕！" })}\n\n`);
        res.json({ success: true, videoUrl: "/" + outputName + "?t=" + Date.now(), title: finalTitle });

    } catch (error) {
        console.error("Standalone vertical failed:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3001;


app.listen(PORT, () => {
    console.log(`🚀 AI面板服务端启动成功: http://localhost:${PORT}`);
});

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
        if(fs.existsSync(aimanPath)) fs.unlinkSync(aimanPath);
        if(fs.existsSync(materialPath)) fs.unlinkSync(materialPath);
        if(fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        fs.renameSync(req.files["aiman"][0].path, aimanPath);
        fs.renameSync(req.files["material"][0].path, materialPath);
        
        const runScript = (scriptName, progressPercent, msg) => {
            return new Promise((resolve, reject) => {
                if(sse) sse.write(`data: ${JSON.stringify({ type: "progress", percent: progressPercent, msg })}\n\n`);
                const proc = spawn("python", [scriptName], { cwd: pipelineDir });
                
                let errorOutput = "";
                
                proc.stdout.on("data", (data) => {
                    const lines = data.toString().trim().split("\n");
                    const lastLine = lines[lines.length - 1];
                    if(sse && lastLine) sse.write(`data: ${JSON.stringify({ type: "status", msg: lastLine })}\n\n`);
                });
                
                proc.stderr.on("data", (data) => {
                    const errStr = data.toString();
                    errorOutput += errStr;
                    console.error(`[${scriptName} stderr]: ${errStr}`);
                    if(sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "⚠️ 警告: " + errStr.trim().split("\n").pop() })}\n\n`);
                });
                
                proc.on("close", (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`${scriptName} 失败: ${errorOutput.split("\n").slice(-2).join(" ")}`));
                    }
                });
            });
        };
        await runScript("run_asr.py", 10, "1/4: 正在进行 ASR 语音识别 (听觉打轴)...");
        await runScript("video_vlm.py", 35, "2/4: 正在调用 Gemini 分析画面 (视觉打轴)...");
        await runScript("run_director.py", 65, "3/4: AI 导演正在思考剪辑剧本...");
        
        const buildArgs = ["build_video.py"];
        if (req.body.withSubtitles === "false") {
            buildArgs.push("--no-subs");
        }
        await new Promise((resolve, reject) => {
            if(sse) sse.write(`data: ${JSON.stringify({ type: "progress", percent: 85, msg: "4/4: FFmpeg 正在拼命渲染合成视频..." })}\n\n`);
            const proc = spawn("python", buildArgs, { cwd: pipelineDir });
            let errorOutput = "";
            proc.stdout.on("data", (data) => {
                const lines = data.toString().trim().split("\n");
                const lastLine = lines[lines.length - 1];
                if(sse && lastLine) sse.write(`data: ${JSON.stringify({ type: "status", msg: lastLine })}\n\n`);
            });
            proc.stderr.on("data", (data) => {
                errorOutput += data.toString();
                if(sse) sse.write(`data: ${JSON.stringify({ type: "status", msg: "⚠️ " + data.toString().trim().split("\n").pop() })}\n\n`);
            });
            proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`build_video.py 失败: ${errorOutput.split("\n").slice(-2).join(" ")}`)));
        });

        
        const finalSourcePath = path.join(pipelineDir, "output_final.mp4");
        if (fs.existsSync(finalSourcePath)) {
            fs.copyFileSync(finalSourcePath, outputPath);
            if(sse) sse.write(`data: ${JSON.stringify({ type: "progress", percent: 100, msg: "🎉 全自动剪辑完成！" })}\n\n`);
            res.json({ success: true, videoUrl: "/output_final.mp4" });
        } else {
            throw new Error("生成完毕但未找到输出文件 output_final.mp4");
        }
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

const PORT = 3001;

app.listen(PORT, () => {
    console.log(`🚀 AI面板服务端启动成功: http://localhost:${PORT}`);
});

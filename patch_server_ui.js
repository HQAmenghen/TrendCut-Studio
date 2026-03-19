const fs = require('fs');
const path = require('path');

// 1. Patch server.js
const serverPath = path.join(__dirname, 'server.js');
let serverCode = fs.readFileSync(serverPath, 'utf8');

const newEndpoints = `
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
`;

serverCode = serverCode.replace('const PORT = 3001;', newEndpoints);
fs.writeFileSync(serverPath, serverCode);

// 2. Patch index.html
const indexPath = path.join(__dirname, 'public', 'index.html');
let indexCode = fs.readFileSync(indexPath, 'utf8');

// Replace Text Area Header
const oldTextHeader = `<div class="panel-header"><span>📝 1. 核心口播文案</span></div>`;
const newTextHeader = `<div class="panel-header justify-between">
                        <span>📝 1. 核心口播文案</span>
                        <button @click="optimizeText" :disabled="optimizingText" class="bg-purple-600 hover:bg-purple-500 text-white text-xs px-3 py-1 rounded-full transition-colors flex items-center gap-1 disabled:opacity-50">
                            <span v-if="!optimizingText">✨ AI 爆款润色</span>
                            <span v-else>⏳ 润色中...</span>
                        </button>
                    </div>`;
indexCode = indexCode.replace(oldTextHeader, newTextHeader);

// Replace Video Download Area
const oldVideoDownload = `<a :href="finalVideoUrl" download class="bg-green-600 hover:bg-green-500 text-white text-xs px-3 py-1 rounded transition-colors">📥 下载成片</a>`;
const newVideoDownload = `<div class="flex gap-2">
                            <button @click="convertVideo('9:16')" :disabled="converting" class="bg-purple-600 hover:bg-purple-500 text-white text-xs px-3 py-1 rounded transition-colors disabled:opacity-50">📱 转 9:16</button>
                            <button @click="convertVideo('16:9')" :disabled="converting" class="bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1 rounded transition-colors disabled:opacity-50">🖥️ 转 16:9</button>
                            <a :href="finalVideoUrl" download class="bg-green-600 hover:bg-green-500 text-white text-xs px-3 py-1 rounded transition-colors">📥 下载原片</a>
                          </div>`;
indexCode = indexCode.replace(oldVideoDownload, newVideoDownload);

// Add Loading overlay to final video area
const oldVideoTag = `<video :src="finalVideoUrl" controls autoplay class="max-h-[350px] w-auto"></video>`;
const newVideoTag = `<video :src="finalVideoUrl" controls autoplay class="max-h-[350px] w-auto" :class="{'opacity-50': converting}"></video>
                        <div v-if="converting" class="absolute inset-0 flex items-center justify-center bg-black/50 text-white font-bold animate-pulse">
                            ⏳ 正在裁剪转换视频比例，请稍候...
                        </div>`;
indexCode = indexCode.replace(oldVideoTag, newVideoTag);

// Inject JS state and functions
const jsInjectPoint = `const editLoading = ref(false);`;
const jsInjectCode = `const editLoading = ref(false);
                const optimizingText = ref(false);
                const converting = ref(false);`;
indexCode = indexCode.replace(jsInjectPoint, jsInjectCode);

const jsMethodInjectPoint = `const handleGenUpload = (e, type) => {`;
const jsMethodInjectCode = `
                const optimizeText = async () => {
                    if (!genData.value.text) return alert("请先输入基础文案！");
                    optimizingText.value = true;
                    try {
                        const res = await axios.post('/api/optimize-text', { text: genData.value.text });
                        if (res.data.text) genData.value.text = res.data.text;
                    } catch (err) { alert("润色失败: " + err.message); }
                    finally { optimizingText.value = false; }
                };

                const convertVideo = async (ratio) => {
                    converting.value = true;
                    try {
                        const res = await axios.post('/api/convert-video', { ratio });
                        if (res.data.videoUrl) finalVideoUrl.value = res.data.videoUrl;
                    } catch (err) { alert("转换失败: " + err.message); }
                    finally { converting.value = false; }
                };

                const handleGenUpload = (e, type) => {`;
indexCode = indexCode.replace(jsMethodInjectPoint, jsMethodInjectCode);

const jsReturnPoint = `handleGenUpload, handleEditUpload, submitGenerate, submitEdit`;
const jsReturnCode = `handleGenUpload, handleEditUpload, submitGenerate, submitEdit, optimizeText, convertVideo, optimizingText, converting`;
indexCode = indexCode.replace(jsReturnPoint, jsReturnCode);

fs.writeFileSync(indexPath, indexCode);
console.log("前端和后端修改成功！");

const fs = require('fs');
const path = require('path');

// 1. Patch build_video.py
const buildVideoPath = path.join(__dirname, 'pipeline_scripts', 'build_video.py');
let buildVideoCode = fs.readFileSync(buildVideoPath, 'utf8');

if (!buildVideoCode.includes('argparse')) {
    buildVideoCode = buildVideoCode.replace('import os', 'import os\nimport argparse');
    
    // Replace the final cmd assembly
    const oldCmdStr = `cmd = [
    "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_file,
    "-vf", "subtitles=subtitles.srt:force_style='FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=40'",
    "-c:v", "libx264", "-c:a", "aac", "output_final.mp4"
]`;
    
    const newCmdStr = `parser = argparse.ArgumentParser()
parser.add_argument("--no-subs", action="store_true", help="Do not burn subtitles")
args = parser.parse_args()

cmd = [
    "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_file
]
if not args.no_subs:
    cmd.extend(["-vf", "subtitles=subtitles.srt:force_style='FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=40'"])
cmd.extend(["-c:v", "libx264", "-c:a", "aac", "output_final.mp4"])`;

    buildVideoCode = buildVideoCode.replace(oldCmdStr, newCmdStr);
    fs.writeFileSync(buildVideoPath, buildVideoCode);
}

// 2. Patch server.js
const serverPath = path.join(__dirname, 'server.js');
let serverCode = fs.readFileSync(serverPath, 'utf8');

const oldRunScriptCall = `await runScript("build_video.py", 85, "4/4: FFmpeg 正在拼命渲染合成视频...");`;
const newRunScriptCall = `
        const buildArgs = ["build_video.py"];
        if (req.body.withSubtitles === "false") {
            buildArgs.push("--no-subs");
        }
        await new Promise((resolve, reject) => {
            if(sse) sse.write(\`data: \${JSON.stringify({ type: "progress", percent: 85, msg: "4/4: FFmpeg 正在拼命渲染合成视频..." })}\\n\\n\`);
            const proc = spawn("python", buildArgs, { cwd: pipelineDir });
            let errorOutput = "";
            proc.stdout.on("data", (data) => {
                const lines = data.toString().trim().split("\\n");
                const lastLine = lines[lines.length - 1];
                if(sse && lastLine) sse.write(\`data: \${JSON.stringify({ type: "status", msg: lastLine })}\\n\\n\`);
            });
            proc.stderr.on("data", (data) => {
                errorOutput += data.toString();
                if(sse) sse.write(\`data: \${JSON.stringify({ type: "status", msg: "⚠️ " + data.toString().trim().split("\\n").pop() })}\\n\\n\`);
            });
            proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(\`build_video.py 失败: \${errorOutput.split("\\n").slice(-2).join(" ")}\`)));
        });
`;

if (serverCode.includes(oldRunScriptCall)) {
    serverCode = serverCode.replace(oldRunScriptCall, newRunScriptCall);
    fs.writeFileSync(serverPath, serverCode);
}

// 3. Patch index.html
const indexPath = path.join(__dirname, 'public', 'index.html');
let indexCode = fs.readFileSync(indexPath, 'utf8');

// Add checkbox
const editButtonHtml = `<button @click="submitEdit" :disabled="editLoading || genLoading" class="btn-success flex justify-center items-center gap-2 mt-2">`;
const newCheckboxHtml = `
                        <div class="flex items-center gap-2 mt-2 mb-2 px-1">
                            <input type="checkbox" id="withSubtitles" v-model="editData.withSubtitles" class="w-4 h-4 text-green-600 bg-gray-800 border-gray-600 rounded focus:ring-green-500 focus:ring-2">
                            <label for="withSubtitles" class="text-sm font-medium text-gray-300 cursor-pointer select-none">🔤 自动烧录 AI 中文精翻字幕</label>
                        </div>
                        <button @click="submitEdit" :disabled="editLoading || genLoading" class="btn-success flex justify-center items-center gap-2 mt-2">`;

if (!indexCode.includes('v-model="editData.withSubtitles"')) {
    indexCode = indexCode.replace(editButtonHtml, newCheckboxHtml);
    
    // Update editData ref
    indexCode = indexCode.replace(`const editData = ref({ aiman: null, material: null });`, `const editData = ref({ aiman: null, material: null, withSubtitles: true });`);
    
    // Update submitEdit FormData
    indexCode = indexCode.replace(`data.append('material', editData.value.material);`, `data.append('material', editData.value.material);\n                        data.append('withSubtitles', editData.value.withSubtitles);`);
    
    fs.writeFileSync(indexPath, indexCode);
}

console.log("字幕开关功能添加成功！");

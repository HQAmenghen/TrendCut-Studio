const axios = require('axios');
const FormData = require('form-data');
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

async function uploadToComfyUI(filePath, baseUrl) {
  const form = new FormData();
  form.append('image', fs.createReadStream(filePath));
  form.append('type', 'input');
  form.append('subfolder', '');

  const res = await axios.post(`${baseUrl}/upload/image`, form, {
    headers: { ...form.getHeaders() },
    httpsAgent: insecureHttpsAgent
  });
  return res.data.name;
}

async function waitForCompletion(promptId, baseUrl) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const res = await axios.get(`${baseUrl}/history/${promptId}`, {
          httpsAgent: insecureHttpsAgent
        });
        const history = res.data[promptId];
        if (!history) return;

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
      } catch (_err) {
        // 忽略网络波动
      }
    }, 3000);
  });
}

function listenComfyUIProgress({ clientId, baseUrl, onProgress, onStatus }) {
  try {
    const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws?clientId=${clientId}`;
    const ws = new WebSocket(wsUrl, { rejectUnauthorized: false });

    ws.on('open', () => console.log(`已连接 ComfyUI 进度通道: ${clientId}`));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'progress' && typeof onProgress === 'function') {
        const percent = Math.round((msg.data.value / msg.data.max) * 100);
        onProgress(percent, msg);
      } else if (msg.type === 'executing' && msg.data.node && typeof onStatus === 'function') {
        onStatus(`当前运行节点ID: ${msg.data.node}`, msg);
      }
    });

    ws.on('close', () => console.log(`WebSocket 断开: ${clientId}`));
    ws.on('error', () => {});

    return ws;
  } catch (err) {
    console.error("WS 连接失败:", err);
    return null;
  }
}

module.exports = {
  listenComfyUIProgress,
  uploadToComfyUI,
  waitForCompletion
};

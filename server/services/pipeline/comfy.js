const axios = require('axios');
const FormData = require('form-data');
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function sanitizeUrl(url) {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '');
}

async function uploadToComfyUI(filePath, baseUrl) {
  const cleanUrl = sanitizeUrl(baseUrl);
  const form = new FormData();
  form.append('image', fs.createReadStream(filePath));
  form.append('type', 'input');
  form.append('subfolder', '');

  try {
    const res = await axios.post(`${cleanUrl}/upload/image`, form, {
      headers: { ...form.getHeaders() },
      httpsAgent: insecureHttpsAgent
    });
    return res.data.name;
  } catch (err) {
    const status = err.response ? err.response.status : 'N/A';
    throw new Error(`[ComfyUI 上传失败] URL: ${cleanUrl}/upload/image, Status: ${status}, Message: ${err.message}`);
  }
}

async function waitForCompletion(promptId, baseUrl) {
  const cleanUrl = sanitizeUrl(baseUrl);
  return new Promise((resolve, reject) => {
    let checkCount = 0;
    const interval = setInterval(async () => {
      try {
        checkCount++;
        const res = await axios.get(`${cleanUrl}/history/${promptId}`, {
          httpsAgent: insecureHttpsAgent
        });
        const history = res.data[promptId];
        if (!history) return;

        clearInterval(interval);

        // 检查 ComfyUI 内部错误信息
        const status = history.status || {};
        if (status.messages && Array.isArray(status.messages)) {
          const execError = status.messages.find(m => m[0] === 'execution_error');
          if (execError && execError[1]) {
            const errDetails = execError[1];
            const nodeName = errDetails.node_name || errDetails.node_id;
            const errorMsg = errDetails.exception_message || '未知异常';
            reject(new Error(`[ComfyUI 节点错误] ${nodeName}(#${errDetails.node_id}): ${errorMsg}`));
            return;
          }
        }

        const outputs = history.outputs;
        if (outputs) {
          // 优先寻找常见的输出节点 ID (151 为本项目的 VHS_VideoCombine)
          let videoInfo = null;
          let targetNodeId = '151';

          const targetOutput = outputs[targetNodeId];
          if (targetOutput) {
            const mediaList = targetOutput.videos || targetOutput.gifs;
            if (mediaList && mediaList.length > 0) {
              videoInfo = mediaList[0];
            }
          }

          // 兜底：如果 151 没找到，尝试在所有输出中寻找视频
          if (!videoInfo) {
            for (const nodeId in outputs) {
              const nodeOutput = outputs[nodeId];
              const mediaList = nodeOutput.videos || nodeOutput.gifs;
              if (mediaList && mediaList.length > 0) {
                videoInfo = mediaList[0];
                targetNodeId = nodeId;
                break;
              }
            }
          }

          if (videoInfo) {
            const videoUrl = `${cleanUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=${videoInfo.type}&subfolder=${videoInfo.subfolder}`;
            resolve(videoUrl);
            return;
          }
        }

        // 如果没有输出且没有明确报错，可能是节点未执行
        reject(new Error('ComfyUI 任务结束，但未找到有效的视频输出节点。请检查 ComfyUI 控制台是否缺少插件或模型。'));
      } catch (_err) {
        // 网络抖动，不做处理，重试直到超时
        if (checkCount > 200) { // 约 10 分钟超时
          clearInterval(interval);
          reject(new Error(`等待 ComfyUI 结果超时: ${_err.message}`));
        }
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
    console.error('WS 连接失败:', err);
    return null;
  }
}

module.exports = {
  listenComfyUIProgress,
  uploadToComfyUI,
  waitForCompletion
};

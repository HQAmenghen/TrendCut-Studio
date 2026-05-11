const fs = require('fs');
const https = require('https');
const axios = require('axios');

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadToFile(url, outputPath, options = {}) {
  const writer = fs.createWriteStream(outputPath);
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: options.timeout || 180000,
    httpsAgent: insecureHttpsAgent,
    headers: options.headers
  });
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function downloadMaterialFromUrl({ url, outputPath, jobId, maxRetries = 3 }) {
  let lastDownloadErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await downloadToFile(url, outputPath, {
        timeout: 120000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      lastDownloadErr = null;
      break;
    } catch (dlErr) {
      lastDownloadErr = dlErr;
      console.warn(`[download] ${jobId || 'material'} attempt ${attempt}/${maxRetries} failed: ${dlErr.code || dlErr.message}`);
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (_err) {}
      if (attempt < maxRetries) {
        await wait(2000 * attempt);
      }
    }
  }
  if (lastDownloadErr) {
    throw new Error(`素材视频下载失败（已重试${maxRetries}次）: ${lastDownloadErr.code || lastDownloadErr.message}`);
  }
}

async function probeComfyUI(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!normalized) {
    throw new Error('未填写 ComfyUI 地址');
  }

  const candidates = [
    `${normalized}/system_stats`,
    `${normalized}/queue`,
    `${normalized}/history`
  ];

  let lastError = null;
  for (const url of candidates) {
    try {
      const res = await axios.get(url, {
        timeout: 12000,
        httpsAgent: insecureHttpsAgent
      });
      return {
        ok: true,
        baseUrl: normalized,
        testedUrl: url,
        status: res.status
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('ComfyUI 连通性检测失败');
}

module.exports = {
  insecureHttpsAgent,
  downloadToFile,
  downloadMaterialFromUrl,
  probeComfyUI
};

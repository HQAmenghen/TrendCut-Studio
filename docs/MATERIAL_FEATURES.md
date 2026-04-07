# 素材与TTS功能集成文档

## 概述

本次集成将 NarratoAI 的素材搜索和TTS语音合成功能完整移植到 Comfy Panel Demo 项目中。

## 新增功能

### 1. 素材搜索引擎 (`material_search.py`)

支持从多个平台搜索和下载视频素材。

#### 支持的平台
- **Pexels** - 高质量免费视频素材
- **Pixabay** - 免费视频和图片素材

#### 核心功能
- 关键词搜索
- 分辨率筛选（竖屏/横屏/方形）
- 时长筛选
- 自动下载
- 多平台聚合搜索

#### 使用示例

```bash
# 搜索竖屏风景视频
python python/pipeline/material_search.py '风景' \
    --platform pexels \
    --orientation portrait \
    --duration 5 \
    --max-results 10

# 搜索并下载第一个结果
python python/pipeline/material_search.py '城市' \
    --platform all \
    --download \
    --output-dir ./materials

# 使用API Key
python python/pipeline/material_search.py '海洋' \
    --pexels-key YOUR_API_KEY \
    --pixabay-key YOUR_API_KEY
```

#### Python API

```python
from pipeline.material_search import MaterialSearchEngine

# 创建搜索引擎
config = {
    'pexels_api_key': 'YOUR_KEY',
    'pixabay_api_key': 'YOUR_KEY'
}
engine = MaterialSearchEngine(config)

# 搜索素材
results = engine.search_all(
    search_term='nature',
    minimum_duration=5,
    orientation='portrait',
    max_results=10
)

# 下载素材
for material in results:
    path = engine.download_material(
        material,
        save_dir='./materials'
    )
    print(f"Downloaded: {path}")
```

### 2. TTS语音合成引擎 (`tts_engine.py`)

支持多种TTS引擎的统一接口。

#### 支持的引擎

**Edge TTS** (免费，推荐)
- 无需API Key
- 支持多种语音
- 支持字幕生成
- 语速/音量/音调可调

**Azure Speech** (付费)
- 高质量语音
- 更多自定义选项
- 需要Azure订阅

#### 使用示例

```bash
# 使用Edge TTS合成
python python/pipeline/tts_engine.py "你好世界" \
    --output hello.mp3 \
    --engine edge_tts \
    --voice zh-CN-XiaoxiaoNeural

# 调整语速和音调
python python/pipeline/tts_engine.py "快速朗读" \
    --output fast.mp3 \
    --rate "+50%" \
    --pitch "+10Hz"

# 生成字幕
python python/pipeline/tts_engine.py "带字幕的语音" \
    --output audio.mp3 \
    --subtitle audio.srt

# 使用Azure Speech
python python/pipeline/tts_engine.py "Azure语音" \
    --output azure.mp3 \
    --engine azure_speech \
    --azure-key YOUR_KEY \
    --azure-region eastus
```

#### Python API

```python
from pipeline.tts_engine import TTSManager
import asyncio

# 创建TTS管理器
config = {
    'azure_speech_key': 'YOUR_KEY',
    'azure_speech_region': 'eastus'
}
manager = TTSManager(config)

# 合成语音
async def synthesize():
    success = await manager.synthesize(
        text="你好世界",
        output_path="hello.mp3",
        engine="edge_tts",
        voice="zh-CN-XiaoxiaoNeural",
        rate="+0%",
        volume="+0%"
    )
    return success

asyncio.run(synthesize())
```

#### 常用中文语音

| 语音名称 | 性别 | 特点 |
|---------|------|------|
| zh-CN-XiaoxiaoNeural | 女 | 温柔自然 |
| zh-CN-XiaoyiNeural | 女 | 清晰明快 |
| zh-CN-YunjianNeural | 男 | 沉稳大气 |
| zh-CN-YunxiNeural | 男 | 年轻活力 |
| zh-CN-YunyangNeural | 男 | 专业播音 |

### 3. 统一素材管理器 (`material_manager.py`)

整合素材搜索、TTS、缓存管理的统一接口。

#### 核心功能
- 素材搜索和下载
- TTS语音合成
- 智能缓存管理
- 批量处理
- 缓存统计和报告

#### 使用示例

```bash
# 搜索视频素材
python python/pipeline/material_manager.py search '风景' \
    --platform pexels \
    --download

# 合成语音
python python/pipeline/material_manager.py tts "你好世界" \
    --engine edge_tts \
    --voice zh-CN-XiaoxiaoNeural

# 查看缓存统计
python python/pipeline/material_manager.py cache stats

# 清理缓存
python python/pipeline/material_manager.py cache clear --type video

# 导出缓存报告
python python/pipeline/material_manager.py cache report
```

#### Python API

```python
from pipeline.material_manager import MaterialManager
import asyncio

# 创建管理器
config = {
    'pexels_api_key': 'YOUR_KEY',
    'pixabay_api_key': 'YOUR_KEY'
}
manager = MaterialManager(config, cache_dir='./cache')

# 搜索并下载视频
results = manager.search_videos('nature', platform='pexels')
if results:
    video_path = manager.download_video(results[0])

# 合成语音（自动缓存）
async def main():
    audio_path = await manager.synthesize_speech(
        text="你好世界",
        engine="edge_tts",
        voice="zh-CN-XiaoxiaoNeural",
        use_cache=True
    )
    print(f"Audio: {audio_path}")

asyncio.run(main())

# 批量合成
async def batch():
    texts = ["第一句", "第二句", "第三句"]
    results = await manager.batch_synthesize(texts)
    return results

asyncio.run(batch())

# 缓存管理
stats = manager.get_cache_stats()
print(f"视频: {stats['video_count']} 个")
print(f"音频: {stats['audio_count']} 个")
print(f"总大小: {stats['total_size_mb']:.2f} MB")
```

## 配置说明

### 环境变量

在 `.env` 文件中添加：

```bash
# ========== 素材搜索功能 ==========
# Pexels API (https://www.pexels.com/api/)
PEXELS_API_KEY=your_pexels_api_key

# Pixabay API (https://pixabay.com/api/docs/)
PIXABAY_API_KEY=your_pixabay_api_key

# 素材缓存
MATERIAL_CACHE_ENABLED=true
MATERIAL_CACHE_DIR=./cache/materials

# ========== TTS语音合成功能 ==========
# 默认TTS引擎 (edge_tts / azure_speech)
TTS_ENGINE=edge_tts

# Edge TTS配置（免费，无需API Key）
EDGE_TTS_VOICE=zh-CN-XiaoxiaoNeural
EDGE_TTS_RATE=+0%
EDGE_TTS_VOLUME=+0%
EDGE_TTS_PITCH=+0Hz

# Azure Speech配置
AZURE_SPEECH_KEY=your_azure_key
AZURE_SPEECH_REGION=eastus
AZURE_SPEECH_VOICE=zh-CN-XiaoxiaoNeural

# TTS缓存
TTS_CACHE_ENABLED=true
TTS_CACHE_DIR=./cache/tts
```

### 获取API Key

#### Pexels
1. 访问 https://www.pexels.com/api/
2. 注册账号
3. 创建应用获取API Key
4. 免费额度: 200请求/小时

#### Pixabay
1. 访问 https://pixabay.com/api/docs/
2. 注册账号
3. 获取API Key
4. 免费额度: 5000请求/小时

#### Azure Speech
1. 访问 https://portal.azure.com/
2. 创建Speech服务
3. 获取Key和Region
4. 免费额度: 5小时/月

## 集成到项目

### Node.js集成

在 `server.js` 中添加素材和TTS路由：

```javascript
// 素材搜索
app.post('/api/search-materials', async (req, res) => {
    const { keyword, platform, orientation } = req.body;
    
    const result = await runPythonScript(
        'python/pipeline/material_search.py',
        [keyword, '--platform', platform, '--orientation', orientation],
        { timeout: 60000 }
    );
    
    res.json({ success: true, materials: result });
});

// TTS合成
app.post('/api/synthesize-speech', async (req, res) => {
    const { text, voice, engine } = req.body;
    
    const outputPath = `./cache/tts/${Date.now()}.mp3`;
    
    await runPythonScript(
        'python/pipeline/tts_engine.py',
        [text, '--output', outputPath, '--engine', engine, '--voice', voice],
        { timeout: 120000 }
    );
    
    res.json({ success: true, audioPath: outputPath });
});
```

### 前端集成

```vue
<template>
  <div>
    <!-- 素材搜索 -->
    <input v-model="keyword" placeholder="搜索关键词" />
    <button @click="searchMaterials">搜索素材</button>
    
    <!-- TTS合成 -->
    <textarea v-model="text" placeholder="输入文本"></textarea>
    <button @click="synthesizeSpeech">合成语音</button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      keyword: '',
      text: ''
    }
  },
  methods: {
    async searchMaterials() {
      const response = await fetch('/api/search-materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: this.keyword,
          platform: 'pexels',
          orientation: 'portrait'
        })
      });
      const data = await response.json();
      console.log('Materials:', data.materials);
    },
    
    async synthesizeSpeech() {
      const response = await fetch('/api/synthesize-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: this.text,
          engine: 'edge_tts',
          voice: 'zh-CN-XiaoxiaoNeural'
        })
      });
      const data = await response.json();
      console.log('Audio:', data.audioPath);
    }
  }
}
</script>
```

## 性能优化

### 缓存策略

1. **素材缓存**
   - 基于URL的MD5哈希
   - 避免重复下载
   - 自动清理过期缓存

2. **TTS缓存**
   - 基于文本+引擎+语音的哈希
   - 相同文本直接使用缓存
   - 大幅提升响应速度

### 并发处理

```python
# 批量合成语音
async def batch_synthesize():
    manager = MaterialManager()
    texts = ["文本1", "文本2", "文本3"]
    
    # 并发合成
    results = await manager.batch_synthesize(texts)
    return results
```

## 故障排查

### 问题1: 素材搜索失败

**症状**: 返回空结果或错误

**解决**:
1. 检查API Key是否正确
2. 检查网络连接
3. 检查API配额是否用完
4. 尝试更换搜索关键词

### 问题2: TTS合成失败

**症状**: 无法生成音频文件

**解决**:
1. 检查edge-tts是否安装: `pip install edge-tts`
2. 检查网络连接
3. 尝试更换语音名称
4. 检查文本内容是否有特殊字符

### 问题3: 缓存占用过大

**症状**: 磁盘空间不足

**解决**:
```bash
# 查看缓存统计
python python/pipeline/material_manager.py cache stats

# 清理视频缓存
python python/pipeline/material_manager.py cache clear --type video

# 清理所有缓存
python python/pipeline/material_manager.py cache clear --type all
```

## 最佳实践

### 1. 素材搜索
- 使用具体的关键词
- 设置合理的时长筛选
- 优先使用Pexels（质量更高）
- 启用缓存避免重复下载

### 2. TTS合成
- 优先使用Edge TTS（免费）
- 启用缓存提升性能
- 批量合成提高效率
- 选择合适的语音角色

### 3. 缓存管理
- 定期查看缓存统计
- 及时清理不需要的缓存
- 导出缓存报告便于分析

## 下一步

1. ✅ 运行综合测试: `python python/pipeline/test_all_features.py`
2. ✅ 配置API Key
3. ⏳ 集成到Node.js后端
4. ⏳ 添加前端界面
5. ⏳ 部署到生产环境

## 相关文档

- [智能剪辑集成文档](SMART_CLIP_INTEGRATION.md)
- [快速使用指南](SMART_CLIP_USAGE.md)
- [完成总结](SMART_CLIP_SUMMARY.md)

---

**版本**: 1.0.0  
**更新日期**: 2026-04-03  
**状态**: ✅ 完成并可用

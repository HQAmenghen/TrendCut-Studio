#!/usr/bin/env python3
"""
诊断 dashscope.aliyuncs.com 超时原因
运行: python diagnose_qwen.py
"""
import sys, os, time, socket, json, io
from pathlib import Path

# 强制 utf-8 输出（避免 Windows GBK 终端崩溃）
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


# 加载 .env
PROJECT_ROOT = Path(__file__).resolve().parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
try:
    from load_env import load_project_env
    load_project_env(__file__)
except Exception as e:
    print(f"[warn] 无法加载 .env: {e}")

HOST = "dashscope.aliyuncs.com"
PORT = 443
API_KEY = os.getenv("QWEN_API_KEY", "")
BASE_URL = os.getenv("QWEN_API_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
MODEL   = os.getenv("QWEN_TEXT_MODEL", "qwen3.6-plus")

def sep(title=""):
    print("\n" + "─" * 60)
    if title:
        print(f"  {title}")
    print("─" * 60)

# ─── 1. DNS ────────────────────────────────────────────────
sep("1. DNS 解析")
t0 = time.time()
try:
    ip = socket.gethostbyname(HOST)
    print(f"  ✅ 解析成功: {HOST} → {ip}  ({(time.time()-t0)*1000:.0f} ms)")
except Exception as e:
    print(f"  ❌ DNS 解析失败: {e}")
    print("  →  可能原因: 无网络 / DNS 被污染 / 防火墙拦截")
    sys.exit(1)

# ─── 2. TCP 连接 ───────────────────────────────────────────
sep("2. TCP 连接 (443)")
t0 = time.time()
try:
    s = socket.create_connection((HOST, PORT), timeout=10)
    s.close()
    print(f"  ✅ TCP 三次握手成功  ({(time.time()-t0)*1000:.0f} ms)")
except Exception as e:
    print(f"  ❌ TCP 连接失败: {e}")
    print("  →  可能原因: 防火墙/代理拦截 HTTPS 端口")
    sys.exit(1)

# ─── 3. HTTPS 基础请求 ─────────────────────────────────────
sep("3. HTTPS 基础请求 (无需 API Key)")
try:
    import urllib.request, ssl
    ctx = ssl.create_default_context()
    url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"
    req = urllib.request.Request(url, method="GET")
    t0 = time.time()
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=15)
    except urllib.error.HTTPError as e:
        # 4xx/5xx 说明 HTTPS 本身通了
        elapsed = (time.time()-t0)*1000
        print(f"  ✅ HTTPS 可达 (HTTP {e.code})  ({elapsed:.0f} ms)")
    except Exception as e:
        elapsed = (time.time()-t0)*1000
        print(f"  ⚠️  HTTPS 请求异常: {e}  ({elapsed:.0f} ms)")
except Exception as e:
    print(f"  ❌  HTTPS 测试失败: {e}")

# ─── 4. openai SDK 连接 ────────────────────────────────────
sep("4. OpenAI SDK 连接测试 (models list)")
try:
    from openai import OpenAI
    client = OpenAI(api_key=API_KEY, base_url=BASE_URL, timeout=20)
    t0 = time.time()
    models = client.models.list()
    elapsed = (time.time()-t0)*1000
    model_ids = [m.id for m in models.data[:5]]
    print(f"  ✅ 模型列表获取成功  ({elapsed:.0f} ms)")
    print(f"     前5个模型: {model_ids}")
except Exception as e:
    elapsed = (time.time()-t0)*1000
    print(f"  ❌ 模型列表失败  ({elapsed:.0f} ms)")
    print(f"     错误: {e}")

# ─── 5. 小型 Chat 请求 (5秒超时) ──────────────────────────
sep(f"5. 小型 Chat 请求 (model={MODEL}, timeout=30s)")
try:
    from openai import OpenAI
    client = OpenAI(api_key=API_KEY, base_url=BASE_URL, timeout=30)
    t0 = time.time()
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "请用一句话介绍你自己。"}],
        max_tokens=50,
        stream=False,
    )
    elapsed = (time.time()-t0)*1000
    content = resp.choices[0].message.content.strip()
    print(f"  ✅ Chat 成功  ({elapsed:.0f} ms)")
    print(f"     首 Token: {content[:80]}")
except Exception as e:
    elapsed = (time.time()-t0)*1000
    print(f"  ❌ Chat 失败  ({elapsed:.0f} ms)")
    print(f"     错误: {e}")

# ─── 6. 大型 Prompt 请求（模拟打分场景）─────────────────
sep(f"6. 打分场景模拟 (大 Prompt, timeout=120s)")
FAKE_SEGMENTS = json.dumps([
    {"id": "seg_01", "duration_sec": 3.4, "text": "这是一个测试片段，用于模拟素材打分请求。",
     "visual_summary": "person speaking on camera", "ocr_text": ""},
], ensure_ascii=False, indent=2)
BIG_PROMPT = f"""
你是一个视频素材评分专家。请对以下素材片段进行评分，返回严格的 JSON 格式。
每个片段需要包含：information_density (0-10), visual_usability (0-10), evidence_strength (0-10)。

片段列表：
{FAKE_SEGMENTS}

请返回如下格式：
{{"segments": [{{"id": "seg_01", "information_density": 7, "visual_usability": 8, "evidence_strength": 7, "reason": "画面清晰"}}]}}
"""
try:
    from openai import OpenAI
    client = OpenAI(api_key=API_KEY, base_url=BASE_URL, timeout=120)
    t0 = time.time()
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": BIG_PROMPT}],
        max_tokens=400,
        stream=False,
    )
    elapsed = (time.time()-t0)*1000
    content = resp.choices[0].message.content.strip()
    print(f"  ✅ 大 Prompt 成功  ({elapsed:.0f} ms)")
    print(f"     响应前100字: {content[:100]}")
except Exception as e:
    elapsed = (time.time()-t0)*1000
    print(f"  ❌ 大 Prompt 失败  ({elapsed:.0f} ms)")
    print(f"     错误: {e}")
    if "timeout" in str(e).lower() or "timed out" in str(e).lower():
        print()
        print("  ─── 超时诊断 ───")
        print("  可能原因（按概率排序）:")
        print("  1. 并发限流: 阿里云 DashScope 对同一 API Key 并发请求数有限制")
        print("     → 解决: 减少 MATERIAL_SCORING_LLM_BATCH_SIZE 为 1，串行发送")
        print("  2. 模型负载: 指定模型服务端队列拥堵，返回极慢")
        print("     → 解决: 换用 qwen-turbo 或 qwen-plus（更快）")
        print("  3. 网络抖动: 本机到 aliyun 偶发丢包")
        print("     → 解决: 重试即可，或配置代理")
        print("  4. Prompt 过长: 单次 tokens 过多导致生成时间超过 120s")
        print("     → 解决: 减小 batch_size，或加 max_tokens 上限")

# ─── 7. 代理检测 ───────────────────────────────────────────
sep("7. 代理环境检测")
for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY"):
    val = os.getenv(key, "")
    if val:
        print(f"  ℹ️  {key}={val}")
if not any(os.getenv(k) for k in ("HTTP_PROXY","HTTPS_PROXY","http_proxy","https_proxy","ALL_PROXY")):
    print("  （未检测到代理环境变量）")

sep("诊断完成")

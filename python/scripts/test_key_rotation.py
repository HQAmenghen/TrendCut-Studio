import os
import sys
from pathlib import Path

# 设置搜索路径
PROJECT_ROOT = Path(__file__).resolve().parents[1]
PIPELINE_ROOT = PROJECT_ROOT / "pipeline"

for p in [PROJECT_ROOT, PIPELINE_ROOT]:
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from qwen_client import create_qwen_client
from gemini_client import create_gemini_client, GeminiPool
from pipeline.score_material_segments import score_segments_with_llm

# Mock 环境变量 (必须在导入后设置，以覆盖 .env 加载的结果)
os.environ["QWEN_API_KEY"] = "key1;key2;key3"
os.environ["GEMINI_API_KEY"] = "gkey1;gkey2"
os.environ["LLM_PROVIDER"] = "qwen"

def test_qwen_rotation():
    print("--- Testing Qwen Rotation ---")
    client = create_qwen_client()
    print(f"Detected key count: {client.key_count}")
    
    used_keys = []
    for _ in range(5):
        key = client.api_key
        used_keys.append(key)
        print(f"Picked key: {key}")
    
    expected = ["key1", "key2", "key3", "key1", "key2"]
    assert used_keys == expected, f"Rotation failed: {used_keys}"
    print("✓ Qwen Rotation Passed")

def test_gemini_rotation():
    print("\n--- Testing Gemini Rotation ---")
    client = create_gemini_client()
    assert isinstance(client, GeminiPool), "GeminiPool should be created for multiple keys"
    print(f"Detected key count in pool: {client.rotator.count}")
    
    used_client_ids = []
    for _ in range(4):
        # 无状态操作轮询
        sub_client = client.get_client(stateless=True)
        # 记录对象 ID
        used_client_ids.append(id(sub_client))
        print(f"Stateless Picked client ID: {id(sub_client)}")
    
    primary_client = client.get_client(stateless=False)
    primary_id = id(primary_client)
    print(f"Primary (Stateful) client ID: {primary_id}")
    
    # 验证轮询: 前两个 ID 应该是不同的（如果有 2 个 Key）
    assert used_client_ids[0] != used_client_ids[1], "Gemini Rotation failed: same client returned"
    assert used_client_ids[0] == used_client_ids[2], "Gemini Rotation failed: cycle not working"
    assert primary_id == used_client_ids[0], "Gemini Primary client should be the first one"
    print("✓ Gemini Rotation Passed")

def test_concurrency_calculation():
    print("\n--- Testing Concurrency Calculation ---")
    # Qwen With 3 keys
    client = create_qwen_client()
    # 模拟 score_segments_with_llm 中的逻辑 (不执行实际请求)
    key_count = client.key_count
    default_max_workers = 2 * key_count
    print(f"Calculated max_workers for 3 keys: {default_max_workers}")
    assert default_max_workers == 6
    print("✓ Concurrency Calculation Passed")

if __name__ == "__main__":
    try:
        test_qwen_rotation()
        test_gemini_rotation()
        test_concurrency_calculation()
        print("\n✨ All tests passed!")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)

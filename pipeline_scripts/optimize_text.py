import sys
import io
import argparse
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import google.generativeai as genai

API_KEY = "AIzaSyDMmNqLCLnGQnjIK_IdAV4alpj8K2xYnJk"
genai.configure(api_key=API_KEY)

def optimize_text(text):
    model = genai.GenerativeModel('gemini-2.5-pro')
    prompt = f"""
    你是一个爆款短视频文案大师。请优化以下口播文案，使其更具网感、悬念和吸引力（例如开头制造悬念，吸引注意力，结尾引导评论等），但必须保持原意。
    原始文案：
    {text}
    
    【要求】
    1. 结构紧凑，适合短视频口播。
    2. 开头必须有“钩子”吸引人留步。
    3. 只输出优化后的文案文本，不要包含任何额外的解释或标注（如不要带“优化后文案：”等字样）。
    """
    response = model.generate_content(prompt)
    print(response.text.strip())

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", type=str, required=True, help="原始口播文案")
    args = parser.parse_args()
    optimize_text(args.text)
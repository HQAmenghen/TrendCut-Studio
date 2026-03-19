import subprocess
import argparse
import os

def convert_video(input_file, ratio, output_file):
    print(f"1. 正在将 {input_file} 转换为 {ratio} 比例...")
    
    # 获取原始视频宽高
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", input_file],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True
    )
    orig_w, orig_h = map(int, res.stdout.strip().split("x"))
    
    if ratio == "9:16":
        # 宽屏转竖屏：居中裁剪（保持高度，裁剪左右）
        target_w = int(orig_h * 9 / 16)
        crop_filter = f"crop={target_w}:{orig_h}"
    else: # 16:9
        # 竖屏转宽屏：居中裁剪（保持宽度，裁剪上下）
        target_h = int(orig_w * 9 / 16)
        crop_filter = f"crop={orig_w}:{target_h}"

    cmd = [
        "ffmpeg", "-y", "-i", input_file,
        "-vf", crop_filter,
        "-c:v", "libx264", "-preset", "fast",
        "-c:a", "copy",
        output_file
    ]
    subprocess.run(cmd)
    print(f"2. 转换成功！已输出为 {output_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ratio", type=str, required=True, choices=["9:16", "16:9"])
    parser.add_argument("--input", type=str, default="output_final.mp4")
    parser.add_argument("--output", type=str, required=True)
    args = parser.parse_args()
    
    convert_video(args.input, args.ratio, args.output)
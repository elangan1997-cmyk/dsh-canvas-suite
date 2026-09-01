#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地 rembg 背景移除。

首次运行会在用户目录创建隔离的 Python 虚拟环境并安装 rembg[cpu]，
随后由 rembg 自动下载 isnet-general-use ONNX 模型。模型与依赖不会写入
项目目录，也不会被打进插件包；换一台机器时首次点击“去除背景”即可准备。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time


REMBG_VERSION = "2.0.61"
RUNTIME_ROOT = Path.home() / ".dsh" / "canvas-workbench" / "rembg-runtime"
MODEL_ROOT = Path.home() / ".dsh" / "canvas-workbench" / "rembg-models"
MARKER = RUNTIME_ROOT / ("rembg-" + REMBG_VERSION + ".ready")
PROGRESS_PATH: Path | None = None


def emit_progress(stage: str, message: str, percent: int | None = None) -> None:
    """写入可轮询的进度文件，同时保留一行 JSON 日志供宿主诊断。"""
    payload = {
        "ok": True,
        "stage": stage,
        "message": message,
        "percent": percent,
        "updatedAt": time.time(),
    }
    if PROGRESS_PATH:
        try:
            PROGRESS_PATH.parent.mkdir(parents=True, exist_ok=True)
            temporary = PROGRESS_PATH.with_name(PROGRESS_PATH.name + ".tmp-" + str(os.getpid()))
            temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            temporary.replace(PROGRESS_PATH)
        except OSError:
            # 进度展示不能影响实际去背景任务。
            pass
    print(json.dumps({"progress": True, **payload}, ensure_ascii=False), flush=True)


def runtime_python() -> Path:
    if os.name == "nt":
        return RUNTIME_ROOT / "Scripts" / "python.exe"
    return RUNTIME_ROOT / "bin" / "python"


def activate_runtime(python: Path) -> None:
    """在当前进程加载隔离 venv，避免 Windows 子进程 os.execv 的 Errno 22。"""
    site_packages = python.parent.parent / "Lib" / "site-packages" if os.name == "nt" else python.parent.parent / "lib"
    if os.name != "nt":
        candidates = list(site_packages.glob("python*/site-packages")) if site_packages.exists() else []
        if candidates:
            site_packages = candidates[0]
    if site_packages.exists() and str(site_packages) not in sys.path:
        sys.path.insert(0, str(site_packages))
    if os.name == "nt":
        scripts = str(python.parent)
        os.environ["VIRTUAL_ENV"] = str(python.parent.parent)
        os.environ["PATH"] = scripts + os.pathsep + os.environ.get("PATH", "")
        dll_dir = site_packages / "onnxruntime" / "capi"
        if hasattr(os, "add_dll_directory") and dll_dir.exists():
            try:
                os.add_dll_directory(str(dll_dir))
            except OSError:
                pass


def run_checked(argv: list[str], label: str) -> None:
    try:
        subprocess.run(argv, check=True, timeout=900)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(label + "超时，请检查网络后重试") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(label + "失败（退出码 " + str(exc.returncode) + "）") from exc


def install_runtime() -> Path:
    python = runtime_python()
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    if not python.exists():
        emit_progress("environment", "正在创建 rembg 隔离运行环境", 8)
        run_checked([sys.executable, "-m", "venv", str(RUNTIME_ROOT)], "创建 rembg 虚拟环境")
    emit_progress("environment", "正在安装 rembg 本地依赖", 18)
    run_checked(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--prefer-binary",
            "--timeout",
            "120",
            "rembg[cpu]==" + REMBG_VERSION,
        ],
        "安装 rembg 本地运行环境",
    )
    MARKER.write_text(REMBG_VERSION + "\n", encoding="utf-8")
    emit_progress("environment", "rembg 运行环境准备完成", 45)
    return python


def ensure_runtime() -> None:
    """当前解释器已有 rembg 时直接使用，否则切换到隔离 venv。"""
    if importlib.util.find_spec("rembg") is not None:
        emit_progress("environment", "已检测到 rembg 运行环境", 45)
        return
    python = runtime_python()
    venv_ready = False
    if MARKER.exists() and python.exists():
        # 这里只检查模块是否可发现，不直接 import rembg。rembg 会连带加载
        # numpy/scipy/onnxruntime，首次冷启动可能接近 30 秒，旧探测会误超时。
        probe = subprocess.run(
            [str(python), "-c", "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('rembg') else 1)"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=20,
        )
        venv_ready = probe.returncode == 0
    if not venv_ready:
        python = install_runtime()
    else:
        emit_progress("environment", "已复用本地 rembg 运行环境", 45)
    # DSH 在 Windows 上通过受限子进程启动脚本，os.execv 可能抛出
    # [Errno 22] Invalid argument。直接把 venv 的 site-packages 加入当前
    # 进程，既保持隔离依赖，又不会让前端进度卡在环境准备阶段。
    activate_runtime(python)


class ModelDownloadProgress:
    """把 pooch 下载器的字节回调转成前端可显示的模型下载进度。"""

    def __init__(self) -> None:
        self.total = 0
        self.downloaded = 0
        self.last_reported = -1
        self.last_report_at = 0.0

    def update(self, amount: int) -> None:
        self.downloaded += max(0, int(amount or 0))
        if not self.total:
            return
        # 环境准备占 0-45%，模型下载占 55-85%，模型加载/推理随后进入 88%。
        ratio = min(1.0, self.downloaded / max(1, int(self.total)))
        percent = min(84, 55 + int(ratio * 29))
        now = time.monotonic()
        if percent == self.last_reported or (now - self.last_report_at < 0.2 and percent < 84):
            return
        self.last_reported = percent
        self.last_report_at = now
        emit_progress("model", "正在下载 isnet-general-use 模型（" + str(percent) + "%）", percent)

    def reset(self) -> None:
        # pooch 下载完成后会调用 reset，再 update(total)；不要让进度回退。
        return

    def close(self) -> None:
        emit_progress("model", "模型下载完成，正在加载 isnet-general-use", 85)


def new_session_with_progress(new_session, model: str):
    """临时接管 pooch.retrieve 的进度条，完成后恢复原函数。"""
    import pooch

    original_retrieve = pooch.retrieve

    def retrieve(*args, **kwargs):
        if kwargs.get("progressbar") is True:
            kwargs["progressbar"] = ModelDownloadProgress()
        return original_retrieve(*args, **kwargs)

    pooch.retrieve = retrieve
    try:
        return new_session(model)
    finally:
        pooch.retrieve = original_retrieve


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", default="isnet-general-use")
    parser.add_argument("--progress-file", type=Path, default=None)
    args = parser.parse_args()
    global PROGRESS_PATH
    PROGRESS_PATH = args.progress_file
    emit_progress("environment", "正在准备本地 rembg 环境", 3)
    if args.model != "isnet-general-use":
        raise RuntimeError("仅支持 isnet-general-use 模型")
    if not args.input.exists():
        raise RuntimeError("输入图片不存在：" + str(args.input))

    # 同时设置新旧版本变量：2.0.61 使用 U2NET_HOME，新版 rembg 优先
    # REMBG_HOME。两者指向同一目录，确保模型只下载一份。
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("REMBG_HOME", str(MODEL_ROOT))
    os.environ.setdefault("U2NET_HOME", str(MODEL_ROOT))
    os.environ.setdefault("OMP_NUM_THREADS", "2")
    ensure_runtime()

    from PIL import Image
    from rembg import new_session, remove

    args.output.parent.mkdir(parents=True, exist_ok=True)
    emit_progress("model", "正在下载/加载 isnet-general-use 模型（首次使用可能需要一些时间）", None)
    session = new_session_with_progress(new_session, args.model)
    emit_progress("processing", "模型已就绪，正在移除背景", 88)
    with Image.open(args.input) as image:
        original_size = image.size
        # isnet-general-use 已提供软 alpha；保留 alpha matting 关闭时的
        # 原始边缘，避免产品边缘被过度侵蚀。
        result = remove(image.convert("RGBA"), session=session)
        # 某些 rembg/onnxruntime 组合会按模型步长返回略不同的尺寸；
        # 背景移除是透明度处理，不应改变画布几何比例。
        if result.size != original_size:
            result = result.resize(original_size, Image.Resampling.LANCZOS)
        result.save(args.output, format="PNG", optimize=True)
    emit_progress("complete", "去背景完成", 100)
    print('{"success":true,"model":"isnet-general-use","image":"' + str(args.output).replace('\\', '\\\\').replace('"', '\\"') + '"}')
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        emit_progress("error", str(exc), None)
        print('{"success":false,"error":"' + str(exc).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"}')
        raise SystemExit(1)

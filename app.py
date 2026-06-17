"""
Web UI backend for batch removal of the "张张实拍图" watermark.

Run with:
    python app.py

Then open http://127.0.0.1:5000 in a browser.
"""

import json
import os
import queue
import threading
import uuid
from datetime import datetime
from typing import Dict, Any, List
from multiprocessing import Process, Queue as MPQueue

from flask import Flask, render_template, request, jsonify, send_file

from remove_watermark import (
    SUPPORTED_EXTS,
    find_watermark_box,
    WATERMARK_TEXT,
)

app = Flask(__name__)

# Directories used by the web UI (separate from the CLI batch script).
UPLOAD_DIR = "web_uploads"
PROCESSED_DIR = "web_processed"
JOBS_FILE = "web_jobs.json"

# In-memory job store. Jobs move through: pending -> processing -> done/error/skipped.
jobs: Dict[str, Dict[str, Any]] = {}

# Queues for communicating with the worker process.
input_queue: MPQueue = MPQueue()
result_queue: MPQueue = MPQueue()

# Worker process handle.
worker_process: Process = None


def ensure_dirs():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(PROCESSED_DIR, exist_ok=True)


def load_jobs():
    """Load persisted job records from disk."""
    global jobs
    if not os.path.exists(JOBS_FILE):
        jobs = {}
        return
    try:
        with open(JOBS_FILE, "r", encoding="utf-8") as f:
            jobs = json.load(f)
        # Remove stale records for files that no longer exist.
        stale = [
            jid for jid, job in jobs.items()
            if job.get("status") == "done" and not os.path.exists(job.get("output_path", ""))
        ]
        for jid in stale:
            jobs.pop(jid, None)
        if stale:
            save_jobs()
        print(f"[Server] Loaded {len(jobs)} job record(s).")
    except Exception as exc:
        print(f"[Server] Failed to load job records: {exc}")
        jobs = {}


def save_jobs():
    """Persist job records to disk."""
    try:
        tmp_file = JOBS_FILE + ".tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(jobs, f, ensure_ascii=False, indent=2)
        os.replace(tmp_file, JOBS_FILE)
    except Exception as exc:
        print(f"[Server] Failed to save job records: {exc}")


def worker_main(input_q: MPQueue, result_q: MPQueue):
    """
    Worker process entry point.
    Loads models in this process's main thread and processes jobs sequentially.
    """
    from PIL import Image, ImageDraw
    from rapidocr_onnxruntime import RapidOCR
    from simple_lama_inpainting import SimpleLama

    print("[Worker] Loading OCR and inpainting models...")
    ocr_engine = RapidOCR()
    lama_engine = SimpleLama()
    print("[Worker] Models loaded.")

    while True:
        try:
            job = input_q.get(timeout=0.5)
        except queue.Empty:
            continue

        if job is None:
            break

        job_id = job["id"]
        input_path = job["input_path"]
        output_path = job["output_path"]

        result = {
            "id": job_id,
            "status": "processing",
            "updated_at": datetime.now().isoformat(),
            "message": None,
            "filename": None,
        }
        result_q.put(result)

        try:
            ocr_result, _ = ocr_engine(input_path)
            box = find_watermark_box(ocr_result)

            if box is None:
                result.update({
                    "status": "skipped",
                    "message": "未检测到“张张实拍图”水印",
                })
            else:
                img = Image.open(input_path).convert("RGB")
                mask = Image.new("L", img.size, 0)
                draw = ImageDraw.Draw(mask)
                draw.rectangle(box, fill=255)

                inpainted = lama_engine(img, mask)
                inpainted.save(output_path, quality=95)

                result.update({
                    "status": "done",
                    "output_path": output_path,
                    "filename": os.path.basename(output_path),
                })
        except Exception as exc:
            result.update({
                "status": "error",
                "message": str(exc),
            })

        result["updated_at"] = datetime.now().isoformat()
        result_q.put(result)


def result_listener():
    """Background thread in the main process that receives results from the worker."""
    while True:
        try:
            result = result_queue.get(timeout=0.5)
        except queue.Empty:
            continue

        if result is None:
            break

        job_id = result["id"]
        if job_id in jobs:
            jobs[job_id].update(result)
            save_jobs()


def start_worker():
    global worker_process
    worker_process = Process(target=worker_main, args=(input_queue, result_queue), daemon=True)
    worker_process.start()

    listener_thread = threading.Thread(target=result_listener, daemon=True)
    listener_thread.start()


def allowed_file(filename: str) -> bool:
    return "." in filename and os.path.splitext(filename.lower())[1] in SUPPORTED_EXTS


def job_to_dict(job: Dict[str, Any]) -> Dict[str, Any]:
    """Return a job dict safe for JSON serialization to the frontend."""
    return {
        "id": job.get("id", ""),
        "order_id": job.get("order_id", job.get("id", "")), # fallback to job id for old jobs
        "status": job.get("status", "unknown"),
        "original_name": job.get("original_name", ""),
        "filename": job.get("filename"),
        "message": job.get("message"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/jobs")
def list_jobs():
    """Return all jobs grouped into orders, sorted by created_at descending."""
    all_jobs = [job_to_dict(job) for job in jobs.values()]
    all_jobs.sort(key=lambda j: j.get("created_at") or "", reverse=True)
    
    orders_map = {}
    for job in all_jobs:
        oid = job["order_id"]
        if oid not in orders_map:
            orders_map[oid] = {
                "order_id": oid,
                "created_at": job["created_at"], # Use the latest job's created_at for order
                "jobs": []
            }
        orders_map[oid]["jobs"].append(job)
        
    orders_list = list(orders_map.values())
    orders_list.sort(key=lambda o: o.get("created_at") or "", reverse=True)
    
    return jsonify({"orders": orders_list, "jobs": all_jobs}) # keep flat jobs for backward compat in active view


@app.route("/api/upload", methods=["POST"])
def upload():
    """Accept multiple image uploads and enqueue processing jobs."""
    files = request.files.getlist("images")
    if not files:
        return jsonify({"error": "没有上传文件"}), 400

    ensure_dirs()
    created_jobs = []
    now = datetime.now()
    order_id = str(uuid.uuid4())
    
    for file in files:
        if not file or not file.filename:
            continue
        if not allowed_file(file.filename):
            continue

        job_id = str(uuid.uuid4())
        ext = os.path.splitext(file.filename.lower())[1]
        timestamp = now.strftime("%Y%m%d_%H%M%S")
        safe_name = f"{timestamp}_{job_id[:8]}{ext}"
        input_path = os.path.join(UPLOAD_DIR, safe_name)
        output_path = os.path.join(PROCESSED_DIR, f"processed_{safe_name}")

        file.save(input_path)

        jobs[job_id] = {
            "id": job_id,
            "order_id": order_id,
            "status": "pending",
            "original_name": file.filename,
            "input_path": input_path,
            "output_path": output_path,
            "filename": None,
            "message": None,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }
        input_queue.put({
            "id": job_id,
            "input_path": input_path,
            "output_path": output_path,
        })
        created_jobs.append(job_id)

    if not created_jobs:
        return jsonify({"error": "没有有效的图片文件（支持 jpg/png/bmp/webp）"}), 400

    save_jobs()
    return jsonify({"order_id": order_id, "jobs": [job_to_dict(jobs[jid]) for jid in created_jobs]}), 202


@app.route("/api/status/<job_id>")
def status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify(job_to_dict(job))


@app.route("/api/preview/<job_id>")
def preview(job_id: str):
    job = jobs.get(job_id)
    if not job or job.get("status") != "done":
        return jsonify({"error": "结果不可用"}), 404
    if not os.path.exists(job["output_path"]):
        return jsonify({"error": "结果文件已丢失，请重新处理"}), 404
    return send_file(job["output_path"], mimetype="image/jpeg")


@app.route("/api/download/<job_id>")
def download(job_id: str):
    job = jobs.get(job_id)
    if not job or job.get("status") != "done":
        return jsonify({"error": "结果不可用"}), 404
    if not os.path.exists(job["output_path"]):
        return jsonify({"error": "结果文件已丢失，请重新处理"}), 404
    return send_file(
        job["output_path"],
        as_attachment=True,
        download_name=f"removed_{job['original_name']}",
    )


if __name__ == "__main__":
    ensure_dirs()
    load_jobs()
    start_worker()
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)

"""
Batch watermark remover for "张张实拍图".

Usage:
    python remove_watermark.py

Place source images in `input_images/`; results are written to `output_images/`.
Other watermarks (price tags, labels, etc.) are preserved.
"""

import os
import re
from typing import List, Tuple, Optional

from PIL import Image, ImageDraw
from rapidocr_onnxruntime import RapidOCR
from simple_lama_inpainting import SimpleLama

INPUT_DIR = "input_images"
OUTPUT_DIR = "output_images"

# Supported image extensions.
SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

# The watermark text to remove.
WATERMARK_TEXT = "张张实拍图"

# Minimum similarity (0-1) for fuzzy matching. The OCR engine is very accurate
# for this watermark, so we keep the threshold high.
MIN_SIMILARITY = 0.75


def text_similarity(a: str, b: str) -> float:
    """Simple character-overlap similarity for CJK strings."""
    if not a or not b:
        return 0.0
    set_a = set(a)
    set_b = set(b)
    inter = len(set_a & set_b)
    union = len(set_a | set_b)
    return inter / union if union else 0.0


def find_watermark_box(
    ocr_result,
    target: str = WATERMARK_TEXT,
    min_sim: float = MIN_SIMILARITY,
    margin: float = 0.05,
) -> Optional[Tuple[int, int, int, int]]:
    """
    Find the bounding box of the watermark text from OCR output.

    Returns a (x1, y1, x2, y2) tuple expanded by `margin` ratio, or None if
    the watermark cannot be confidently detected.
    """
    if not ocr_result:
        return None

    best_box = None
    best_sim = 0.0

    for item in ocr_result:
        box, text, score = item
        # Clean the recognized text: keep CJK characters and digits.
        cleaned = re.sub(r"[^一-鿿0-9]", "", text or "")
        sim = text_similarity(cleaned, target)
        if sim > best_sim:
            best_sim = sim
            best_box = box

    if best_sim < min_sim:
        return None

    # Convert quad box to axis-aligned bbox.
    xs = [p[0] for p in best_box]
    ys = [p[1] for p in best_box]
    x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)

    # Expand the box slightly so the mask covers halos/shadows.
    w = x2 - x1
    h = y2 - y1
    x1 = int(max(0, x1 - w * margin))
    y1 = int(max(0, y1 - h * margin))
    x2 = int(x2 + w * margin)
    y2 = int(y2 + h * margin)

    return x1, y1, x2, y2


def process_image(input_path: str, output_path: str, lama: SimpleLama, ocr: RapidOCR) -> bool:
    """
    Remove the "张张实拍图" watermark from a single image.
    Returns True on success, False if the watermark was not found.
    """
    ocr_result, _ = ocr(input_path)
    box = find_watermark_box(ocr_result)

    if box is None:
        print(f"  [WARN] Skipped (watermark not detected): {input_path}")
        return False

    img = Image.open(input_path).convert("RGB")
    mask = Image.new("L", img.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle(box, fill=255)

    result = lama(img, mask)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    result.save(output_path, quality=95)
    print(f"  [OK] Saved: {output_path}")
    return True


def get_image_files(directory: str) -> List[str]:
    """Return sorted list of image file paths in the directory."""
    files = []
    for f in os.listdir(directory):
        if os.path.splitext(f.lower())[1] in SUPPORTED_EXTS:
            files.append(os.path.join(directory, f))
    return sorted(files)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    image_files = get_image_files(INPUT_DIR)

    if not image_files:
        print(f"No images found in {INPUT_DIR}")
        return

    print(f"Found {len(image_files)} image(s). Loading OCR and inpainting models...")
    ocr = RapidOCR()
    lama = SimpleLama()

    processed = 0
    for input_path in image_files:
        output_path = os.path.join(OUTPUT_DIR, os.path.basename(input_path))
        if process_image(input_path, output_path, lama, ocr):
            processed += 1

    print(f"\nDone. Processed {processed}/{len(image_files)} image(s).")
    print(f"Results are in: {os.path.abspath(OUTPUT_DIR)}")


if __name__ == "__main__":
    main()

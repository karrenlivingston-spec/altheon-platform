"""Extract text from uploaded diagnostic documents (PDF / images)."""

from __future__ import annotations

import io
import traceback
from typing import Optional

ALLOWED_MIME = frozenset(
    {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/heic",
        "image/heif",
        "image/webp",
    }
)

MAX_BYTES = 20 * 1024 * 1024


def extract_text_from_bytes(data: bytes, mime_type: str, file_name: str) -> str:
    mime = (mime_type or "").split(";")[0].strip().lower()
    if mime not in ALLOWED_MIME:
        ext = (file_name or "").rsplit(".", 1)[-1].lower()
        if ext == "pdf":
            mime = "application/pdf"
        elif ext in ("jpg", "jpeg"):
            mime = "image/jpeg"
        elif ext == "png":
            mime = "image/png"
        elif ext in ("heic", "heif"):
            mime = "image/heic"
        elif ext == "webp":
            mime = "image/webp"

    if mime == "application/pdf":
        return _pdf_text(data)
    if mime.startswith("image/"):
        return _image_ocr(data, mime)
    return ""


def _pdf_text(data: bytes) -> str:
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=data, filetype="pdf")
        parts: list[str] = []
        for page in doc:
            parts.append(page.get_text("text"))
        doc.close()
        return "\n".join(p for p in parts if p.strip()).strip()
    except Exception:
        traceback.print_exc()
        return ""


def _image_ocr(data: bytes, mime: str) -> str:
    try:
        from PIL import Image

        try:
            import pillow_heif  # type: ignore

            pillow_heif.register_heif_opener()
        except Exception:
            pass

        img = Image.open(io.BytesIO(data))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        try:
            import pytesseract

            return (pytesseract.image_to_string(img) or "").strip()
        except Exception:
            traceback.print_exc()
            return ""
    except Exception:
        traceback.print_exc()
        return ""

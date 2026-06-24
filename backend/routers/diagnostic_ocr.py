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
        text = "\n".join(p for p in parts if p.strip()).strip()
        doc.close()

        if text:
            return text

        # Scanned PDF — rasterize pages and extract via Claude vision
        return _pdf_ocr_via_claude(data)
    except Exception:
        traceback.print_exc()
        return ""


def _pdf_ocr_via_claude(data: bytes) -> str:
    """Rasterize each PDF page and send to Claude Haiku for OCR extraction."""
    try:
        import base64
        import fitz
        import anthropic

        doc = fitz.open(stream=data, filetype="pdf")
        content: list[dict] = []

        for page_num, page in enumerate(doc):
            mat = fitz.Matrix(2.0, 2.0)  # 2x scale for legibility
            pix = page.get_pixmap(matrix=mat)
            img_bytes = pix.tobytes("png")
            b64 = base64.standard_b64encode(img_bytes).decode()
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": b64,
                },
            })
            content.append({
                "type": "text",
                "text": f"Page {page_num + 1}: Please extract all text from this page exactly as it appears.",
            })

        doc.close()

        if not content:
            return ""

        content.append({
            "type": "text",
            "text": "Extract all text from the above pages. Return only the extracted text, preserving structure and layout as much as possible. Do not summarize or interpret — just extract.",
        })

        client = anthropic.Anthropic()
        response = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=4096,
            messages=[{"role": "user", "content": content}],
        )
        return response.content[0].text.strip() if response.content else ""
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

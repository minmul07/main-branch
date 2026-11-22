"""이미지로만 된 PDF 페이지를 렌더링해 Tesseract로 글자를 인식한다 (#31)."""

import os
import shutil
import subprocess
from io import BytesIO

import pypdfium2

from backend.app.services.text_extraction import normalize_extracted_text

# 인식 언어. Tesseract 형식(`kor+eng`)으로 지정하며 필요한 언어 데이터가 모두 설치되어 있어야 한다.
OCR_LANGUAGES = os.environ.get("OCR_LANGUAGES", "kor+eng")
# 300 DPI는 Tesseract 권장 해상도다. A4 한 장이 회색조 약 2480x3508 픽셀(약 9MB)로 렌더링된다.
OCR_RENDER_DPI = 300
# 한 페이지 인식이 이 시간을 넘으면 실패로 처리한다.
OCR_PAGE_TIMEOUT_SECONDS = 120


class OcrError(Exception):
    """OCR을 완료하지 못한 경우의 기본 예외."""


class OcrUnavailableError(OcrError):
    """tesseract 실행 파일이나 필요한 언어 데이터를 찾을 수 없는 경우."""


class OcrFailedError(OcrError):
    """페이지 렌더링이나 글자 인식 도중 실패한 경우."""


def recognize_pages(source: BytesIO, page_numbers: list[int]) -> dict[int, str]:
    """1부터 시작하는 물리 페이지 번호별 OCR 텍스트를 반환한다.

    글자를 찾지 못한 페이지는 빈 문자열이다. 페이지가 없으면 Tesseract를 확인하지 않는다.
    """
    if not page_numbers:
        return {}
    command = _find_tesseract()
    try:
        pdf = pypdfium2.PdfDocument(source.getvalue())
    except Exception as error:
        raise OcrFailedError("PDF could not be opened for OCR") from error
    try:
        return {
            page_number: _recognize_image(command, _render_page_png(pdf, page_number))
            for page_number in page_numbers
        }
    finally:
        pdf.close()


def _find_tesseract() -> str:
    command = shutil.which("tesseract")
    if command is None:
        raise OcrUnavailableError("tesseract executable not found")
    try:
        result = subprocess.run(
            [command, "--list-langs"], capture_output=True, text=True, timeout=30, check=True
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise OcrUnavailableError("tesseract could not list languages") from error
    # 첫 줄은 언어 데이터 경로 안내이고 이후 한 줄에 언어 하나씩 나온다.
    installed = {line.strip() for line in result.stdout.splitlines()[1:]}
    missing = [language for language in OCR_LANGUAGES.split("+") if language not in installed]
    if missing:
        raise OcrUnavailableError(f"tesseract language data not installed: {', '.join(missing)}")
    return command


def _render_page_png(pdf: pypdfium2.PdfDocument, page_number: int) -> bytes:
    try:
        page = pdf[page_number - 1]
        try:
            bitmap = page.render(scale=OCR_RENDER_DPI / 72, grayscale=True)
            image = bitmap.to_pil()
        finally:
            page.close()
        output = BytesIO()
        image.save(output, format="PNG")
        return output.getvalue()
    except Exception as error:
        raise OcrFailedError(f"page {page_number} could not be rendered") from error


def _recognize_image(command: str, png: bytes) -> str:
    try:
        result = subprocess.run(
            [command, "stdin", "stdout", "-l", OCR_LANGUAGES],
            input=png,
            capture_output=True,
            timeout=OCR_PAGE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise OcrFailedError("tesseract did not finish") from error
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        raise OcrFailedError(f"tesseract exited with {result.returncode}: {stderr}")
    # Tesseract는 페이지 끝에 폼 피드(\x0c)를 붙인다.
    text = result.stdout.decode("utf-8", errors="replace").replace("\x0c", "").strip()
    return normalize_extracted_text(text)

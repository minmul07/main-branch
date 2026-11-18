"""테스트용 PDF 바이트 생성 도우미. 외부 파일 없이 필요한 형태의 PDF를 만든다."""

from io import BytesIO

from pypdf import PdfWriter


def build_pdf(objects: list[bytes]) -> bytes:
    """1번 객체를 Catalog로 하는 PDF를 올바른 xref와 함께 만든다."""
    output = BytesIO()
    output.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(output.tell())
        output.write(b"%d 0 obj\n" % number + body + b"\nendobj\n")
    xref_offset = output.tell()
    output.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    for offset in offsets:
        output.write(b"%010d 00000 n \n" % offset)
    output.write(
        b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objects) + 1, xref_offset)
    )
    return output.getvalue()


def stream_object(dictionary: bytes, data: bytes) -> bytes:
    return b"<< " + dictionary + b" /Length %d >>\nstream\n" % len(data) + data + b"\nendstream"


def text_pdf(text: str = "Operating Systems") -> bytes:
    content = b"BT /F1 24 Tf 72 720 Td (" + text.encode("ascii") + b") Tj ET"
    return build_pdf(
        [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
            stream_object(b"", content),
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        ]
    )


def scanned_pdf() -> bytes:
    """텍스트 없이 이미지 한 장만 그리는 스캔 형태의 PDF."""
    content = b"q 612 0 0 792 0 0 cm /Im1 Do Q"
    return build_pdf(
        [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
            stream_object(b"", content),
            stream_object(
                b"/Type /XObject /Subtype /Image /Width 2 /Height 2 "
                b"/ColorSpace /DeviceGray /BitsPerComponent 8",
                bytes([0, 255, 255, 0]),
            ),
        ]
    )


def _escape_pdf_literal(text: str) -> bytes:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return escaped.encode("ascii")


def multi_page_pdf(pages: list[str | None]) -> bytes:
    """텍스트(str)·빈 문자열("")·스캔 이미지(None) 페이지를 조합한 다중 페이지 PDF."""
    objects: list[bytes] = [
        b"",  # 1: Catalog (목록 구성 후 채움)
        b"",  # 2: Pages
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",  # 3: Font
        stream_object(  # 4: Image XObject
            b"/Type /XObject /Subtype /Image /Width 2 /Height 2 "
            b"/ColorSpace /DeviceGray /BitsPerComponent 8",
            bytes([0, 255, 255, 0]),
        ),
    ]
    kid_refs: list[bytes] = []
    for spec in pages:
        page_obj_num = len(objects) + 1
        content_obj_num = page_obj_num + 1
        kid_refs.append(b"%d 0 R" % page_obj_num)
        if spec is None:
            resources = b"<< /XObject << /Im1 4 0 R >> >>"
            content = b"q 612 0 0 792 0 0 cm /Im1 Do Q"
        else:
            resources = b"<< /Font << /F1 3 0 R >> >>"
            content = (
                b"BT /F1 24 Tf 72 720 Td (" + _escape_pdf_literal(spec) + b") Tj ET"
                if spec != ""
                else b""
            )
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources " + resources + b" /Contents %d 0 R >>" % content_obj_num
        )
        objects.append(stream_object(b"", content))

    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[1] = b"<< /Type /Pages /Kids [" + b" ".join(kid_refs) + b"] /Count %d >>" % len(pages)
    return build_pdf(objects)


def blank_pdf(page_count: int = 1) -> bytes:
    writer = PdfWriter()
    for _ in range(page_count):
        writer.add_blank_page(width=612, height=792)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def encrypted_pdf(password: str = "secret") -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.encrypt(password)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()

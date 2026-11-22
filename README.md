# 강의자료 기반 학습 플랫폼

여러 PDF로 흩어진 강의자료를 과목·주차별로 정리하고, 페이지 단위 원문 검색 → 원문 확인 → 메모·학습 기록을 하나의 흐름으로 연결하는 로컬 웹 학습 플랫폼.

## 팀원

오픈소스소프트웨어

- 2023203068 어승경, 팀장
- 2025403073 한예승
- 2023203092 주승현
- 2025403017 강서영

## 개발 환경

Docker Engine 또는 Docker Desktop과 Docker Compose가 실행 중이면, fresh clone 후 저장소 루트에서 다음 명령 하나로 개발 서버를 실행할 수 있습니다. 호스트에 Python·Node를 설치하거나 `.env`를 복사할 필요가 없습니다.

```sh
docker compose up --build
```

- 프론트엔드: `http://127.0.0.1:5173`
- 백엔드 상태 확인: `http://127.0.0.1:8000/health`
- 종료: `Ctrl+C`, 컨테이너 정리: `docker compose down` (DB 유지)

포트·볼륨·환경변수와 재빌드 방법은 [Docker 개발 환경 문서](docs/DOCKER.md)를 참고합니다.

### Docker 없이 실행

- Python 3.14와 [uv](https://docs.astral.sh/uv/)로 FastAPI·SQLAlchemy 의존성을 관리합니다.
- SQLite는 Python 표준 라이브러리의 `sqlite3`을 사용하며, 검색용 FTS5도 사용할 수 있습니다.
- Docker 없이 PDF OCR 기능을 로컬에서 실행하려면 [Tesseract OCR](https://github.com/tesseract-ocr/tesseract)과 영어·한국어 언어 데이터(`eng`, `kor`)를 시스템에 설치하고 `tesseract` 명령이 `PATH`에서 실행 가능해야 합니다.
- React·Vite·TypeScript 프론트엔드는 `frontend/`에서 npm으로 관리합니다.
- 프론트엔드는 Node 22.22.2 이상을 사용하며, `.nvmrc`는 Node 22 최신 패치를 선택합니다. 환경변수와 테스트 안내는 [프론트엔드 문서](docs/FRONTEND.md)를 참고합니다.

```sh
uv sync
cd frontend
npm ci
npm run dev
```

백엔드는 저장소 루트에서 실행합니다.

```sh
uv run uvicorn backend.app.main:app --reload
```

- 상태 확인: `GET http://127.0.0.1:8000/health` → `{"status":"ok"}`
- API 문서: `http://127.0.0.1:8000/docs`
- SQLite 파일: `backend/app.db` (최초 DB 연결 시 생성되며 Git에서 제외됩니다.)
- 테이블 준비: 처음 실행하거나 모델이 추가된 뒤 `uv run python -m backend.app.init_db` (기존 데이터 유지)
- 업로드한 PDF 원본: `backend/uploads/` (Git에서 제외됩니다.)

백엔드 테스트는 `uv run pytest`로 실행합니다. 검증 기준은 [테스트 문서](docs/TESTING.md)를 참고합니다.

## License

This project is licensed under the [MIT License](LICENSE).

### Third-Party Licenses (OCR Dependencies)

PDF OCR 수행을 위해 사용하는 외부/런타임 의존성과 라이선스는 다음과 같습니다. 모두 MIT 라이선스와 호환되는 허용적(permissive) 오픈소스 라이선스이며(AGPL `PyMuPDF`, GPL `poppler-utils`/`pdf2image` 미사용), 저장소 소스에는 직접 포함하지 않고 빌드·설치 시 내려받습니다.

- **Tesseract OCR** (`tesseract-ocr`, `libtesseract5`): **Apache-2.0** ([tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract), Copyright 1988-1995 Hewlett Packard Company; 2006-2019 Google Inc.). 런타임 이미지 처리 라이브러리 **Leptonica**(`liblept5`)는 **BSD-2-Clause** (Copyright (C) 2001 Leptonica)입니다.
- **Tesseract Language Data** (`tesseract-ocr-eng`, `tesseract-ocr-kor`, `tesseract-ocr-osd` / `tessdata_fast`): **Apache-2.0** ([tesseract-ocr/tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast), Copyright 1988-1995 Hewlett Packard Company; 2006-2022 Google Inc.).
- **pypdfium2 & PDFium** (`pypdfium2`): `pypdfium2`는 **Apache-2.0 OR BSD-3-Clause**([pypdfium2-team/pypdfium2](https://github.com/pypdfium2-team/pypdfium2), 문서·예제는 **CC-BY-4.0**), 번들된 `PDFium`은 **BSD-3-Clause** (Copyright 2014 The PDFium Authors) 및 **Apache-2.0**, `pdfium-binaries`는 **MIT** (Copyright 2014-2026 Benoit Blanchon)입니다. 바이너리 wheel에 포함된 전체 서드파티 라이선스 고지는 설치된 패키지의 `pypdfium2-*.dist-info/licenses/` (`LICENSES/`, `BUILD_LICENSES/`)에서 확인할 수 있습니다.
- **Pillow** (`pillow`): **MIT-CMU** ([python-pillow/Pillow](https://github.com/python-pillow/Pillow)).
  - Copyright © 1997-2011 by Secret Labs AB
  - Copyright © 1995-2011 by Fredrik Lundh and contributors
  - Copyright © 2010 by Jeffrey 'Alex' Clark and contributors
  - 사전 서면 허가 없이 Secret Labs AB 또는 저자의 이름을 소프트웨어 배포와 관련된 광고나 홍보에 사용할 수 없습니다.
  - PyPI 바이너리 wheel에는 GPL `libimagequant`가 포함되지 않으며, 번들된 코덱·폰트 라이브러리(`FreeType` `FTL`, `libjpeg-turbo` `IJG`/`BSD-3-Clause`, `Little CMS 2`, `HarfBuzz`, `libpng`, `libwebp`, `OpenJPEG`, `libtiff`, `libavif`, `brotli`, `xz` `0BSD`, `zlib` 등)의 상세 라이선스와 고지는 `pillow-*.dist-info/licenses/LICENSE`에 포함되어 있습니다.

> 빌드된 Docker 이미지나 Python 가상환경을 재배포하는 경우, 설치된 wheel의 `dist-info/licenses/`(예: FreeType 및 Independent JPEG Group 저작 기반 고지 포함)와 Debian 패키지의 `/usr/share/doc/*/copyright`에 포함된 업스트림 저작권 및 라이선스 고지를 함께 유지해야 합니다.

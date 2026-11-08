# 아키텍처 초안

## 목적과 범위

[Notion의 제품 정의](https://app.notion.com/p/3e9c6339ee0f818d83cbf3f662fbdd72)와 [PROJECT.md](PROJECT.md)를 바탕으로 P0 구현의 큰 구조와 담당 경계를 정리한다. 팀 협의를 위한 초안이며, 상세 필드·스키마·처리 방식은 담당자가 설계한 뒤 함께 확정한다.

핵심 흐름은 **과목·주차별 PDF 등록 → 텍스트 추출/OCR → 페이지 단위 검색 → 원문 페이지 확인 → 메모 작성**이다. 한 사람이 자기 컴퓨터에서 브라우저로 사용하는 로컬 웹 앱을 기준으로 한다. OCR과 실패 재시도는 P0 범위에 포함한다.

현재 저장소에는 React 기본 화면, FastAPI 기본 서버와 SQLite 연결, Subject 모델·Repository와 Subject 생성·목록 API, Document 모델·Repository·업로드 서비스와 `/documents` API가 있다. 그 밖의 업무 기능은 구현 전이다. API 계약은 [API.md](API.md), 실행 환경과 검증 기준은 [DOCKER.md](DOCKER.md)와 [TESTING.md](TESTING.md)를 참고한다.

## 기본 구조

```text
React
  ↓ REST API
FastAPI
  ├─ PDF Service
  │    └─ pdfplumber/pypdf → 필요한 페이지 OCR (Tesseract)
  ├─ Subject/Note Service
  │    └─ 과목·메모 관리
  ├─ Search Service
  │    └─ SQLite FTS5
  └─ Repository
       └─ SQLite (SQLAlchemy)
```

원본 PDF는 로컬 파일로 보관하고, 과목·자료 정보와 페이지 텍스트·메모는 SQLite에 저장한다. 프론트엔드는 REST API를 통해 데이터를 이용하고 PDF.js로 원문을 표시한다.

| 구성 요소 | 책임 |
| --- | --- |
| React | 과목·자료 목록, 검색, 원문 열람, 메모 편집, 처리 상태 표시 |
| FastAPI | 요청·응답과 입력 검증, 서비스 연결 |
| PDF Service | PDF 등록·조회·삭제, 페이지 텍스트 추출, OCR과 처리 상태 관리 |
| Subject/Note Service | 과목 관리와 페이지별 메모 CRUD |
| Search Service | 페이지 텍스트 색인과 검색 결과 생성 |
| Repository | 서비스에서 사용하는 SQLite 데이터 접근 |

PDF 처리 라이브러리는 pypdf를 사용한다. 업로드 단계에 필요한 PDF 구조 검증, 암호화 여부, 페이지 수 확인을 지원하고 페이지 텍스트 추출도 제공한다. 순수 Python 패키지라 Docker 이미지에 시스템 라이브러리를 추가하지 않아도 된다. pdfplumber는 pdfminer.six 기반으로 표·좌표 분석에 강하지만 현재 범위에는 필요하지 않아 함께 추가하지 않는다. 오래 걸리는 PDF/OCR 처리의 실행 방식과 저장 경로는 PDF/backend 담당자가 상세 설계한다.

## 담당 역할과 협업 경계

| 담당 영역 | 담당자 | 협업 경계 |
| --- | --- | --- |
| frontend | 한예승 | API 계약을 기준으로 화면과 PDF·메모 흐름 연결 |
| PDF/backend | 주승현 | PDF 처리와 백엔드 기반, 데이터 모델 상세 설계 |
| Subject/Note | 강서영 | 과목·메모 기능 구현, PDF 담당자와 모델 연결 협의 |
| Search/integr. | 어승경 | FTS5 검색과 전체 흐름 통합, PDF 담당자와 색인 연결 협의 |

공통 모델과 API 계약을 변경할 때는 영향을 받는 담당자와 먼저 맞춘다. 검색 결과에서 원문 페이지와 메모로 이어지는 식별자는 frontend·PDF·Search·Note 담당자가 함께 확인한다.

## 최소 데이터 관계

```text
Subject
  └─ Document
       └─ Page
            └─ Note
```

- `Document`는 어느 `Subject`에 속하는지와 몇 주차 자료인지 기록한다. 이 초안에서는 주차를 Document의 정보로 표현한다.
- `Page`는 어느 Document의 페이지인지, `page_number`와 추출한 `text`를 가진다.
- `Note`는 특정 Page에 연결한다.
- 페이지 번호는 1부터 시작하는 원본 PDF의 물리 페이지 순서를 기준으로 한다.

별도 Week 모델의 필요성, ID 타입, 나머지 필드와 제약, 페이지별 메모 개수, 삭제 정책은 상세 설계에서 협의한다. 작업 이력이나 P1·P2 모델은 이 초안에서 확정하지 않는다.

## 구현된 Subject 데이터 계층

| 위치 | 책임 |
| --- | --- |
| `backend/app/models/subject.py` | `Subject` 모델. `subjects` 테이블에 정수 자동 생성 PK `id`와 `String(100)`, `nullable=False`인 `name`을 둔다. 과목명 중복을 허용한다. |
| `backend/app/repositories/subject.py` | `create_subject(session, name) -> Subject`는 검증된 이름으로 생성하고 `flush`로 ID를 확보한 객체를 반환한다. commit하지 않는다. `list_subjects(session) -> list[Subject]`는 ID 오름차순으로 반환하고 데이터가 없으면 `[]`를 반환한다. |
| `backend/app/init_db.py` | 모델을 등록한 뒤 `Base.metadata.create_all`로 테이블을 준비한다. 이미 있는 테이블과 데이터는 유지한다. |

- 이름의 앞뒤 공백 제거, 타입 검사, 1~100자 길이 검증은 API 요청 스키마가 담당한다. Repository는 검증된 이름을 전달받는다.
- Repository는 전달받은 Session만 사용한다. 생성 작업의 commit과 예외 시 rollback은 API Router가 담당한다.
- 테이블은 저장소 루트에서 `uv run python -m backend.app.init_db`로 준비한다. 앱 시작이나 import만으로 테이블을 만들지 않는다. Docker 절차는 [DOCKER.md](DOCKER.md#테이블-초기화)를 참고한다.
- 이번 단계는 새 DB의 초기 테이블 생성까지다. 스키마 마이그레이션, 기존 DB 초기화, 다른 모델의 FK·cascade는 후속 작업이다.

## 업로드 설정

`backend/app/config.py`가 import 시 환경변수를 읽어 업로드 관련 설정을 제공한다. 미지정 또는 빈 값이면 기본값을 사용한다.

| 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `UPLOAD_DIR` | `backend/uploads` | 원본 PDF 저장 루트. Git에서 제외한다. |
| `MAX_UPLOAD_SIZE_BYTES` | `52428800` (50 MiB) | 업로드 1건의 최대 바이트 수. 양의 정수가 아니면 시작 시 오류. |
| `CORS_ALLOWED_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | 쉼표로 구분한 허용 origin. frontend 포트를 바꾸면 함께 변경한다. |

저장 서비스와 `/documents` API가 `UPLOAD_DIR`·`MAX_UPLOAD_SIZE_BYTES`를, `main.py`의 CORS 미들웨어가 `CORS_ALLOWED_ORIGINS`를 사용한다. Docker에서는 `UPLOAD_DIR=/data/uploads`로 `backend_data` 볼륨에 저장한다([DOCKER.md](DOCKER.md#업로드-파일)).

## 구현된 Document 데이터 계층

#17에서 모델·Repository·응답 스키마를 추가했다. 아래 업로드 서비스와 `/documents` API가 이 계층을 사용한다.

| 위치 | 책임 |
| --- | --- |
| `backend/app/models/document.py` | `Document` 모델. `documents` 테이블에 아래 필드를 둔다. 주차는 별도 Week 테이블 없이 `week_number`로 표현한다. |
| `backend/app/repositories/document.py` | `create_document(session, ...)`는 `flush`로 ID를 확보한 객체를 반환하고 commit하지 않는다. `get_document(session, id)`는 없으면 `None`, `list_documents_by_subject(session, subject_id)`는 ID 오름차순 목록(없으면 `[]`)을 반환한다. |
| `backend/app/schemas/document.py` | `DocumentRead` 응답 스키마. `stored_name`을 노출하지 않는다. |
| `backend/app/init_db.py` | `Document`를 등록해 `create_all` 재실행 시 기존 `subjects` 데이터를 유지한 채 `documents` 테이블을 추가한다. |

| 필드 | 타입·제약 | 의미 |
| --- | --- | --- |
| `id` | 정수 PK, 자동 생성 | Document ID |
| `subject_id` | 정수, `subjects.id` FK, 인덱스 | 소속 과목 |
| `week_number` | 정수, `> 0` | 주차 |
| `filename` | `String(255)` | 사용자에게 보여 줄 원본 파일명 |
| `stored_name` | `String(64)`, unique | 업로드 디렉터리 안의 서버 생성 파일명. 응답에 노출하지 않는다. |
| `uploaded_at` | `DateTime(timezone=True)`, 기본값 현재 UTC | 서버가 기록한 등록 시각. 원본 파일 수정 시각과 다르다. |
| `file_size_bytes` | 정수, `>= 0` | 서버가 실제로 확인한 바이트 수 |
| `page_count` | 정수 또는 `NULL`, `NULL`이 아니면 `> 0` | 페이지 수. 확인 전 상태는 `NULL`로 두고 0으로 대체하지 않는다. 현재 업로드 흐름은 동기적으로 확인하므로 성공 응답은 1 이상이다. |

- SQLite는 시간대를 저장하지 않으므로 `uploaded_at`은 항상 UTC로 기록하고, `DocumentRead`가 시간대 없는 값을 UTC로 해석해 `Z`로 끝나는 ISO 8601 문자열로 응답한다.
- SQLite 연결마다 `PRAGMA foreign_keys=ON`으로 FK를 강제한다. 과목 존재 여부는 업로드 서비스에서도 확인해 404로 처리한다. 삭제 cascade는 추가하지 않았다.
- `week_number`·`page_count`의 양수 조건은 API 검증과 별도로 DB CHECK 제약으로도 막는다.
- commit·rollback은 Repository가 아니라 파일 저장과 DB 기록을 함께 조율하는 서비스가 담당한다.

## 구현된 PDF 업로드 서비스

`backend/app/services/documents.py`가 업로드 1건의 검증·저장·DB 기록과 트랜잭션 경계를 소유한다. Router(`backend/app/routers/documents.py`)는 이 서비스를 호출하고 예외를 HTTP 상태로 바꾸는 역할만 맡는다.

`upload_document(session, *, upload_dir, max_size_bytes, subject_id, week_number, filename, file)`의 처리 순서:

1. 과목 존재 확인. 없으면 `SubjectNotFoundError`(→ 404).
2. 표시용 파일명 정리. `/`·`\` 앞의 경로를 버리고 출력 불가 문자와 앞뒤 공백을 제거한다. 빈 이름, `.`, `..`, 255자 초과는 `InvalidFilenameError`(→ 422).
3. `upload_dir` 생성. 실패하면 `StorageError`(→ 500).
4. `upload_dir` 안의 임시 파일(`.upload-*.tmp`)에 1 MiB 단위로 복사하며 누적 크기를 센다. 상한을 넘으면 즉시 중단하고 `UploadTooLargeError`(→ 413). 파일 전체를 메모리에 올리지 않는다.
5. PDF 검증. 빈 파일, 앞 1024바이트에 `%PDF-` 헤더가 없는 파일, pypdf 파싱 실패, 암호화(빈 비밀번호 포함), 0페이지는 `InvalidPdfError`(→ 422). 확장자와 Content-Type은 판단에 쓰지 않는다. 텍스트가 없는 스캔 PDF도 유효하면 허용하며 OCR은 하지 않는다.
6. UUID로 `stored_name`을 만들고 임시 파일을 `os.replace`로 최종 이름으로 옮긴다.
7. Repository로 Document를 만들고 commit한다.

어느 단계에서든 예외가 나면 rollback하고 임시 파일과 최종 파일을 삭제한 뒤 예외를 다시 던진다. 따라서 정상적인 예외 경로에서는 미완료 DB 행, 임시 파일, 참조되지 않는 최종 파일이 남지 않는다.

`get_document_file_path(upload_dir, document)`는 저장된 `stored_name`으로만 경로를 만들고, 파일이 없거나 `upload_dir` 밖을 가리키면 `None`을 반환한다(→ 원본 endpoint 404).

### Router와 설정 주입

- `get_upload_settings()` dependency가 `config.UPLOAD_DIR`·`MAX_UPLOAD_SIZE_BYTES`를 `UploadSettings`로 묶어 endpoint에 전달한다. 테스트는 `app.dependency_overrides`로 임시 디렉터리와 상한을 명시적으로 주입한다.
- FastAPI는 endpoint 실행 전에 multipart 본문 전체를 임시 파일로 받는다. 그래서 `UploadSizeLimitRoute`가 본문을 읽기 전에 `Content-Length`가 상한 + 64 KiB(폼 필드·경계 여유분)를 넘는 요청을 413으로 거부한다. `Content-Length`가 없거나 여유분 안이면 서비스의 실제 바이트 검사가 최종 판단한다.
- 폼·쿼리·경로의 정수는 `IntegerString` 타입으로 정수 형태 문자열만 받고, `Form/Query/Path(gt=0)`로 양수를 검사한다. `Annotated[..., Form(gt=0)]` 형태로 써야 제약이 적용된다.
- 원본은 Starlette `FileResponse`로 반환한다. `Content-Length`, `Accept-Ranges`, Range 요청(206/416)과 한글 파일명의 RFC 5987 `filename*`을 처리한다.
- `main.py`가 `CORSMiddleware`로 `CORS_ALLOWED_ORIGINS`만 허용한다.

### 한계와 정리 방침

- 파일시스템과 SQLite는 하나의 원자적 트랜잭션이 아니다. 프로세스가 강제 종료되면 `.upload-*.tmp` 임시 파일이나, 최종 파일 이동 후 commit 전에 종료된 경우 DB 행이 없는 최종 파일이 남을 수 있다. commit 후에는 행과 파일이 모두 있다.
- 남은 파일은 서버를 멈춘 상태에서 정리한다. `.upload-*.tmp`는 언제나 삭제해도 되고, 그 밖의 일반 업로드 파일은 `documents.stored_name`에 없는 경우에만 삭제한다. `.delete-*.pdf` 격리 파일은 이 기준으로 제거하지 않고 [삭제 복구 정책](API.md#파일-실패와-복구)에 따라 Document ID를 대조하여 복원하거나 제거한다. 자동 정리 daemon은 이번 범위에서 만들지 않는다.
- pypdf는 검증할 때 파일을 메모리로 읽는다. 크기 상한을 먼저 확인하므로 사용량은 `MAX_UPLOAD_SIZE_BYTES` 이하로 제한된다.

## Document 후속 처리 경계

#17은 PDF 원본 저장과 메타데이터 등록·조회까지다. 아래는 구현하지 않았으며, 후속 작업은 다음 연결 지점을 사용한다.

| 후속 작업 | 현재 상태와 연결 지점 |
| --- | --- |
| 페이지 텍스트 추출·`Page` 모델 | 미구현. `get_document_file_path()`로 원본을 찾고 pypdf로 추출한다. 업로드 `201`은 추출 완료를 뜻하지 않는다. |
| OCR·처리 상태·재시도 | 미구현. 처리 상태 필드나 queued 상태를 만들지 않았다. 비동기 처리를 도입하면 `page_count`의 `NULL`(확인 전)과 상태 값을 함께 설계한다. |
| FTS5 검색 | 미구현. Page 텍스트가 생긴 뒤 색인한다. |
| Subject·Document 삭제 | `services/deletion.py`가 `BEGIN IMMEDIATE`로 삭제를 직렬화하고 Repository의 단건 삭제·flush 및 commit/rollback을 관리한다. 과목은 자료가 있으면 409로 거부한다. 자료는 원본을 격리한 뒤 행을 commit하고 격리 파일을 제거한다. 실패·강제 종료·수동 복구 정책은 [API.md](API.md#파일-실패와-복구)를 따른다. Page·Note 모델 도입 시 연관 삭제 정책을 확장한다. |
| frontend 연결·PDF.js 뷰어 | 미구현(#19, #22). frontend는 `/documents` API를 호출하고 PDF.js는 `GET /documents/{id}/file`을 읽는다. CORS는 `CORS_ALLOWED_ORIGINS`로 허용하고 `Content-Disposition`을 노출한다. |
| 중복 업로드 판별 | 하지 않는다. 같은 파일도 별도 Document로 저장한다. |
| 남은 파일 자동 정리 | 하지 않는다. 강제 종료 시 남은 파일의 수동 정리 기준은 위 [한계와 정리 방침](#한계와-정리-방침)을 따른다. |

## 다음 합의 사항

- 주승현이 최소 관계를 바탕으로 모델과 PDF 처리 방식을 구체화하고 강서영·어승경과 연결 지점을 확인한다.
- 팀에서 [API 계약 초안](API.md)의 요청·응답과 미정 항목을 합의한다.
- 구현 검증은 “3주차 PDF 개념 검색 → 해당 페이지 열기 → 메모 작성” 흐름과 OCR·실패 재시도를 기준으로 한다.

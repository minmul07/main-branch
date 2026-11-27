# API 계약 초안

## 목적과 상태

P0 MVP에서 frontend와 backend가 같은 경로와 데이터 의미를 사용하기 위한 계약 초안이다. [ARCHITECTURE.md](ARCHITECTURE.md)의 역할 경계와 최소 데이터 관계를 따른다.

현재 구현된 API는 `GET /health`, `GET /subjects`, `POST /subjects`, `DELETE /subjects/{id}`, `POST /documents`, `GET /documents`, `GET /documents/{id}`, `GET /documents/{id}/file`, `DELETE /documents/{id}`, `GET /documents/{id}/notes`, `GET /documents/{id}/pages/{page}/notes`, `POST /documents/{id}/pages/{page}/notes`, `PATCH /notes/{id}`, `DELETE /notes/{id}`, `GET /search`이다. 구현된 계약은 아래 [구현된 API](#구현된-api)에 정리하며, 그 외 업무 endpoint는 구현 전 제안이다. 팀 합의 후 구현과 OpenAPI에 반영한다.

## 공통 규칙 제안

- PDF 등록은 `multipart/form-data`, 그 외 요청·응답 본문은 JSON을 기본으로 한다.
- 경로의 `{id}`는 해당 리소스의 ID다. ID 타입은 모델 상세 설계 때 통일한다.
- `{page}`는 1부터 시작하는 PDF 물리 페이지 번호다. 메모 API의 Page ID와 구분한다.
- 목록·검색은 결과가 없으면 빈 목록을 반환한다. 목록을 감싸는 응답 형식과 페이지네이션은 팀 합의 후 통일한다.
- 존재하지 않는 리소스는 404, 입력 검증 실패는 422를 기본으로 제안한다. 오류 본문 형식과 나머지 상태 코드는 함께 확정한다.

## 구현된 API

### `GET /subjects`

- 응답 `200`: 과목 배열, `id` 오름차순. 과목이 없으면 `[]`.
- 항목 형식: `{"id": 1, "name": "운영체제", "document_count": 0}`
- `document_count`는 조회 시점에 해당 과목에 등록된 Document 행 수다. 페이지 수·주차 수·원본 파일 존재 여부와 무관하며, 같은 파일의 반복 업로드도 각각 센다.
- `subjects LEFT JOIN documents`를 과목 ID·이름으로 묶고 `COUNT(documents.id)`로 한 번에 집계한다. 자료가 없는 과목도 0으로 포함하며 과목별 추가 쿼리(N+1)는 없다. 별도 카운터 컬럼이나 DB 마이그레이션은 필요하지 않다.
- 개수는 목록 조회 시점의 값이다. 삭제 API는 실제 자료 유무와 `confirmed_name`을 다시 검증하며, 이후 자료가 추가되면 이름 확인 없는 삭제는 409를 반환한다.

### `POST /subjects`

- 요청 본문: `{"name": "운영체제"}`
- `name`은 문자열이며 앞뒤 공백을 제거한 뒤 1~100자여야 한다. 제거된 값으로 저장·응답한다.
- 같은 이름의 과목을 여러 개 만들 수 있다.
- 응답 `201`: 생성한 과목 `{"id": 1, "name": "운영체제", "document_count": 0}`. 새 과목의 자료 개수는 0이다.
- 응답 `422`: `name` 누락, 문자열이 아닌 값(`null`, 숫자, 배열 등), 빈 값, 공백만 있는 값, 101자 이상. 오류 본문은 FastAPI 기본 형식(`detail` 배열)을 따른다.

`subjects` 테이블은 #7의 초기화 명령(`uv run python -m backend.app.init_db`)으로 준비한다. 앱 시작이나 import만으로 테이블을 만들지 않는다.

### Document 공통

- `documents` 테이블도 같은 초기화 명령으로 준비한다. 주차는 별도 Week 없이 `week_number`로 표현한다.
- 메타데이터 형식(업로드 응답, 목록 항목, 단건 조회 공통):

```json
{
  "id": 1,
  "subject_id": 1,
  "week_number": 3,
  "filename": "3주차.pdf",
  "uploaded_at": "2026-11-01T00:00:00Z",
  "file_size_bytes": 245760,
  "page_count": 12
}
```

| 필드 | 의미 |
| --- | --- |
| `id` | 서버가 생성하는 양의 정수 |
| `filename` | 업로드 파일명에서 경로 부분을 제거한 표시용 이름. 서버 내부 저장 이름·경로는 노출하지 않는다. |
| `uploaded_at` | 서버가 기록한 등록 시각(UTC). `Z`로 끝나는 ISO 8601이며 소수점 이하 초가 붙을 수 있다. 원본 파일 수정 시각이 아니다. |
| `file_size_bytes` | 서버가 실제로 읽은 바이트 수. 클라이언트가 보낸 크기를 쓰지 않는다. |
| `page_count` | 정수 또는 `null`. `null`은 페이지 수 확인 전을 뜻하며 0으로 바꾸지 않는다. 현재 업로드는 페이지 수를 동기적으로 확인하므로 성공 응답에서는 항상 1 이상이다. |

- ID·`subject_id`·`week_number`는 양의 정수여야 한다. 폼·쿼리·경로 문자열은 정수 형태만 허용하며 `3.0`, `3.5`처럼 소수점이 있는 값은 절삭하지 않고 422로 거부한다.
- 검증 오류(필드 누락, 정수 아님, 0 이하)는 FastAPI 기본 `detail` 배열, 그 밖의 오류(404·413·422·500)는 `{"detail": "안내 문구"}`로 응답한다. 문구는 고정 계약이 아니다.

### `POST /documents`

- 요청: `multipart/form-data`. `file`(PDF 1개), `subject_id`, `week_number`
- 응답 `201`: 생성한 Document 메타데이터. 원본 파일 저장과 Document·대기 작업 등록이 완료된 상태다. 처리 상태는 별도 API에서 조회한다.
- 같은 파일·파일명을 다시 올리면 별도 Document로 저장한다. 중복 판별(409)은 하지 않는다.
- 오류

| 상태 | 경우 |
| --- | --- |
| `404` | 없는 `subject_id` |
| `413` | 파일이 `MAX_UPLOAD_SIZE_BYTES`(기본 50 MiB) 초과. `Content-Length`가 상한 + 64 KiB를 넘으면 본문을 받기 전에 거부하고, 그 밖에는 실제로 읽은 바이트 수로 판단한다. |
| `422` | 필드 누락, 잘못된 정수, 0 이하 값 / 빈 파일명·`..`·255자 초과 파일명 / 빈 파일, PDF가 아닌 파일, 손상·파싱 실패, 암호화 PDF(빈 비밀번호 포함), 0페이지 PDF. 확장자와 Content-Type은 판단에 쓰지 않는다. 텍스트가 없는 스캔 PDF는 허용한다. |
| `500` | 업로드 디렉터리 생성·쓰기 실패 등 저장 오류 |

오류 시 DB 행과 업로드 파일을 남기지 않는다.

### `GET /documents?subject_id={id}`

- 응답 `200`: 해당 과목의 Document 배열, `id` 오름차순. 자료가 없으면 `[]`.
- `404`: 없는 과목. `422`: `subject_id` 누락·잘못된 값.

### `GET /documents/{id}`

- 응답 `200`: Document 메타데이터. `404`: 없는 Document. `422`: 잘못된 ID.

### `GET /documents/{id}/file`

- 응답 `200`: 원본 PDF 바이트 전체.
  - `Content-Type: application/pdf`
  - `Content-Length`: 파일 크기
  - `Content-Disposition: inline`. 파일명이 ASCII면 `filename="week3.pdf"`, 한글 등 그 외 문자가 있으면 `filename*=utf-8''3%EC%A3%BC%EC%B0%A8.pdf`(RFC 5987) 형식이다. 브라우저에서 바로 열린다.
  - `Accept-Ranges: bytes`
- Range: Starlette `FileResponse`가 처리한다. 단일 범위는 `206`과 `Content-Range`, 여러 범위는 `multipart/byteranges`, 범위를 벗어나면 `416`이다. 별도 스트리밍 시스템은 없다.
- `404`: 없는 Document, 또는 Document는 있지만 원본 파일이 사라진 경우. `422`: 잘못된 ID.
- 페이지 텍스트 조회(`/documents/{id}/pages/{page}`)와는 별개다.

### 처리 상태와 재시도 (#30)

`GET /documents/{id}/processing`은 현재 작업 상태를 `200`으로 반환한다. 처리 중이거나 처리에 실패한 자료도 기존 메타데이터와 원본을 조회할 수 있다. 원본이 사라졌으면 원본 조회는 `404`다. 기존 Document 응답에는 처리 필드를 추가하지 않으며, 기존 자료의 `page_count`가 `null`이면 추출 성공 시 실제 페이지 수가 기록된다.

```json
{
  "document_id": 1,
  "status": "completed",
  "error_code": null,
  "page_kinds": ["text", "image", "blank", "mixed", "unknown"]
}
```

- `status`는 `pending`(대기), `processing`(진행), `completed`(텍스트 추출·판별과 `image` 페이지 OCR 완료), `failed`(실패) 중 하나다.
- `page_kinds`는 `completed`에서 물리 페이지 순서대로 반환하며 나머지 상태는 `null`이다. `image`가 OCR 후보이고 `mixed`와 `unknown`은 검토 대상이다. 분류 기준과 한계는 [PDF 처리 문서](PDF_PROCESSING.md#페이지-종류)를 참고한다.
- `error_code`는 `failed`에서만 설정된다. `original_missing`은 원본 없음, `invalid_pdf`는 PDF 파싱·페이지 추출 또는 페이지 수 불일치, `processing_error`는 기타 파일·저장 처리 오류, `interrupted`는 서버가 멈추면서 중단된 작업, `ocr_unavailable`은 서버에서 `tesseract` 실행 파일이나 필요한 언어 데이터를 찾지 못한 경우, `ocr_failed`는 스캔 페이지 렌더링·글자 인식 실패나 시간 초과를 뜻한다(#31). OCR 결과는 이 응답에 포함하지 않고 `Page.ocr_text`에 저장한다.

`POST /documents/{id}/processing/retry`는 본문 없이 `failed` 작업을 다시 대기열에 등록한다. 응답은 `202`이며 `document_id`, `status: "pending"`, `error_code: null`, `page_kinds: null`을 반환한다. 이후 GET 응답은 실제 현재 상태를 반환한다. `pending`·`processing`·`completed`에서 요청하면 `409`다. 두 API 모두 `1`부터 SQLite의 부호 있는 64비트 정수 최댓값(`9223372036854775807`)까지의 정수 ID를 받는다. 대상 자료가 없으면 `404`, 잘못된 형식이나 범위를 벗어난 ID는 `422`, DB 오류는 `500`으로 응답한다.

### 삭제 API 확정 계약 (#25)

- `DELETE /subjects/{subject_id}`: 빈 과목은 즉시 삭제한다. 자료가 있으면 `confirmed_name` 쿼리가 현재 과목명과 정확히 일치해야 과목·모든 자료·원본 PDF·자료의 메모를 함께 삭제한다. 누락·불일치는 `409`, 없는 과목은 `404`, 성공은 본문 없는 `204`이다. 전체 자료를 같은 트랜잭션에서 삭제하며 실패 시 격리한 원본을 모두 복원한다. 다른 과목과 자료에는 영향을 주지 않는다.
- `DELETE /documents/{document_id}`: 해당 Document 행, 메모, 페이지, 처리 상태, 서버 저장 PDF 원본을 삭제한다. 성공은 본문 없는 `204`, 없는 자료는 `404`이다. 원본이 이미 없으면 메타데이터 삭제를 허용한다. DB 행은 같은 트랜잭션에서 삭제하며 과목 일괄 삭제에도 같은 규칙을 적용한다.
- 두 경로 ID는 양의 정수 문자열이며 0·음수·문자·소수 형태는 `422`이다. 오류는 기존 `detail` 형식이며 문구는 고정 계약이 아니다. 저장소·DB 실패는 `500`이고 성공 응답을 반환하지 않는다. DELETE는 CORS 허용 메서드에 포함한다.

#### 파일 실패와 복구

자료 삭제는 SQLite 쓰기 잠금 후 대상을 읽고, 원본을 같은 디렉터리의 `.delete-{document_id}-{UUID}-{stored_name}`으로 이동하고, DB 행 삭제를 commit한 뒤 격리 파일을 unlink한다. 이동 실패는 DB를 rollback하고 원본을 보존한다. DB 실패는 rollback 후 격리 파일을 원래 `stored_name`으로 복원한다. 경로 탈출·심볼릭 링크·일반 파일이 아닌 원본은 삭제하지 않고 `500`으로 거부한다. 다른 파일을 덮어쓰거나 삭제하지 않는다.

DB와 파일시스템은 단일 원자적 트랜잭션이 아니다. commit 이후 격리 파일 제거 실패는 `500`이지만 행은 이미 삭제되었으므로 재조회·재삭제는 `404`일 수 있다. 복원 실패도 `500`으로 보고하고 서버 로그에 원본/격리 경로를 남긴다. 강제 종료 시에도 격리 파일이 남을 수 있다. 복구는 서버를 멈추고 DB를 백업한 뒤 `.delete-{document_id}-{UUID}-{stored_name}`과 Document의 ID·`stored_name` 모두를 대조하여, 둘 다 같은 행이 있으면 그 행의 `stored_name`으로 복원(기존 파일은 덮어쓰지 않음), 같은 행이 없으면 해당 격리 파일만 제거한다. SQLite의 ID 재사용 가능성 때문에 ID만으로 복원 대상을 결정하지 않는다. 자동 스캔·자동 정리는 수행하지 않으며 디스크/권한 문제 해결 후 운영자가 복구한다. DB commit 결과가 불확실한 연결 장애는 DB를 다시 확인한 뒤 같은 절차를 따른다.

삭제 작업은 `BEGIN IMMEDIATE`로 동시 삭제를 직렬화하며 SQLite 연결마다 외래 키를 활성화하여 과목 삭제와 업로드 경합으로 고아 Document가 생기지 않게 한다. 같은 서버 프로세스의 PDF 워커는 원본을 메모리에 읽는 동안 삭제와 공유하는 파일 잠금을 사용한다. 삭제 실패 시에는 격리된 원본 복원이 끝난 뒤 워커가 파일을 조회한다.

### CORS

브라우저 frontend가 다른 origin에서 호출할 수 있도록 `CORS_ALLOWED_ORIGINS`(기본 `http://127.0.0.1:5173,http://localhost:5173`)만 허용한다. 메서드는 `GET`·`POST`·`PATCH`·`DELETE`, 요청 헤더는 `Content-Type`·`Range`를 허용하고 `Content-Disposition`·`Accept-Ranges`·`Content-Range` 응답 헤더를 노출한다. PDF.js는 `Accept-Ranges: bytes`를 확인해 지원되는 파일의 부분 요청을 사용한다. frontend 포트를 바꾸면 이 값을 함께 바꾼다.

## MVP endpoint

아래 데이터는 서로 연결하기 위해 필요한 최소 의미다. 상세 응답 필드와 타입을 모두 확정한 스키마는 아니다.

| Method | 경로 | 요청 | 응답·동작 |
| --- | --- | --- | --- |
| GET | `/subjects` | 없음 | 과목 목록: ID, 이름 |
| POST | `/subjects` | 과목 이름 `name` | 생성한 과목 |
| DELETE | `/subjects/{id}` | 과목 ID, 선택적 confirmed_name | 빈 과목 또는 정확한 과목명 확인 시 일괄 삭제 204, 자료가 있고 이름 미확인 시 409 |
| POST | `/documents` | PDF `file`, 과목 `subject_id`, 주차 `week_number` | 구현됨. 생성한 Document 메타데이터 |
| GET | `/documents?subject_id={id}` | 과목 ID | 구현됨. 과목별 Document 목록 |
| GET | `/documents/{id}` | 문서 ID | 구현됨. Document 메타데이터 |
| GET | `/documents/{id}/file` | 문서 ID | 구현됨. 원본 PDF |
| GET | `/documents/{id}/processing` | 문서 ID | 구현됨. 현재 처리 상태와 완료 시 페이지 유형 |
| POST | `/documents/{id}/processing/retry` | 문서 ID | 구현됨. 실패한 작업만 재등록 202 |
| DELETE | `/documents/{id}` | 문서 ID | 구현됨. 메타데이터·원본 삭제 204; 실패·복구 정책은 위 확정 계약 참고 |
| GET | `/documents/{id}/pages/{page}` | 문서 ID, 페이지 번호 | 페이지 ID, 문서 ID, 페이지 번호, 추출 텍스트 |
| GET | `/search?q=...` | 검색어 `q`(1~100자, 앞뒤 공백 제거), 선택: `subject_id`(과목 범위), `limit`(1~100, 기본 50) | 구현됨. 페이지 단위 검색 결과 목록. 일치하는 페이지가 없으면 빈 목록(200). `q`가 비었거나 공백뿐이거나 NUL 문자(`\x00`)가 들어 있거나 `subject_id`·`limit`이 범위를 벗어나면 422 |
| GET | `/documents/{id}/notes` | 문서 ID | 구현됨. 자료의 모든 메모(페이지 번호, ID 순). 없는 자료 404, 잘못된 ID 422. 뷰어의 페이지 배지와 페이지 옆 메모 여백이 한 번에 불러올 때 사용 |
| GET | `/documents/{id}/pages/{page}/notes` | 문서 ID, 페이지 번호 | 구현됨. 해당 페이지의 메모 목록(ID 순) |
| POST | `/documents/{id}/pages/{page}/notes` | 문서 ID, 페이지 번호, 본문 `title`(선택), `content`(선택) | 구현됨. 201, 생성한 메모. `title`을 비우면 "{페이지}페이지 메모 {N}" 기본 이름(N은 그 페이지의 기존 메모 수 + 1에서 시작해, 같은 페이지에 같은 이름이 있으면 다음 번호) |
| PATCH | `/notes/{id}` | Note ID, 수정할 `title`·`content` 중 보낼 것만 | 구현됨. 수정한 메모. 보내지 않은 칸은 유지 |
| DELETE | `/notes/{id}` | Note ID | 구현됨. 204, 응답 본문 없음 |

문서 등록의 주차는 별도 Week ID 대신 `week_number`로 전달하는 제안이다. 독립적인 주차 생성·관리의 필요성은 데이터 모델과 함께 협의한다.

## 검색·원문·메모 연결

검색 결과 한 항목에는 다음 정보가 필요하다.

| 정보 | 용도 |
| --- | --- |
| `document_id` | 원본 문서 선택 |
| `page_id` | 페이지 메모 조회·작성 |
| `page_number` | PDF.js에서 해당 페이지로 이동 |
| `filename`, `subject_id`, `subject_name`, `week_number` | 검색 결과의 자료 위치 표시 |
| `snippet` | 검색어 주변 문맥 표시 |

응답 예시는 다음과 같다.

```json
[
  {
    "document_id": 4,
    "page_id": 130,
    "page_number": 21,
    "filename": "week1.pdf",
    "subject_id": 1,
    "subject_name": "자료구조",
    "week_number": 1,
    "snippet": "…DOUBLY LINKED LISTS 1. Before the delete…"
  }
]
```

### 검색 동작

- 검색 대상: 페이지의 추출 텍스트(`text`)와 OCR 텍스트(`ocr_text`) 두 칸을 모두 찾는다. 한 페이지가 양쪽에서 일치해도 결과는 한 번만 나온다. `ocr_text`가 `NULL`(OCR 안 함)인 기존 페이지도 `text`만으로 검색된다.
- 일치 방식: SQLite FTS5의 `trigram` 토크나이저로 검색어가 들어 있는 글을 부분 문자열로 찾는다. 영문 대소문자는 구분하지 않고, "미분을"처럼 조사가 붙은 글에서도 "미분"을 찾는다. 검색어의 따옴표·`%`·`_`는 일반 문자로 취급한다.
- 짧은 검색어: `trigram`은 3글자 미만을 찾지 못하므로 1~2글자 검색어는 `LIKE`로 찾는다. 이 경우 관련도 정렬이 없고 페이지가 많으면 느릴 수 있다.
- 스니펫: `text`에서 검색어를 먼저 찾고, 없으면 `ocr_text`에서 찾는다. 둘 다 못 찾으면 글이 있는 쪽의 앞부분을 쓴다. 검색어 앞뒤 30글자를 한 줄로 자르며 줄바꿈과 연속 공백은 한 칸으로 바꾼다. 잘린 쪽에는 `…`를 붙인다.
- 정렬: 3글자 이상이면 관련도(BM25) 순이고, 같으면 주차 → 자료 → 페이지 순이다. 1~2글자는 주차 → 자료 → 페이지 순이다.
- 범위와 개수: `subject_id`를 주면 그 과목 안에서만 찾는다. 결과는 `limit`(기본 50, 최대 100)개까지이며 페이지네이션은 없다.
- 한계: 형태소 분석은 하지 않는다. 원문 그대로 비교하므로 검색어의 공백이 원문의 줄바꿈과 다르면(예: 원문 `a↵b`, 검색어 `a b`) 찾지 못한다. 연속된 공백도 원문 그대로 비교하므로 원문에 공백이 두 칸이면 한 칸으로 검색해서는 찾지 못한다. 이 한계는 실제 SQLite `trigram`으로 확인했다.

`GET /documents/{id}/pages/{page}`는 페이지 메타데이터와 텍스트를 조회하는 계약이다. PDF.js는 원본 PDF를 `GET /documents/{id}/file`에서 읽는다.

메모는 Page 모델이 생기기 전까지 `document_id`와 `page_number`로 연결한다. 메모 응답은 `id`, `document_id`, `page_number`, `title`, `content`, `created_at`, `updated_at`을 담고 시각은 UTC다. 없는 자료·페이지(`page_count` 초과)·메모는 404, 잘못된 ID·페이지 번호, 수정 시 빈 `title`, 너무 긴 입력은 422다. `page_count`를 모르는 자료는 페이지 범위를 확인하지 않는다.

## 구현 전 합의할 항목

- 요청·응답의 정확한 필드명·타입, 목록·오류 형식과 성공 상태 코드
- 페이지 처리 중이거나 추출에 실패했을 때 페이지 조회 응답
- 검색 결과의 페이지네이션(현재는 `limit`개까지만 반환한다)
- Page·Note 도입 시 문서 삭제의 하위 데이터 처리, 페이지별 메모 개수

OCR·실패 재시도와 자료 목록은 P0에 포함되지만, 위 endpoint 목록만으로 모든 계약이 정해진 것은 아니다. 관련 담당자가 이 항목들을 보완한 뒤 구현을 연결한다.

# API 계약 초안

## 목적과 상태

P0 MVP에서 frontend와 backend가 같은 경로와 데이터 의미를 사용하기 위한 계약 초안이다. [ARCHITECTURE.md](ARCHITECTURE.md)의 역할 경계와 최소 데이터 관계를 따른다.

현재 구현된 API는 `GET /health`뿐이며 서버 응답을 확인한다. 아래 업무 endpoint는 구현 전 제안이다. 팀 합의 후 구현과 OpenAPI에 반영한다.

## 공통 규칙 제안

- PDF 등록은 `multipart/form-data`, 그 외 요청·응답 본문은 JSON을 기본으로 한다.
- 경로의 `{id}`는 해당 리소스의 ID다. ID 타입은 모델 상세 설계 때 통일한다.
- `{page}`는 1부터 시작하는 PDF 물리 페이지 번호다. 메모 API의 Page ID와 구분한다.
- 목록·검색은 결과가 없으면 빈 목록을 반환한다. 목록을 감싸는 응답 형식과 페이지네이션은 팀 합의 후 통일한다.
- 존재하지 않는 리소스는 404, 입력 검증 실패는 422를 기본으로 제안한다. 오류 본문 형식과 나머지 상태 코드는 함께 확정한다.

## MVP endpoint

아래 데이터는 서로 연결하기 위해 필요한 최소 의미다. 상세 응답 필드와 타입을 모두 확정한 스키마는 아니다.

| Method | 경로 | 요청 | 응답·동작 |
| --- | --- | --- | --- |
| GET | `/subjects` | 없음 | 과목 목록: ID, 이름 |
| POST | `/subjects` | 과목 이름 `name` | 생성한 과목 |
| DELETE | `/subjects/{id}` | 과목 ID | 과목 삭제; 하위 자료·메모 처리 정책은 합의 필요 |
| POST | `/documents` | PDF `file`, 과목 `subject_id`, 주차 `week_number` | 등록한 문서 ID와 처리 상태 |
| GET | `/documents/{id}` | 문서 ID | 문서 정보: 과목, 주차, 파일명, 페이지 수, 처리 상태 |
| DELETE | `/documents/{id}` | 문서 ID | 문서 삭제; 파일·페이지·메모 정리 정책은 합의 필요 |
| GET | `/documents/{id}/pages/{page}` | 문서 ID, 페이지 번호 | 페이지 ID, 문서 ID, 페이지 번호, 추출 텍스트 |
| GET | `/search?q=...` | 검색어 `q`; 과목 범위 지정용 `subject_id` 제안 | 페이지 단위 검색 결과 목록 |
| GET | `/pages/{id}/notes` | Page ID | 해당 페이지의 메모 목록 |
| POST | `/pages/{id}/notes` | Page ID, 메모 내용 `content` | 생성한 메모 |
| PATCH | `/notes/{id}` | Note ID, 수정할 `content` | 수정한 메모 |
| DELETE | `/notes/{id}` | Note ID | 메모 삭제 |

문서 등록의 주차는 별도 Week ID 대신 `week_number`로 전달하는 제안이다. 독립적인 주차 생성·관리의 필요성은 데이터 모델과 함께 협의한다.

## 검색·원문·메모 연결

검색 결과 한 항목에는 다음 정보가 필요하다.

| 정보 | 용도 |
| --- | --- |
| `document_id` | 원본 문서 선택 |
| `page_id` | 페이지 메모 조회·작성 |
| `page_number` | PDF.js에서 해당 페이지로 이동 |
| `filename`, `subject_id`, `week_number` | 검색 결과의 자료 위치 표시 |
| `snippet` | 검색어 주변 문맥 표시 |

`GET /documents/{id}/pages/{page}`는 페이지 메타데이터와 텍스트를 조회하는 계약이다. PDF.js가 읽을 원본 PDF 제공 방식은 별도로 합의해야 한다.

메모 응답에는 최소한 메모 ID, Page ID와 내용이 필요하다. 생성·수정 시각 등 추가 필드는 Subject/Note 담당자와 frontend 담당자가 협의한다.

## 구현 전 합의할 항목

- 요청·응답의 정확한 필드명·타입, 목록·오류 형식과 성공 상태 코드
- 과목별 문서 목록 조회 방식과 원본 PDF 제공 방식
- 업로드 처리의 동기·비동기 여부, 처리 상태 값과 실패 재시도 계약
- 페이지 처리 중이거나 추출에 실패했을 때 페이지 조회 응답
- 검색의 과목 범위와 결과 정렬·페이지네이션
- 과목·문서 삭제 시 하위 데이터 처리, 페이지별 메모 개수

OCR·실패 재시도와 자료 목록은 P0에 포함되지만, 위 endpoint 목록만으로 모든 계약이 정해진 것은 아니다. 관련 담당자가 이 항목들을 보완한 뒤 구현을 연결한다.

# 아키텍처 초안

## 목적과 범위

[Notion의 제품 정의](https://app.notion.com/p/3e9c6339ee0f818d83cbf3f662fbdd72)와 [PROJECT.md](PROJECT.md)를 바탕으로 P0 구현의 큰 구조와 담당 경계를 정리한다. 팀 협의를 위한 초안이며, 상세 필드·스키마·처리 방식은 담당자가 설계한 뒤 함께 확정한다.

핵심 흐름은 **과목·주차별 PDF 등록 → 텍스트 추출/OCR → 페이지 단위 검색 → 원문 페이지 확인 → 메모 작성**이다. 한 사람이 자기 컴퓨터에서 브라우저로 사용하는 로컬 웹 앱을 기준으로 한다. OCR과 실패 재시도는 P0 범위에 포함한다.

현재 저장소에는 React 기본 화면, FastAPI 기본 서버와 SQLite 연결이 있다. 아래 구조의 업무 기능은 구현 전이다. API 계약은 [API.md](API.md), 실행 환경과 검증 기준은 [DOCKER.md](DOCKER.md)와 [TESTING.md](TESTING.md)를 참고한다.

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

PDF 추출 라이브러리는 pdfplumber 또는 pypdf 중에서 선택한다. 오래 걸리는 PDF/OCR 처리의 실행 방식과 저장 경로는 PDF/backend 담당자가 상세 설계한다.

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

## 다음 합의 사항

- 주승현이 최소 관계를 바탕으로 모델과 PDF 처리 방식을 구체화하고 강서영·어승경과 연결 지점을 확인한다.
- 팀에서 [API 계약 초안](API.md)의 요청·응답과 미정 항목을 합의한다.
- 구현 검증은 “3주차 PDF 개념 검색 → 해당 페이지 열기 → 메모 작성” 흐름과 OCR·실패 재시도를 기준으로 한다.

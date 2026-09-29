# 강의자료 기반 학습 플랫폼

여러 PDF로 흩어진 강의자료를 과목·주차별로 정리하고, 페이지 단위 원문 검색 → 원문 확인 → 메모·학습 기록을 하나의 흐름으로 연결하는 로컬 웹 학습 플랫폼.

## 팀원

오픈소스소프트웨어

- 2023203068 어승경, 팀장
- 2025403073 한예승
- 2023203092 주승현
- 2025403017 강서영

## 개발 환경

- Python 3.14와 [uv](https://docs.astral.sh/uv/)로 FastAPI·SQLAlchemy 의존성을 관리합니다.
- SQLite는 Python 표준 라이브러리의 `sqlite3`을 사용하며, 검색용 FTS5도 사용할 수 있습니다.
- React·Vite·TypeScript 프론트엔드는 `frontend/`에서 npm으로 관리합니다.

```sh
uv sync
cd frontend
npm ci
npm run dev
```

백엔드 애플리케이션의 실행 명령은 API 진입점을 구현할 때 추가합니다.

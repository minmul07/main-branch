# 백엔드 테스트

저장소 루트에서 Python 3.14와 uv를 사용합니다.

```sh
uv sync --locked
uv run pytest
```

## 검증 기준

- `GET /health`가 HTTP 200과 `{"status":"ok"}`를 반환해야 합니다. 이 endpoint는 서버 응답만 확인하며 DB 연결을 확인하지 않습니다.
- SQLAlchemy를 통한 SQLite 연결에서 `SELECT 1`이 성공해야 합니다.
- SQLite에 기록하고 커밋한 데이터는 엔진을 새로 생성해 연결한 뒤에도 읽을 수 있어야 합니다.
- `get_db()` 종료 시 커밋하지 않은 변경은 롤백되어야 합니다.
- DB 테스트는 pytest의 `tmp_path` 아래에 임시 SQLite 파일을 사용하고, 사용 후 엔진을 해제합니다. 개발용 `backend/app.db`를 생성하거나 변경하지 않습니다.
- `DATABASE_PATH` 환경변수의 사용자 지정 경로가 엔진에 적용되고, 미지정 또는 빈 값이면 기존 `backend/app.db` 경로를 사용해야 합니다. import 시 설정을 읽으므로 별도 Python 프로세스에서 확인합니다.

현재는 도메인 모델과 마이그레이션이 없으므로, 테스트에 필요한 테이블만 임시 DB에 생성합니다.

# 프론트엔드 테스트

Node 22 최신 패치(22.22.2 이상)를 사용하고 `frontend/`에서 실행합니다.

```sh
npm ci
npm test
npm run build
npm run lint
```

## 검증 기준

- Vitest의 jsdom 환경에서 `App` 제목이 렌더링되어야 합니다.
- `VITE_API_BASE_URL` 설정 시 해당 주소를 사용하고, 미지정 또는 빈 값이면 `http://127.0.0.1:8000`을 사용해야 합니다. 테스트에서는 환경변수를 임시로 설정하고 복원합니다.
- TypeScript 검사와 Vite 빌드, Oxlint 검사가 성공해야 합니다.
- `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`로 서버를 실행해 브라우저에서 `App` 표시와 콘솔 오류 여부를 확인하고, 확인 후 서버를 종료합니다.
- 화면 확인에는 백엔드 실행이 필요하지 않습니다.

# Docker 검증

Docker 실행과 데이터 보존 규칙은 [Docker 문서](DOCKER.md)를 참고합니다. 호스트에 맞는 Python·Node가 없으면 테스트도 컨테이너에서 실행합니다.

```sh
docker compose config --quiet
docker compose run --rm --no-deps backend uv run --locked pytest
docker compose run --rm --no-deps frontend npm test
docker compose run --rm --no-deps frontend npm run build
docker compose run --rm --no-deps frontend npm run lint
```

## fresh clone 검증

1. 검증 대상 변경을 포함한 커밋을 새로운 폴더에 clone하고 해당 작업 브랜치를 checkout합니다. clone에 `.env`, `.venv`, `frontend/node_modules`, 로컬 DB가 없는지 확인합니다. 기존 작업 폴더의 파일을 복사해 검증을 대신하지 않습니다.
2. 다른 실행 환경과 분리하려면 `COMPOSE_PROJECT_NAME`을 검증용 고유 이름으로 지정합니다. 기본 포트가 비어 있는 상태에서 `docker compose up --build`를 실행합니다.
3. `docker compose ps`에서 두 서비스가 healthy인지 확인합니다. `curl -fsS http://127.0.0.1:8000/health`가 `{"status":"ok"}`를 반환하고 frontend 루트 페이지가 HTTP 200인지 확인합니다.
4. 브라우저에서 `http://127.0.0.1:5173`을 열어 `App` 제목과 콘솔 오류 여부를 확인합니다. 검증용 clone에서 frontend 제목을 임시 변경하고 브라우저를 새로고침하지 않아도 반영되는지 확인한 후 복원합니다. backend에 임시 검증 endpoint를 추가해 자동 재시작 후 응답을 확인하고 복원합니다.
5. backend 컨테이너에서 SQLAlchemy로 `SELECT 1`을 실행하고 검증용 테이블·데이터를 `/data/app.db`에 기록합니다. `docker compose down` 후 같은 프로젝트로 다시 실행해 기록을 읽을 수 있는지 확인합니다. `/health` 결과를 DB 검증으로 대체하지 않습니다.
6. `BACKEND_PORT`와 `FRONTEND_PORT`를 다른 값으로 지정해 `docker compose config`의 포트와 기본 `VITE_API_BASE_URL`을 확인합니다. 명시적인 API URL도 반영되는지 확인합니다.
7. 검증한 커밋, Docker·Compose·Python·Node 버전과 실행 결과를 기록합니다. 검증용 프로젝트에 대해서만 `docker compose down --volumes`로 데이터를 정리합니다. Windows·macOS에서 직접 확인하지 않았다면 해당 검증은 미수행으로 보고합니다.

## 직접 검증 기록 (2026-10-01)

- Linux x86_64, Docker 29.8.1, Compose 5.5.1, 컨테이너 Python 3.14.7 / uv 0.11.1 / Node 22.23.3에서 확인했습니다.
- 작업 브랜치와 스테이징 상태를 변경하지 않고 임시 저장소에 구현 스냅샷 `f3291dc0679e6ced09209984d179b2aa30a24c5e`를 커밋한 뒤, 그 저장소를 다시 fresh clone해 실행했습니다. 검증용 프로젝트는 `school-docker-check-kj2pan6g`입니다. `.env`, `.venv`, `frontend/node_modules`, 로컬 DB가 없는 상태에서 `docker compose up --build`가 성공했습니다.
- 두 서비스 healthy, 호스트에서 frontend HTTP 200과 `/health`의 HTTP 200·`{"status":"ok"}`를 확인했습니다. 브라우저의 `App` 표시, API 설정값, 초기 실행과 HMR 검증 중 콘솔 오류·경고 0건을 확인했습니다.
- backend pytest 7개와 frontend Vitest 4개가 통과했고 TypeScript·Vite 빌드 및 Oxlint가 성공했습니다. backend 테스트에는 기존 Starlette TestClient의 httpx 사용 중단 예정 경고 1건이 있습니다.
- frontend 제목 수정·복원이 페이지 새로고침 없이 HMR로 반영됐고, backend 임시 endpoint 추가·제거가 자동 재시작으로 반영됐습니다. 검증 후 임시 소스 변경은 모두 복원했습니다.
- `/data/app.db`에서 SQLAlchemy `SELECT 1`과 기록·커밋이 성공했습니다. `down` 후 `up --build --detach --wait`로 컨테이너를 재생성한 뒤 같은 기록과 두 서비스 healthy 상태를 확인했습니다.
- 기본값, 포트 변경, 명시적인 API URL, 빈 환경변수 처리를 `docker compose config`로 확인했습니다. Windows·macOS 직접 실행은 미검증입니다.

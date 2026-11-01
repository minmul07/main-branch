# GitHub Actions CI

[CI 워크플로](../.github/workflows/ci.yml)는 `main` 대상 PR 생성·추가 커밋과 `main` push 시 실행됩니다. `workflow_dispatch`를 통한 수동 실행은 워크플로가 기본 브랜치에 등록된 뒤 사용할 수 있습니다. 작업 브랜치에 push만 하고 PR을 생성하지 않으면 자동 실행되지 않습니다.

- `Backend tests`: Ubuntu 환경에서 Python 3.14와 uv로 `uv sync --locked`, `uv run --locked pytest`를 실행합니다.
- `Frontend checks`: Ubuntu 환경에서 Node 22 최신 패치로 `frontend/`의 `npm ci`, `npm test`, `npm run build`, `npm run lint`를 실행합니다.
- 두 job은 병렬로 실행하며 각각 제한 시간은 15분입니다. 같은 브랜치에서 새 실행이 시작되면 이전 실행은 취소됩니다.
- 의존성 설치에는 `uv.lock`과 `frontend/package-lock.json`을 사용하고 다운로드 캐시를 재사용합니다.
- CI가 실행된 뒤 GitHub Ruleset의 필수 검사에 `Backend tests`와 `Frontend checks`를 등록합니다. Ruleset 설정은 GitHub에서 별도로 수행합니다.
- 이 워크플로는 브라우저 화면 확인과 아래 Docker·fresh clone 검증을 포함하지 않습니다.

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

- `backend/tests/conftest.py`가 모든 테스트에서 `database.engine`을 `tmp_path`의 임시 SQLite로 교체해 개발용 DB를 건드리지 않습니다. Subject API 테스트는 임시 DB에 필요한 테이블을 직접 만듭니다.

### 업로드 설정 (`backend/tests/test_config.py`)

- `UPLOAD_DIR`, `MAX_UPLOAD_SIZE_BYTES`, `CORS_ALLOWED_ORIGINS`가 미지정 또는 빈 값이면 기본값(`backend/uploads`, 52,428,800바이트, 로컬 Vite 5173 origin 두 개)을 사용해야 합니다. import 시 설정을 읽으므로 별도 Python 프로세스에서 확인합니다.
- 사용자 지정 값이 적용되고, CORS origin은 쉼표로 나눈 뒤 공백과 빈 항목을 제거해야 합니다.
- 최대 크기가 0, 음수, 정수가 아닌 값이면 `ValueError`가 발생해야 합니다.

### Subject Repository (`backend/tests/test_subject_repository.py`)

- 임시 SQLite 파일에 `init_db()`로 테이블을 만들고 개발용 DB를 사용하지 않습니다.
- 초기화를 다시 실행해도 기존 과목 데이터가 유지되어야 합니다.
- `create_subject`는 ID가 있는 Subject를 반환하고, 같은 이름도 별도 ID로 생성해야 합니다.
- `create_subject`는 자체적으로 commit하지 않아야 합니다. 생성 직후 별도 연결에서 조회하면 0건이어야 합니다.
- `list_subjects`는 데이터가 없으면 `[]`를, 있으면 ID 오름차순 목록을 반환해야 합니다.
- 호출자가 commit한 과목은 엔진을 해제하고 다시 연결해도 조회되어야 합니다.
- 생성 후 호출자가 rollback하면 과목이 저장되지 않아야 합니다.

### Document Repository (`backend/tests/test_document_repository.py`)

- 임시 SQLite 파일에 `init_db()`로 `subjects`·`documents` 테이블을 만들고 개발용 DB를 사용하지 않습니다.
- `create_document`는 ID와 현재 UTC `uploaded_at`이 채워진 Document를 반환하고, 자체적으로 commit하지 않아야 합니다. 호출자가 rollback하면 저장되지 않아야 합니다.
- `get_document`는 있는 ID면 Document를, 없는 ID면 `None`을 반환해야 합니다.
- `list_documents_by_subject`는 과목별로 분리된 ID 오름차순 목록을, 자료가 없으면 `[]`를 반환해야 합니다.
- 같은 파일명은 별도 Document로 저장되고, `stored_name` 중복은 거부되어야 합니다.
- `week_number` 0·음수, `file_size_bytes` 음수, `page_count` 0은 DB 제약으로 거부되고, `page_count`의 `NULL`은 허용되어야 합니다.
- 초기화를 다시 실행해도 기존 Subject·Document가 유지되고, 엔진을 다시 연결해도 조회되어야 합니다.
- `DocumentRead`는 `stored_name`을 노출하지 않고, `uploaded_at`을 `Z`로 끝나는 UTC ISO 8601로, `page_count`의 `null`을 그대로 직렬화해야 합니다.

### PDF 업로드 서비스 (`backend/tests/test_document_service.py`)

- 임시 SQLite와 `tmp_path` 아래 업로드 디렉터리를 사용하며 개발용 DB·`backend/uploads`를 건드리지 않습니다. 테스트 PDF는 `backend/tests/pdf_samples.py`가 코드로 생성합니다(텍스트 PDF, 이미지만 있는 스캔 PDF, 여러 페이지, 암호화, 0페이지).
- 업로드 성공 시 Document의 주차·파일명·실제 바이트 수·페이지 수·UTC 등록 시각이 맞고, 저장 파일 바이트가 업로드와 같아야 합니다.
- 스캔 PDF와 여러 페이지 PDF를 허용하고, 빈 파일·PDF 위장 파일·손상·잘린 파일·암호화(빈 비밀번호 포함)·0페이지 PDF를 거부해야 합니다. 거부 시 DB 행과 파일이 남지 않아야 합니다.
- 크기 상한과 같은 파일은 허용하고 1바이트라도 넘으면 거부해야 합니다.
- 없는 과목은 파일을 쓰기 전에 거부해야 합니다.
- 같은 파일을 반복 업로드하면 별도 Document와 별도 파일이 생겨야 합니다.
- 파일명은 경로 부분(`/`, `\`)을 제거하고 한글을 유지해야 하며, 빈 이름·`..`·구분자로 끝나는 이름·255자 초과를 거부해야 합니다. 경로 조작 이름으로도 업로드 디렉터리 밖에 파일이 생기면 안 됩니다.
- commit 실패와 파일 이동 실패를 재현했을 때 DB 행·임시 파일·최종 파일이 남지 않아야 합니다. 업로드 디렉터리를 만들 수 없으면 `StorageError`가 발생해야 합니다.
- 원본 파일이 사라진 Document는 원본 경로 조회 결과가 `None`이어야 합니다.

### Document API (`backend/tests/test_documents.py`)

- 임시 SQLite(`conftest.py`의 엔진)와 `tmp_path` 업로드 디렉터리를 `get_db`·`get_upload_settings` override로 주입하고, 테스트 후 override를 정리합니다.
- `POST /subjects` → `POST /documents` → 과목별 목록 → 단건 조회 → 원본 조회 흐름에서 201, 메타데이터 7개 필드, `Z`로 끝나는 시각, 실제 크기·페이지 수, 원본 바이트 일치와 `Content-Type`·`Content-Length`·`Content-Disposition`(한글 `filename*`, ASCII `filename`)을 확인합니다.
- Range 요청 `bytes=0-9`가 206과 `Content-Range`, 해당 바이트를 반환해야 합니다.
- 과목별 분리, ID 오름차순, 빈 목록 `[]`, 없는 과목·문서 404를 확인합니다.
- `subject_id`·`week_number`·Document ID의 누락, 빈 값, 0, 음수, 문자, `3.0`·`3.5` 같은 소수 형태가 422를 반환하고 저장되지 않아야 합니다.
- 빈 파일, PDF가 아닌 파일, 암호화, 0페이지, 잘린 PDF는 422이고 DB 행·파일이 남지 않아야 합니다. 스캔 PDF는 201입니다.
- 빈 파일명 422, 경로 조작 파일명은 정리되어 업로드 디렉터리 안에만 저장되어야 합니다. 같은 파일 반복 업로드는 별도 ID와 별도 파일을 만들어야 합니다.
- 실제 크기가 상한을 넘으면 413, `Content-Length`가 상한 + 여유분을 넘으면 업로드 서비스가 호출되기 전에 413이어야 합니다.
- 업로드 디렉터리를 만들 수 없으면 500, 원본 파일이 사라지면 메타데이터는 200이고 원본은 404여야 합니다.
- 엔진을 해제하고 다시 연결한 뒤 `init_db`를 재실행해도 Subject·Document 목록과 원본을 다시 조회할 수 있어야 합니다.
- 설정된 frontend origin의 CORS preflight는 허용되고, 그 밖의 origin에는 `Access-Control-Allow-Origin`이 없어야 합니다.

### Subject API (`backend/tests/test_subjects.py`)

- 과목이 없으면 `GET /subjects`가 200과 `[]`를 반환해야 합니다.
- 정상 `POST /subjects`는 201과 정수 `id`, `name`을 반환하고, 이후 목록에 포함되어야 합니다.
- 앞뒤 공백이 있는 이름은 제거된 값으로 저장·응답되어야 합니다.
- `name` 누락, `null`·숫자·배열, 빈 값, 공백만 있는 값, 101자는 422를 반환하고 저장되지 않아야 합니다. 100자는 성공해야 합니다.
- 같은 이름을 여러 번 생성할 수 있고, 서로 다른 ID가 발급되며 목록은 ID 오름차순이어야 합니다.
- 생성한 과목을 API와 별도의 세션으로 DB에서 조회할 수 있어야 합니다.

# 프론트엔드 테스트

- API 응답을 모의하여 목록 로딩·오류·재시도·빈 목록, 직접 URL 접근, 생성 실패와 입력 유지, 중복 제출 방지 및 서버 ID 이동을 확인합니다.
- 과목 카드 메뉴가 하나씩 열리고 바깥 클릭으로 닫히며, 삭제 버튼을 눌러도 과목이나 API 요청이 변경되지 않는지 확인합니다.
- 실제 백엔드와 프론트엔드를 실행해 과목을 생성하고 새로고침한 뒤, 백엔드를 재시작하여 목록과 과목 페이지가 유지되는지 확인합니다. 백엔드 연결 실패 시 오류와 재시도를 확인합니다.

Node 22 최신 패치(22.22.2 이상)를 사용하고 `frontend/`에서 실행합니다.

```sh
npm ci
npm test
npm run build
npm run lint
```

## 검증 기준

- `VITE_API_BASE_URL` 설정 시 해당 주소를 사용하고, 미지정 또는 빈 값이면 `http://127.0.0.1:8000`을 사용해야 합니다. 테스트에서는 환경변수를 임시로 설정하고 복원합니다.
- TypeScript 검사와 Vite 빌드, Oxlint 검사가 성공해야 합니다.
- 실제 화면 확인에는 백엔드 실행이 필요합니다.

# Docker 검증

Docker 실행과 데이터 보존 규칙은 [Docker 문서](DOCKER.md)를 참고합니다. 호스트에 맞는 Python·Node가 없으면 테스트도 컨테이너에서 실행합니다.

```sh
docker compose config --quiet
docker compose run --rm --no-deps backend uv run --locked pytest
docker compose run --rm --no-deps frontend npm test
docker compose run --rm --no-deps frontend npm run build
docker compose run --rm --no-deps frontend npm run lint
```

### 백엔드 시작 시 DB 초기화

- 테스트 명령은 이미지의 기본 명령을 대체하므로 pytest만 실행하고 개발 DB를 초기화하지 않습니다. 새 격리 볼륨을 사용하려면 고유한 `COMPOSE_PROJECT_NAME`을 지정합니다.
- `docker compose up --build -d` 후 `docker compose ps`에서 서비스를 확인하고, 다음 명령으로 `subjects` 테이블이 준비됐는지 확인합니다.

  ```sh
  docker compose exec backend uv run python -c "from sqlalchemy import inspect; from backend.app.database import engine; assert 'subjects' in inspect(engine).get_table_names()"
  ```

- `POST /subjects`로 과목을 만들고 `GET /subjects`에서 확인합니다. `docker compose down` 후 같은 프로젝트를 다시 시작하고 해당 과목이 유지되는지 확인합니다. 이어서 `docker compose restart backend`를 실행하고 다시 `GET /subjects`를 호출해 데이터 보존과 초기화 재실행을 확인합니다.
- 실패 동작은 격리 프로젝트에서 다음 명령으로 확인합니다. 명령이 실패 상태로 끝나고 초기화 오류를 출력하며 Uvicorn은 시작하지 않아야 합니다.

  ```sh
  docker compose run --rm --no-deps -e DATABASE_PATH=/proc/issue18-check.db backend
  ```

- 검증 후에는 격리된 프로젝트의 리소스만 `docker compose down --volumes`로 제거합니다.

### PDF 업로드 영속성

- 고유한 `COMPOSE_PROJECT_NAME`으로 새 볼륨을 사용합니다. 로컬 개발 서버와 포트가 겹치면 `BACKEND_PORT`·`FRONTEND_PORT`를 바꿉니다.
- `docker compose up --build -d --wait` 후 위 테이블 확인 명령에서 `documents`도 목록에 있어야 합니다.
- `POST /subjects` → `POST /documents`(multipart)로 실제 PDF를 올려 201을 확인하고, `docker compose exec backend ls -la /data/uploads`에 UUID 이름의 파일이 생겼는지 확인합니다.
- `GET /documents?subject_id=…`, `GET /documents/{id}`, `GET /documents/{id}/file`(바이트 일치, `application/pdf`)을 확인합니다. 설정된 frontend origin의 CORS preflight가 허용되는지도 확인합니다.
- `docker compose down` 후 같은 프로젝트로 다시 `up`, 이어서 `docker compose restart backend` 후에도 목록·메타데이터·원본이 유지되어야 합니다.
- `FRONTEND_PORT`를 바꿔 `docker compose config`의 `CORS_ALLOWED_ORIGINS` 기본값이 같은 포트로 바뀌는지 확인합니다.

## fresh clone 검증

1. 검증 대상 변경을 포함한 커밋을 새로운 폴더에 clone하고 해당 작업 브랜치를 checkout합니다. clone에 `.env`, `.venv`, `frontend/node_modules`, 로컬 DB가 없는지 확인합니다. 기존 작업 폴더의 파일을 복사해 검증을 대신하지 않습니다.
2. 다른 실행 환경과 분리하려면 `COMPOSE_PROJECT_NAME`을 검증용 고유 이름으로 지정합니다. 기본 포트가 비어 있는 상태에서 `docker compose up --build`를 실행합니다.
3. `docker compose ps`에서 두 서비스가 healthy인지 확인합니다. `curl -fsS http://127.0.0.1:8000/health`가 `{"status":"ok"}`를 반환하고 frontend 루트 페이지가 HTTP 200인지 확인합니다.
4. 브라우저에서 `http://127.0.0.1:5173`을 열어 `App` 제목과 콘솔 오류 여부를 확인합니다. 검증용 clone에서 frontend 제목을 임시 변경하고 브라우저를 새로고침하지 않아도 반영되는지 확인한 후 복원합니다. backend에 임시 검증 endpoint를 추가해 자동 재시작 후 응답을 확인하고 복원합니다.
5. backend 컨테이너에서 SQLAlchemy로 `SELECT 1`을 실행하고 검증용 테이블·데이터를 `/data/app.db`에 기록합니다. `docker compose down` 후 같은 프로젝트로 다시 실행해 기록을 읽을 수 있는지 확인합니다. `/health` 결과를 DB 검증으로 대체하지 않습니다.
6. `BACKEND_PORT`와 `FRONTEND_PORT`를 다른 값으로 지정해 `docker compose config`의 포트와 기본 `VITE_API_BASE_URL`을 확인합니다. 명시적인 API URL도 반영되는지 확인합니다.
7. 검증한 커밋, Docker·Compose·Python·Node 버전과 실행 결과를 기록합니다. 검증용 프로젝트에 대해서만 `docker compose down --volumes`로 데이터를 정리합니다. Windows·macOS에서 직접 확인하지 않았다면 해당 검증은 미수행으로 보고합니다.

## 직접 검증 기록: PDF 업로드 (2026-11-01)

- Windows 11, Docker Desktop(Engine 29.9.2), Compose 5.6.1, 검증 프로젝트 `issue17-check`, `BACKEND_PORT=18000`, `FRONTEND_PORT=15173`에서 확인했습니다.
- `docker compose config --quiet` 통과. 기본 `CORS_ALLOWED_ORIGINS`가 `FRONTEND_PORT`(5173, 3000, 15173)를 따르는 것을 확인했습니다.
- 컨테이너 pytest 127개 통과(기존 httpx 사용 중단 예정 경고 1건).
- 새 볼륨으로 `up --build -d --wait` 후 두 서비스 healthy, 테이블 `documents`·`subjects` 생성을 확인했습니다.
- HTTP로 과목 생성 → PDF 업로드 201(page_count 1) → 목록·원본 바이트 일치·`application/pdf`를 확인했고 `/data/uploads`에 UUID 파일 1개가 생성됐습니다. `127.0.0.1:15173` origin의 CORS 허용을 확인했습니다.
- `down` 후 `up`, `restart backend` 후에도 목록과 원본 바이트가 유지됐습니다. 검증 후 `issue17-check` 프로젝트만 `down --volumes`로 정리했습니다.
- fresh clone 검증과 macOS 실행은 수행하지 않았습니다.

## 직접 검증 기록 (2026-10-01)

- Linux x86_64, Docker 29.8.1, Compose 5.5.1, 컨테이너 Python 3.14.7 / uv 0.11.1 / Node 22.23.3에서 확인했습니다.
- 작업 브랜치와 스테이징 상태를 변경하지 않고 임시 저장소에 구현 스냅샷 `f3291dc0679e6ced09209984d179b2aa30a24c5e`를 커밋한 뒤, 그 저장소를 다시 fresh clone해 실행했습니다. 검증용 프로젝트는 `school-docker-check-kj2pan6g`입니다. `.env`, `.venv`, `frontend/node_modules`, 로컬 DB가 없는 상태에서 `docker compose up --build`가 성공했습니다.
- 두 서비스 healthy, 호스트에서 frontend HTTP 200과 `/health`의 HTTP 200·`{"status":"ok"}`를 확인했습니다. 브라우저의 `App` 표시, API 설정값, 초기 실행과 HMR 검증 중 콘솔 오류·경고 0건을 확인했습니다.
- frontend 제목 수정·복원이 페이지 새로고침 없이 HMR로 반영됐고, backend 임시 endpoint 추가·제거가 자동 재시작으로 반영됐습니다. 검증 후 임시 소스 변경은 모두 복원했습니다.
- `/data/app.db`에서 SQLAlchemy `SELECT 1`과 기록·커밋이 성공했습니다. `down` 후 `up --build --detach --wait`로 컨테이너를 재생성한 뒤 같은 기록과 두 서비스 healthy 상태를 확인했습니다.
- 기본값, 포트 변경, 명시적인 API URL, 빈 환경변수 처리를 `docker compose config`로 확인했습니다. Windows·macOS 직접 실행은 미검증입니다.
- 자료 업로드 변경 시 다중 파일 선택·드롭, 주차 검증, 파일별 성공·실패와 재시도, 실제 목록 갱신을 확인한다. 실제 브라우저와 서버에서 업로드 및 새로고침 후 목록도 확인한다.

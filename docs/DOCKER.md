# Docker 개발 환경

React/Vite와 FastAPI/Uvicorn을 개발 서버로 실행합니다. 운영용 배포 구성이 아니며, 현재 화면은 `App` 제목만 표시합니다. PDF 업로드와 OCR은 아직 구현되지 않았으므로 Tesseract와 업로드 저장소는 이번 구성에 포함하지 않습니다.

## 실행과 종료

Docker Engine 또는 Docker Desktop을 실행하고 Docker Compose를 사용할 수 있어야 합니다. `docker info`와 `docker compose version`으로 확인합니다. 최초 빌드에는 이미지와 의존성을 내려받을 인터넷 연결이 필요합니다. 호스트의 Python·Node 설치는 필요하지 않습니다.

fresh clone 후 저장소 루트에서 실행합니다. `.env`는 선택 사항입니다.

```sh
docker compose up --build
```

| 서비스 | 호스트 주소 | 컨테이너 포트 |
| --- | --- | --- |
| frontend | http://127.0.0.1:5173 | 5173 |
| backend | http://127.0.0.1:8000 | 8000 |

frontend는 backend의 healthcheck가 성공한 뒤 시작합니다. `docker compose ps`에서 두 서비스의 `healthy` 상태를 확인할 수 있습니다. `GET /health`는 HTTP 200과 `{"status":"ok"}`를 반환하며 DB 연결은 확인하지 않습니다. frontend healthcheck는 루트 페이지의 HTTP 200을 확인합니다. 두 서버는 컨테이너 내부에서는 `0.0.0.0`으로 실행하고, 호스트에는 `127.0.0.1`로만 공개합니다.

`Ctrl+C`로 서버를 종료하고 아래 명령으로 컨테이너와 네트워크를 정리합니다. SQLite 볼륨은 유지됩니다.

```sh
docker compose down
```

## 환경변수

기본 설정으로 실행할 때는 파일 복사가 필요하지 않습니다. 설정을 바꾸려면 저장소 루트에서 `cp .env.example .env`를 실행하고 `.env`를 편집합니다. 실제 `.env`는 Git과 이미지에서 제외됩니다.

| 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `FRONTEND_PORT` | `5173` | 호스트의 frontend 포트 |
| `BACKEND_PORT` | `8000` | 호스트의 backend 포트 |
| `VITE_API_BASE_URL` | `http://127.0.0.1:<BACKEND_PORT>` | 브라우저에서 사용할 API 주소; 비워 두면 기본값 사용 |

Compose는 이 값을 컨테이너 환경변수로 전달합니다. 브라우저는 Docker 내부 서비스 이름인 `backend`를 해석하지 못하므로 브라우저용 URL에는 호스트 주소를 사용합니다. `VITE_` 변수는 클라이언트에 노출되므로 비밀 값을 넣지 않습니다. 환경변수를 변경한 뒤에는 `docker compose up --build`를 다시 실행해 컨테이너를 재생성합니다. 포트가 이미 사용 중이면 다른 포트로 변경합니다.

Docker 없이 frontend를 실행할 때 사용하는 `frontend/.env.local`과 루트 `.env`는 별개입니다. Docker의 frontend 환경변수는 Compose에서 전달하며 로컬 `.env.local`은 이미지에 복사하지 않습니다.

## 소스 변경과 의존성

- backend는 `backend/`를 읽기 전용 bind mount하고 Uvicorn `--reload`로 변경을 반영합니다.
- frontend는 `src/`, `index.html`, `vite.config.ts`를 읽기 전용 bind mount합니다. 소스는 Vite HMR로 반영되며 Vite 설정 변경 시 개발 서버가 재시작됩니다.
- 컨테이너에서 생성한 `.venv`와 `node_modules`는 호스트와 공유하지 않습니다. Python 3.14와 uv 0.11.1, Node 22 최신 패치 계열 이미지를 사용하며 `uv.lock`과 `package-lock.json`으로 의존성을 설치합니다.
- 의존성, 잠금 파일, TypeScript 설정, Dockerfile을 변경하면 `docker compose up --build`로 다시 빌드합니다. 이후 frontend에 `public/` 등 새로운 소스 디렉터리를 추가하면 mount 설정도 함께 추가해야 합니다.

Windows/WSL2의 파일 변경 감지를 위해 Compose에서는 Vite polling과 `WATCHFILES_FORCE_POLLING=true`를 사용합니다. Vite polling 간격은 1초입니다. Docker 없이 실행할 때 Vite polling은 기본적으로 비활성화됩니다.

## SQLite 데이터

backend 컨테이너의 `DATABASE_PATH`는 `/data/app.db`이며 `/data`에 Compose 프로젝트별 `backend_data` named volume을 연결합니다. 최초 DB 연결 시 파일이 생성됩니다. `/health` 호출만으로는 파일이 생성되지 않습니다. `down`이나 이미지 재빌드 후에도 동일한 Compose 프로젝트로 실행하면 데이터가 유지됩니다.

Docker 없이 실행할 때 `DATABASE_PATH`가 미지정 또는 빈 값이면 기존 `backend/app.db`를 사용합니다. 사용자 지정 경로를 사용하는 경우 상위 디렉터리를 미리 생성해야 합니다. 기존 로컬 DB는 Docker 볼륨으로 자동 복사하지 않습니다. 프로젝트 이름이나 실행 폴더 이름이 바뀌면 다른 볼륨을 사용할 수 있습니다.

데이터까지 초기화하려는 경우에만 다음 명령을 실행합니다. **해당 Compose 프로젝트의 SQLite 데이터가 삭제됩니다.**

```sh
docker compose down --volumes
```

검증 절차는 [테스트 문서](TESTING.md)를 참고합니다.

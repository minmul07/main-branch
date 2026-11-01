# 프론트엔드 개발 안내

React + TypeScript + Vite 기반의 프론트엔드입니다. 과목 목록과 생성에는 백엔드가 필요합니다.

PDF 원문 렌더링을 위해 Mozilla PDF.js의 배포 패키지 `pdfjs-dist`를 런타임 의존성으로 설치합니다. 패키지에는 TypeScript 선언이 포함됩니다. 현재는 의존성만 준비되어 있으며 원문 뷰어와 worker 연결은 아직 구현되지 않았습니다.

## 내 수업 화면

- `GET /subjects`로 과목을 불러와 카드로 표시하며 로딩, 빈 목록, 오류와 재시도를 지원합니다. 직접 과목 주소로 진입할 때도 조회가 완료된 후 과목을 확인합니다.
- 과목 카드를 클릭하면 `/subjects/:id`로 이동합니다. 브라우저 뒤로 가기와 과목 페이지의 `내 수업` 버튼은 목록으로 돌아갑니다. 자료 선택 시 파일 정보가 표시됩니다.
- 과목 카드의 점 3개 메뉴에 삭제 버튼을 표시합니다. 과목 삭제 API가 없어 버튼을 눌러도 아무 동작을 하지 않습니다. 메뉴는 한 번에 하나만 열리고 바깥을 클릭하면 닫힙니다.
- `수업 추가` 팝업에서 앞뒤 공백을 제거한 1~100자 이름을 `POST /subjects`로 전송합니다. 중복 이름을 허용하며 성공 시 서버 ID로 이동합니다. 요청 중 중복 제출과 닫기를 막고 실패 시 입력값과 오류를 유지합니다.
- 화면 제목은 `내 수업`입니다. 버튼 모서리 반경은 기존의 절반으로, 상단 추가 버튼 12px, 폼 제출 버튼 6px, 점 메뉴 버튼 25%입니다.
- 좁은 화면에서는 과목 카드가 한 열로 배치됩니다. 실제 PDF 원문 열기는 아직 포함하지 않습니다.

## 실행

Node 22 최신 패치(22.22.2 이상)와 npm을 사용합니다. nvm 사용 시 `frontend/`에서 `nvm install`과 `nvm use`로 `.nvmrc`의 버전을 선택할 수 있습니다.

```sh
cd frontend
npm ci
npm run dev
```

개발 서버는 기본적으로 `http://localhost:5173`에서 실행됩니다.

Docker에서는 저장소 루트에서 `docker compose up --build`로 실행합니다. Node와 의존성은 이미지 안에 설치되며 `src/` 변경은 HMR로 반영됩니다. Docker 환경에서는 파일 감지를 위해 1초 간격 polling을 사용하고, 로컬 실행에서는 기본적으로 사용하지 않습니다. 구성과 재빌드 기준은 [Docker 문서](DOCKER.md)를 참고합니다.

## API 주소

환경별 API 주소는 선택적으로 `frontend/.env.local`에 설정합니다. 아래 명령은 `frontend/`에서 실행합니다.

```sh
cp .env.example .env.local
```

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
```

공통 설정인 `frontend/src/config.ts`의 `API_BASE_URL`을 사용합니다. 환경변수가 없거나 빈 문자열이면 `http://127.0.0.1:8000`을 사용합니다. 변경 후에는 개발 서버를 재시작하고, 빌드 결과에 반영하려면 다시 빌드합니다. `.env.local`은 Git에서 제외됩니다. `VITE_` 환경변수는 클라이언트에 노출되므로 비밀 값을 넣지 않습니다.

Docker Compose는 루트의 선택적인 `.env` 설정을 사용합니다. `VITE_API_BASE_URL`이 미지정 또는 빈 값이면 `http://127.0.0.1:<BACKEND_PORT>`를 전달합니다. Docker 없이 실행하는 경우의 기본값 `http://127.0.0.1:8000`은 유지됩니다. `frontend/.env.local`은 Docker 이미지에 포함하지 않습니다.

## 검증

아래 명령은 `frontend/`에서 실행합니다.

```sh
npm test
npm run test:watch
npm run build
npm run lint
```

Vitest와 jsdom, React Testing Library로 테스트합니다. 검증 기준은 [테스트 문서](TESTING.md)를 참고합니다.
- 자료 페이지는 `GET /documents?subject_id=`로 실제 목록을 조회하며 로딩, 빈 목록, 오류 재시도를 제공합니다.
- 자료 추가 팝업에서 PDF를 여러 개 선택하거나 드롭하고 파일별 양의 정수 주차를 입력합니다. 파일별 POST 결과를 표시하며 실패 항목만 재시도합니다. 모든 파일이 업로드되면 업로드 버튼 대신 파란 닫기 버튼을 표시합니다. 네트워크 실패 후 재시도는 중복 등록될 수 있습니다. PDF 원문 뷰어는 아직 제공하지 않습니다.

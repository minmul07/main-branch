# 프론트엔드 개발 안내

React + TypeScript + Vite 기반의 최소 프론트엔드입니다. 현재는 `App` 제목만 표시하며, 백엔드가 실행되지 않아도 화면을 확인할 수 있습니다.

## 실행

Node 22 최신 패치(22.22.2 이상)와 npm을 사용합니다. nvm 사용 시 `frontend/`에서 `nvm install`과 `nvm use`로 `.nvmrc`의 버전을 선택할 수 있습니다.

```sh
cd frontend
npm ci
npm run dev
```

개발 서버는 기본적으로 `http://localhost:5173`에서 실행됩니다.

## API 주소

환경별 API 주소는 선택적으로 `frontend/.env.local`에 설정합니다. 아래 명령은 `frontend/`에서 실행합니다.

```sh
cp .env.example .env.local
```

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
```

공통 설정인 `frontend/src/config.ts`의 `API_BASE_URL`을 사용합니다. 환경변수가 없거나 빈 문자열이면 `http://127.0.0.1:8000`을 사용합니다. 변경 후에는 개발 서버를 재시작하고, 빌드 결과에 반영하려면 다시 빌드합니다. `.env.local`은 Git에서 제외됩니다. `VITE_` 환경변수는 클라이언트에 노출되므로 비밀 값을 넣지 않습니다.

현재 화면에서는 API 요청을 수행하지 않습니다.

## 검증

아래 명령은 `frontend/`에서 실행합니다.

```sh
npm test
npm run test:watch
npm run build
npm run lint
```

Vitest와 jsdom, React Testing Library로 테스트합니다. 검증 기준은 [테스트 문서](TESTING.md)를 참고합니다.

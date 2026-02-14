# dashboard-web 전용 저장소 분리/배포 가이드

모노레포 webhook 충돌을 피하기 위해 `dashboard-web`만 별도 저장소로 배포합니다.

## 1) 로컬 분리 폴더

- 기본 타깃: `deploy/dashboard-web-standalone`
- 동기화 스크립트:

```bash
bash traders/coin/scripts/sync_dashboard_standalone.sh
```

동작:
- `traders/coin/dashboard-web` → `deploy/dashboard-web-standalone` 미러링
- 제외: `.next`, `node_modules`, `.env.local`, `.vercel`, `.git`

## 2) 전용 repo 초기화/연결

```bash
cd deploy/dashboard-web-standalone
git init
git checkout -b main
git remote add origin git@github.com:wo-ong-dev/openclaw-dashboard-web.git
```

## 3) 첫 배포 푸시

```bash
npm install
npm run build
git add -A
git commit -m "chore: initial dashboard-web split"
git push -u origin main
```

## 4) 이후 운영 플로우 (권장)

### A. 수동 3단계

```bash
# monorepo 루트에서
bash traders/coin/scripts/sync_dashboard_standalone.sh
cd deploy/dashboard-web-standalone
git add -A && git commit -m "chore: sync dashboard-web" && git push origin main
```

### B. 원커맨드(sync+commit)

```bash
bash traders/coin/scripts/sync_dashboard_standalone_commit.sh
# 마지막 push만 수동
cd deploy/dashboard-web-standalone && git push origin main
```

## 5) Vercel 연결 포인트

- Import Git Repository: `wo-ong-dev/openclaw-dashboard-web`
- Framework: Next.js (자동)
- Build Command: `npm run build`
- Output: `.next`
- Env:
  - `NEXT_PUBLIC_DASHBOARD_API_BASE=https://<dashboard-api-domain>` (권장)

## 6) 롤백 노트

### 빠른 롤백 (Git)

```bash
cd deploy/dashboard-web-standalone
git log --oneline -n 5
git revert <bad_commit_sha>
git push origin main
```

### 강제 되돌리기(주의)

```bash
cd deploy/dashboard-web-standalone
git reset --hard <good_commit_sha>
git push --force-with-lease origin main
```

## 7) 문제 진단 체크

- 동기화 누락: `git status`가 비정상이면 다시 `sync_dashboard_standalone.sh` 실행
- 빌드 실패: `npm ci && npm run build`로 재검증
- webhook 미반응: Vercel 프로젝트가 전용 repo에 연결됐는지 확인

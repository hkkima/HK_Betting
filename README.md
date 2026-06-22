# ♟️ 체스 베팅판 (HK_Betting)

체스 16강 토너먼트 대진을 보고 **가상 포인트**를 거는 베팅판. 24명 규모, 수업용.
**패리뮤추얼**(역/정배 풀 분배) 정산. GitHub Pages(프론트) + Firebase/Firestore(백), **무료 Spark 플랜** 내 동작.

설계 전문: [`docs/DESIGN.md`](docs/DESIGN.md)

## 동작 구조 (호출 최소화)

- 느린 **구조**(`meta/board`)와 빠른 **풀**(`markets/{id}`)을 분리 → 사용자당 실시간 리스너 3개(board 1 + 열린 마켓 N + 본인 user 1), polling 0.
- 베팅 = `balance↓ + bet 생성 + pool↑`를 **트랜잭션 1개**로 원자 처리.
- 정산 = 운영자가 결과 입력 시 `bets` 한 번 읽고 승자 환급을 **batch 1개**로. Cloud Functions 불필요.
- 무결성: `balance 증가는 운영자만`(포인트 인플레 차단) — `firestore.rules`.

## 실행

```bash
npm install
npm run dev      # http://localhost:5190
npm test         # 패리뮤추얼 정산 단위 테스트
npm run build    # 정적 빌드
```

`.env` 없이도 UI 미리보기는 뜸(베팅은 Firebase 필요).

## Firebase 켜기

1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트+웹앱 → `firebaseConfig` 6개 값
2. **Firestore Database** 생성 + **Authentication → 익명, Google** 둘 다 켜기
3. `.env.example` → `.env` 복사 후 값 채우기
4. `firestore.rules`의 `isAdmin()` 이메일 화이트리스트에 본인 구글 계정 넣고 배포
   (`firebase deploy --only firestore:rules` 또는 콘솔에 붙여넣기)
5. `npm run dev`

## 배포 (GitHub Pages)

- 리포명을 `HK_Betting`로 두면 `vite.config.js`의 base(`/HK_Betting/`)와 일치.
- GitHub 저장소 **Settings → Secrets**에 `VITE_FIREBASE_*`, `VITE_ADMIN_EMAILS` 등록.
- `main` 푸시 시 `.github/workflows/deploy.yml`가 자동 빌드·배포.

## 운영 흐름

1. 운영자 구글 로그인 → **운영자** 탭
2. **참가자 발급**(이름·PIN·시작 포인트) 24명
3. **매치 마켓 추가**(라운드/제목/선수 A·B) → 16강 8경기 등
4. **라운드 오픈** → 참가자가 베팅 → 경기 끝나면 **A승/B승**으로 정산
5. **리더보드**에서 잔액 순위 확인

## 구조

```
src/
  domain/payout.js      패리뮤추얼 정산(순수, 테스트)
  data/firebase.js      Firebase 초기화·인증
  data/store.js         Firestore 계층(구독/베팅/정산/운영)
  auth/auth.js          이름→userId, PIN 해시
  state/AppContext.jsx  세션·board 구독
  pages/                BoardPage / AdminPage / LeaderboardPage / LoginPage
```

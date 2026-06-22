# 체스 베팅판 — 설계

체스 16강 토너먼트 대진을 보고 **가상 포인트**를 베팅하는 웹앱.
24명 참가, GitHub Pages(프론트) + Firebase/Firestore(백). **무료 Spark 플랜** 내 동작.

## 0. 핵심 결정

| 항목 | 결정 |
|---|---|
| 배당 | **패리뮤추얼** (풀 분배, 역/정배 비율로 배당 자동 형성) |
| 식별 | 이름 + PIN (참가자), 구글 로그인 (운영자) |
| 베팅 단위 | 라운드 단위 기본 + **마켓 일반화**로 승점·브래킷 예측 등 확장 |
| 포인트 | 운영진 수동 지급 |
| 정산 주체 | 운영자 브라우저의 클라이언트 트랜잭션 (Cloud Functions 불필요) |

## 1. 데이터 모델 (Firestore)

느리게 바뀌는 **구조**와 빠르게 바뀌는 **풀**을 분리 → 호출 최소화.

```
users/{userId}                 { name, pinHash, balance }
meta/board                     { bracket, markets:[{id,title,round,type,status,result}] }
markets/{marketId}             { type, round, title, options:[{id,label}],
                                 status:'draft'|'open'|'locked'|'resolved',
                                 result, pools:{ [optId]:{stake,count} } }
markets/{marketId}/bets/{userId}  { option, stake, at }
```

- 라운드 UX = 같은 `round` 태그 마켓들을 함께 open/lock.
- 새 베팅 종류 = `type`만 다른 마켓 추가. 정산 로직은 공용.
- **정산의 진실 원천은 bets 서브컬렉션.** `pools`는 라이브 배당 표시용 캐시.

## 2. 호출 최소화 — 사용자당 리스너 3개

| 구독 | 개수 | 갱신 |
|---|---|---|
| `meta/board` | 1 | 운영진 대진/상태 변경 시 |
| 열린 `markets/{id}` | 1~N | 베팅으로 풀 변할 때 (라이브 배당) |
| 본인 `users/{uid}` | 1 | 본인 베팅/정산 시 |

polling 0회. 한 토너먼트(24명×약 6마켓) 전체 읽기·쓰기가 무료 한도(읽기 50k·쓰기 20k/일)의 5% 미만.

## 3. 패리뮤추얼 정산

```
총풀   = Σ 모든 베팅 stake
승자풀 = Σ 이긴 옵션 stake
환급(승자) = floor( stake × 총풀 / 승자풀 )     # 원금 포함, 역배일수록 고배당
```

- 엣지: 베팅 0건 → 정산 없음. 이긴 쪽 0명 → 전원 원금 환불(무효).
- 운영자가 결과 입력 → bets 1회 읽고 → 승자 balance 가산 + 마켓 resolved 를 **batch 1회** 원자 처리. 베팅은 정산 전 `locked` 라 경합 없음.
- 라운드 끝수(반올림 손실분)는 미할당(소멸).

## 4. 무결성 (보안 규칙)

`firestore.rules` 참조. 요지:
- **balance 증가는 운영자만** → 포인트 인플레이션 차단(핵심).
- 참가자는 본인 balance 를 stake 만큼 감소시키며 베팅 생성(같은 트랜잭션, `getAfter`로 검증).
- 마켓 status/result 변경은 운영자만. 참가자는 열린 마켓 pools(표시용)만 터치.
- 운영자 = 구글 로그인 이메일 화이트리스트(또는 custom claim).
- 잔여 리스크: 참가자가 *타인* balance 를 감소(griefing)시키는 경우는 막지 않음(가시적·캐주얼 수업 범위). 강화 시 custom claim + 본인 uid 매칭 또는 Cloud Function.

## 5. 화면

- **베팅판**(참가자): 대진표 + 라운드별 라이브 역/정배 + 내 잔액/베팅
- **운영자 패널**: 대진 입력 → 마켓 open/lock → 결과 입력(=정산) → 포인트 지급
- **리더보드**: 잔액 순위

## 6. 스택 / 배포

Vite + React + Firebase v10. GitHub Pages(`/HK_Betting/` base) 자동 배포(`.github/workflows/deploy.yml`).
Firebase 콘솔: Firestore 생성 + Authentication(익명 + Google) 켜기. 시크릿은 GitHub Actions secrets.

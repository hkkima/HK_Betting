// 패리뮤추얼 정산 — 순수 함수 (Firebase 비의존, 단위 테스트 대상)

/**
 * 한 마켓을 정산해 사용자별 환급액(원금 포함, 정수)을 계산.
 * @param {Array<{userId:string, option:string, stake:number}>} bets
 * @param {string} winningOption
 * @returns {{payouts:Object<string,number>, totalPool:number, winnersStake:number, voided:boolean, leftover:number}}
 *   payouts: 환급액 맵(이긴 사람만). 진 사람은 0(맵에 없음).
 *   voided: 이긴 쪽 베팅 0명이라 전원 원금 환불한 경우 true.
 *   leftover: 정수 반올림으로 미할당된 소멸 포인트.
 */
export function settleMarket(bets, winningOption) {
  const totalPool = bets.reduce((s, b) => s + b.stake, 0);
  const winners = bets.filter((b) => b.option === winningOption);
  const winnersStake = winners.reduce((s, b) => s + b.stake, 0);

  // 베팅이 아예 없음
  if (totalPool === 0) {
    return { payouts: {}, totalPool: 0, winnersStake: 0, voided: false, leftover: 0 };
  }
  // 이긴 쪽 베팅 0명 → 전원 원금 환불(무효)
  if (winnersStake === 0) {
    const payouts = {};
    for (const b of bets) payouts[b.userId] = (payouts[b.userId] || 0) + b.stake;
    return { payouts, totalPool, winnersStake: 0, voided: true, leftover: 0 };
  }
  // 패리뮤추얼: 환급 = floor(stake × 총풀 / 승자풀)
  const payouts = {};
  let paid = 0;
  for (const b of winners) {
    const amount = Math.floor((b.stake * totalPool) / winnersStake);
    payouts[b.userId] = (payouts[b.userId] || 0) + amount;
    paid += amount;
  }
  return { payouts, totalPool, winnersStake, voided: false, leftover: totalPool - paid };
}

/**
 * 표시용 라이브 배당률: 옵션별 예상 배당 = 총풀 / 해당옵션풀.
 * @param {Object<string, {stake:number}>} pools  마켓 문서의 pools
 * @returns {Object<string, number|null>}  배당 배수(소수 2자리). 베팅 없으면 null.
 */
export function liveOdds(pools) {
  const total = Object.values(pools).reduce((s, p) => s + (p?.stake || 0), 0);
  const odds = {};
  for (const [opt, p] of Object.entries(pools)) {
    const stake = p?.stake || 0;
    odds[opt] = stake > 0 ? Math.round((total / stake) * 100) / 100 : null;
  }
  return odds;
}

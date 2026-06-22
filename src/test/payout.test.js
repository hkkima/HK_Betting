import { describe, it, expect } from 'vitest';
import { settleMarket, liveOdds } from '../domain/payout.js';

describe('settleMarket (패리뮤추얼)', () => {
  it('정배/역배 비율대로 분배한다 (원금 포함)', () => {
    // A에 300(2명), B에 100(1명). B가 이김 → 총풀400을 B풀100 비례로.
    const bets = [
      { userId: 'a1', option: 'A', stake: 200 },
      { userId: 'a2', option: 'A', stake: 100 },
      { userId: 'b1', option: 'B', stake: 100 },
    ];
    const r = settleMarket(bets, 'B');
    expect(r.totalPool).toBe(400);
    expect(r.winnersStake).toBe(100);
    // b1: 100 × 400/100 = 400 (역배 4배)
    expect(r.payouts).toEqual({ b1: 400 });
    expect(r.voided).toBe(false);
  });

  it('같은 옵션 다수 승자는 stake 비례로 나눈다', () => {
    const bets = [
      { userId: 'w1', option: 'A', stake: 100 },
      { userId: 'w2', option: 'A', stake: 300 },
      { userId: 'l1', option: 'B', stake: 200 },
    ];
    const r = settleMarket(bets, 'A'); // 총풀600, 승자풀400
    expect(r.payouts.w1).toBe(150); // 100 × 600/400
    expect(r.payouts.w2).toBe(450); // 300 × 600/400
  });

  it('이긴 쪽 베팅이 없으면 전원 원금 환불(무효)', () => {
    const bets = [
      { userId: 'a1', option: 'A', stake: 100 },
      { userId: 'a2', option: 'A', stake: 50 },
    ];
    const r = settleMarket(bets, 'B');
    expect(r.voided).toBe(true);
    expect(r.payouts).toEqual({ a1: 100, a2: 50 });
  });

  it('베팅이 없으면 정산할 것이 없다', () => {
    const r = settleMarket([], 'A');
    expect(r.payouts).toEqual({});
    expect(r.totalPool).toBe(0);
  });

  it('나누어 떨어지지 않으면 내림하고 leftover 로 남긴다', () => {
    const bets = [
      { userId: 'w1', option: 'A', stake: 100 },
      { userId: 'w2', option: 'A', stake: 100 },
      { userId: 'l1', option: 'B', stake: 100 },
    ];
    const r = settleMarket(bets, 'A'); // 각 100 × 300/200 = 150 → 합300, leftover0
    expect(r.payouts.w1 + r.payouts.w2 + r.leftover).toBe(r.totalPool);
  });
});

describe('liveOdds', () => {
  it('총풀/옵션풀 배수를 준다', () => {
    const odds = liveOdds({ A: { stake: 300 }, B: { stake: 100 } });
    expect(odds.A).toBe(1.33); // 400/300
    expect(odds.B).toBe(4); // 400/100
  });
  it('베팅 없는 옵션은 null', () => {
    const odds = liveOdds({ A: { stake: 0 }, B: { stake: 0 } });
    expect(odds.A).toBeNull();
    expect(odds.B).toBeNull();
  });
});

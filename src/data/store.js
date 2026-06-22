// Firestore 데이터 계층.
// 호출 최소화 원칙: 구조(meta/board)와 라이브 풀(markets/{id})을 분리,
// 사용자당 리스너는 board 1 + 열린 마켓 N + 본인 user 1.

import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc,
  onSnapshot, runTransaction, writeBatch, query, where,
  serverTimestamp, increment,
} from 'firebase/firestore';
import { getFirebase } from './firebase.js';
import { settleMarket } from '../domain/payout.js';

const boardRef = () => doc(getFirebase().db, 'meta', 'board');
const userRef = (id) => doc(getFirebase().db, 'users', id);
const marketRef = (id) => doc(getFirebase().db, 'markets', id);
const betsCol = (mid) => collection(getFirebase().db, 'markets', mid, 'bets');

// ── 구독 ────────────────────────────────────────────────
export function subscribeBoard(cb) {
  return onSnapshot(boardRef(), (snap) => cb(snap.exists() ? snap.data() : null));
}
export function subscribeMarket(marketId, cb) {
  return onSnapshot(marketRef(marketId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}
export function subscribeUser(userId, cb) {
  return onSnapshot(userRef(userId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}
// 리더보드 전용(전체 users). 잔액 변할 때만 갱신.
export function subscribeUsers(cb) {
  const col = collection(getFirebase().db, 'users');
  return onSnapshot(col, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
// 내 베팅들(본인 마켓별 1건). 마켓 적을 땐 board 의 markets 로 순회 구독해도 됨.
export function subscribeMyBet(marketId, userId, cb) {
  return onSnapshot(doc(betsCol(marketId).firestore, 'markets', marketId, 'bets', userId), (snap) =>
    cb(snap.exists() ? snap.data() : null),
  );
}

// ── 참가자: 베팅 (원자 트랜잭션) ──────────────────────────
// user.balance ↓stake + bet 생성 + market.pools ↑ 를 한 번에. 1인 1마켓 1베팅.
export async function placeBet({ userId, marketId, option, stake }) {
  stake = Math.floor(Number(stake));
  if (!Number.isInteger(stake) || stake <= 0) throw new Error('베팅액은 1 이상 정수여야 합니다.');
  const { db } = getFirebase();
  await runTransaction(db, async (tx) => {
    const uRef = userRef(userId);
    const mRef = marketRef(marketId);
    const bRef = doc(db, 'markets', marketId, 'bets', userId);
    const [uSnap, mSnap, bSnap] = await Promise.all([tx.get(uRef), tx.get(mRef), tx.get(bRef)]);
    if (!uSnap.exists()) throw new Error('계정을 찾을 수 없습니다.');
    if (!mSnap.exists()) throw new Error('마켓을 찾을 수 없습니다.');
    if (bSnap.exists()) throw new Error('이미 이 마켓에 베팅했습니다.');
    const market = mSnap.data();
    if (market.status !== 'open') throw new Error('베팅이 마감된 마켓입니다.');
    if (!market.options?.some((o) => o.id === option)) throw new Error('잘못된 선택지입니다.');
    const balance = uSnap.data().balance || 0;
    if (stake > balance) throw new Error('잔액이 부족합니다.');

    const cur = market.pools?.[option] || { stake: 0, count: 0 };
    tx.set(bRef, { option, stake, at: serverTimestamp() });
    tx.update(uRef, { balance: balance - stake });
    tx.update(mRef, {
      [`pools.${option}.stake`]: cur.stake + stake,
      [`pools.${option}.count`]: cur.count + 1,
    });
  });
}

// ── 운영자: 정산 (결과 입력 → 패리뮤추얼 분배) ────────────
export async function resolveMarket({ marketId, winningOption }) {
  const { db } = getFirebase();
  const betsSnap = await getDocs(betsCol(marketId));
  const bets = betsSnap.docs.map((d) => ({ userId: d.id, ...d.data() }));
  const result = settleMarket(bets, winningOption);

  const board = (await getDoc(boardRef())).data() || { markets: [] };
  const markets = (board.markets || []).map((m) =>
    m.id === marketId ? { ...m, status: 'resolved', result: winningOption } : m,
  );

  const batch = writeBatch(db);
  for (const [userId, amount] of Object.entries(result.payouts)) {
    if (amount > 0) batch.update(userRef(userId), { balance: increment(amount) });
  }
  batch.update(marketRef(marketId), { status: 'resolved', result: winningOption });
  batch.set(boardRef(), { markets }, { merge: true });
  await batch.commit();
  return result; // { payouts, totalPool, winnersStake, voided, leftover }
}

// ── 운영자: 마켓/대진/포인트 관리 ────────────────────────
export async function ensureBoard() {
  const snap = await getDoc(boardRef());
  if (!snap.exists()) await setDoc(boardRef(), { bracket: {}, markets: [] });
  return (await getDoc(boardRef())).data();
}

export async function saveBracket(bracket) {
  await setDoc(boardRef(), { bracket }, { merge: true });
}

// 마켓 생성(또는 갱신). board.markets 미러도 함께.
export async function upsertMarket(market) {
  const { db } = getFirebase();
  const pools = Object.fromEntries((market.options || []).map((o) => [o.id, { stake: 0, count: 0 }]));
  const full = {
    type: market.type || 'match',
    round: market.round || '',
    title: market.title || '',
    options: market.options || [],
    status: market.status || 'draft',
    result: market.result ?? null,
    pools: market.pools || pools,
  };
  const board = (await getDoc(boardRef())).data() || { markets: [] };
  const exists = (board.markets || []).some((m) => m.id === market.id);
  const mirror = { id: market.id, title: full.title, round: full.round, type: full.type, status: full.status, result: full.result };
  const markets = exists
    ? board.markets.map((m) => (m.id === market.id ? mirror : m))
    : [...(board.markets || []), mirror];

  const batch = writeBatch(db);
  batch.set(marketRef(market.id), full, { merge: true });
  batch.set(boardRef(), { markets }, { merge: true });
  await batch.commit();
}

// 여러 마켓을 한 번에 생성(대진 일괄 입력). board 읽기 1 + 커밋 1로 호출 최소화.
export async function addMarketsBulk(markets) {
  const { db } = getFirebase();
  const board = (await getDoc(boardRef())).data() || { markets: [] };
  const mirrors = [...(board.markets || [])];
  const batch = writeBatch(db);
  for (const m of markets) {
    const pools = Object.fromEntries((m.options || []).map((o) => [o.id, { stake: 0, count: 0 }]));
    const full = {
      type: m.type || 'match', round: m.round || '', title: m.title || '',
      options: m.options || [], status: m.status || 'draft', result: m.result ?? null, pools,
    };
    batch.set(marketRef(m.id), full, { merge: true });
    const mirror = { id: m.id, title: full.title, round: full.round, type: full.type, status: full.status, result: full.result };
    const idx = mirrors.findIndex((x) => x.id === m.id);
    if (idx >= 0) mirrors[idx] = mirror; else mirrors.push(mirror);
  }
  batch.set(boardRef(), { markets: mirrors }, { merge: true });
  await batch.commit();
}

// 마켓 상태 변경(draft→open→locked). board 미러 동기화.
export async function setMarketStatus(marketId, status) {
  const { db } = getFirebase();
  const board = (await getDoc(boardRef())).data() || { markets: [] };
  const markets = (board.markets || []).map((m) => (m.id === marketId ? { ...m, status } : m));
  const batch = writeBatch(db);
  batch.update(marketRef(marketId), { status });
  batch.set(boardRef(), { markets }, { merge: true });
  await batch.commit();
}

// 라운드 통째 open/lock (라운드 단위 베팅 창).
export async function setRoundStatus(round, status) {
  const { db } = getFirebase();
  const q = query(collection(db, 'markets'), where('round', '==', round));
  const snap = await getDocs(q);
  const board = (await getDoc(boardRef())).data() || { markets: [] };
  const ids = new Set(snap.docs.map((d) => d.id));
  const markets = (board.markets || []).map((m) => (ids.has(m.id) ? { ...m, status } : m));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { status }));
  batch.set(boardRef(), { markets }, { merge: true });
  await batch.commit();
}

export async function createUser({ userId, name, pinHash, balance = 0 }) {
  await setDoc(userRef(userId), { name, pinHash, balance: Math.floor(balance) });
}

export async function getUser(userId) {
  const snap = await getDoc(userRef(userId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// 운영자 수동 포인트 지급/조정 (delta 가산).
export async function grantPoints(userId, delta) {
  await updateDoc(userRef(userId), { balance: increment(Math.floor(delta)) });
}

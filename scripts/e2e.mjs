// E2E 점검 스크립트 (참가자 측 구동 + 검증). 운영자 측은 라이브 UI에서 수동.
// 사용: node scripts/e2e.mjs <phase>
//   register      테스트 참가자 3명 가입(익명 인증, balance 0)
//   verify-setup  board 마켓 + 테스트 유저 잔액 읽기
//   rules-check   익명이 운영자 전용 쓰기(마켓 생성)를 시도 → 거부돼야 정상
//   bet           3명이 첫 8강 매치에 베팅(역/정배 형성)
//   verify-final <marketId> <winOpt>  최종 잔액을 settleMarket 기대값과 대조

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc,
  runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { hashPin } from '../src/auth/auth.js';
import { settleMarket } from '../src/domain/payout.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dir, '..', '.env'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }),
);

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);

// 테스트 참가자: [이름, PIN, 베팅옵션, 베팅액]
const TESTERS = [
  { name: '테스트_김베팅', pin: '1111', option: 'A', stake: 200 },
  { name: '테스트_이찍기', pin: '2222', option: 'A', stake: 100 },
  { name: '테스트_역배킹', pin: '3333', option: 'B', stake: 100 },
];
const uid = (name) => name.trim().toLowerCase().replace(/\s+/g, '_');

async function anon() { await signInAnonymously(getAuth(app)); }

async function register() {
  await anon();
  for (const t of TESTERS) {
    const ref = doc(db, 'users', uid(t.name));
    const snap = await getDoc(ref);
    if (snap.exists()) { console.log(`= 이미 존재: ${t.name} (잔액 ${snap.data().balance})`); continue; }
    await setDoc(ref, { name: t.name, pinHash: hashPin(t.pin), balance: 0 });
    console.log(`✅ 가입: ${t.name} (PIN ${t.pin}, 잔액 0)`);
  }
}

async function verifySetup() {
  const board = (await getDoc(doc(db, 'meta', 'board'))).data();
  console.log('— board.markets —');
  (board?.markets || []).forEach((m) => console.log(`  [${m.status}] ${m.round} · ${m.title} (${m.id})`));
  console.log('— 테스트 유저 잔액 —');
  for (const t of TESTERS) {
    const s = await getDoc(doc(db, 'users', uid(t.name)));
    console.log(`  ${t.name}: ${s.exists() ? s.data().balance : '(없음)'}`);
  }
}

async function rulesCheck() {
  await anon();
  // 1) 익명이 마켓 생성 시도 → 거부돼야 정상
  try {
    await setDoc(doc(db, 'markets', 'hacktest-market'), { type: 'match', status: 'open', options: [], pools: {} });
    console.log('❌ 보안 결함: 익명이 마켓을 생성함!');
  } catch (e) { console.log(`✅ 익명 마켓 생성 거부됨 (${e.code})`); }
  // 2) 익명이 balance>0 으로 유저 생성 시도 → 거부돼야 정상
  try {
    await setDoc(doc(db, 'users', 'hacktest-user'), { name: 'hack', pinHash: 'x', balance: 999999 });
    console.log('❌ 보안 결함: 익명이 포인트를 자가 발급함!');
  } catch (e) { console.log(`✅ 익명 포인트 자가발급 거부됨 (${e.code})`); }
}

async function firstOpenMarket() {
  const board = (await getDoc(doc(db, 'meta', 'board'))).data();
  const open = (board?.markets || []).find((m) => m.status === 'open');
  return open?.id || null;
}

async function placeBet(userId, marketId, option, stake) {
  await runTransaction(db, async (tx) => {
    const uRef = doc(db, 'users', userId);
    const mRef = doc(db, 'markets', marketId);
    const bRef = doc(db, 'markets', marketId, 'bets', userId);
    const [uSnap, mSnap, bSnap] = await Promise.all([tx.get(uRef), tx.get(mRef), tx.get(bRef)]);
    if (!uSnap.exists()) throw new Error('user 없음');
    if (bSnap.exists()) throw new Error('이미 베팅함');
    const m = mSnap.data();
    if (m.status !== 'open') throw new Error('마켓이 열려있지 않음');
    const bal = uSnap.data().balance || 0;
    if (stake > bal) throw new Error('잔액 부족');
    const cur = m.pools?.[option] || { stake: 0, count: 0 };
    tx.set(bRef, { option, stake, at: serverTimestamp() });
    tx.update(uRef, { balance: bal - stake });
    tx.update(mRef, { [`pools.${option}.stake`]: cur.stake + stake, [`pools.${option}.count`]: cur.count + 1 });
  });
}

async function bet() {
  await anon();
  const marketId = await firstOpenMarket();
  if (!marketId) { console.log('❌ 열린 마켓이 없습니다. 운영자가 라운드를 오픈했는지 확인하세요.'); return; }
  console.log(`대상 마켓: ${marketId}`);
  for (const t of TESTERS) {
    try {
      await placeBet(uid(t.name), marketId, t.option, t.stake);
      console.log(`✅ ${t.name} → ${t.option} ${t.stake}P`);
    } catch (e) { console.log(`❌ ${t.name}: ${e.message}`); }
  }
  const m = (await getDoc(doc(db, 'markets', marketId))).data();
  console.log('현재 풀:', JSON.stringify(m.pools));
}

async function verifyFinal(marketId, winOpt) {
  const betsSnap = await getDocs(collection(db, 'markets', marketId, 'bets'));
  const bets = betsSnap.docs.map((d) => ({ userId: d.id, ...d.data() }));
  const expected = settleMarket(bets, winOpt);
  console.log('— settleMarket 기대 환급 —', expected.payouts, `(총풀 ${expected.totalPool}, leftover ${expected.leftover}, voided ${expected.voided})`);
  console.log('— 실제 잔액 —');
  for (const t of TESTERS) {
    const s = await getDoc(doc(db, 'users', uid(t.name)));
    console.log(`  ${t.name}: ${s.exists() ? s.data().balance : '(없음)'}`);
  }
}

const phase = process.argv[2];
const run = { register, 'verify-setup': verifySetup, 'rules-check': rulesCheck, bet,
  'verify-final': () => verifyFinal(process.argv[3], process.argv[4]) }[phase];
if (!run) { console.log('phase: register | verify-setup | rules-check | bet | verify-final <marketId> <winOpt>'); process.exit(1); }
run().then(() => process.exit(0)).catch((e) => { console.error('ERR', e); process.exit(1); });

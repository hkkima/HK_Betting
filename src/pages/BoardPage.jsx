import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { subscribeMarket, subscribeMyBet, subscribeUser, placeBet } from '../data/store.js';
import { liveOdds } from '../domain/payout.js';

export default function BoardPage() {
  const { configured, board, session } = useApp();
  if (!configured) return <Placeholder />;
  if (!board) return <p className="muted">불러오는 중…</p>;

  const markets = board.markets || [];
  if (markets.length === 0) return <p className="muted">아직 등록된 베팅 마켓이 없습니다. 운영자가 대진/마켓을 추가하면 표시됩니다.</p>;

  // round 별 그룹
  const byRound = {};
  for (const m of markets) (byRound[m.round || '기타'] ||= []).push(m);

  return (
    <div>
      {session.role === 'participant' && <MyBalance userId={session.userId} />}
      {Object.entries(byRound).map(([round, ms]) => (
        <div key={round}>
          <div className="round-title">{round}</div>
          {ms.map((m) => <MarketCard key={m.id} marketId={m.id} session={session} />)}
        </div>
      ))}
    </div>
  );
}

function MyBalance({ userId }) {
  const [user, setUser] = useState(null);
  useEffect(() => subscribeUser(userId, setUser), [userId]);
  return (
    <div className="card row">
      <span>내 잔액</span>
      <span className="balance">{user ? user.balance.toLocaleString() : '…'} P</span>
    </div>
  );
}

function MarketCard({ marketId, session }) {
  const [market, setMarket] = useState(null);
  const [myBet, setMyBet] = useState(null);
  const [stake, setStake] = useState(100);
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeMarket(marketId, setMarket), [marketId]);
  useEffect(() => {
    if (session.role !== 'participant') return;
    return subscribeMyBet(marketId, session.userId, setMyBet);
  }, [marketId, session.role, session.userId]);

  if (!market) return null;
  const odds = liveOdds(market.pools || {});
  const canBet = session.role === 'participant' && market.status === 'open' && !myBet;

  async function submit() {
    setErr('');
    if (!sel) { setErr('선택지를 고르세요.'); return; }
    setBusy(true);
    try {
      await placeBet({ userId: session.userId, marketId, option: sel, stake: Number(stake) });
      setSel(null);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="market">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>{market.title}</h3>
        <span className={`pill ${market.status}`}>{statusLabel(market.status)}</span>
      </div>
      <div className="opts">
        {market.options.map((o) => {
          const pool = market.pools?.[o.id] || { stake: 0, count: 0 };
          const isWin = market.status === 'resolved' && market.result === o.id;
          const classes = ['opt'];
          if (sel === o.id && canBet) classes.push('sel');
          if (isWin) classes.push('win');
          return (
            <div key={o.id} className={classes.join(' ')} onClick={() => canBet && setSel(o.id)}>
              <div className="label">{o.label}</div>
              <div className="odds">{odds[o.id] != null ? `×${odds[o.id]}` : '—'}</div>
              <div className="pool">{pool.stake.toLocaleString()}P · {pool.count}명</div>
              {myBet?.option === o.id && <div className="pool">⭐ 내 베팅 {myBet.stake}P</div>}
            </div>
          );
        })}
      </div>

      {canBet && (
        <div className="row" style={{ marginTop: 10 }}>
          <input type="number" min="1" value={stake} onChange={(e) => setStake(e.target.value)} style={{ width: 110 }} />
          <button className="primary" disabled={busy} onClick={submit}>베팅</button>
          {err && <span className="err">{err}</span>}
        </div>
      )}
      {myBet && market.status !== 'resolved' && <p className="muted">베팅 완료 — {myBet.option} 에 {myBet.stake}P</p>}
      {market.status === 'resolved' && market.result == null && <p className="muted">무효 처리됨(원금 환불)</p>}
    </div>
  );
}

function statusLabel(s) {
  return { draft: '준비', open: '베팅중', locked: '마감', resolved: '종료' }[s] || s;
}

function Placeholder() {
  return (
    <div className="card">
      <p className="muted">미리보기 모드 — Firebase 설정 후 실제 대진/베팅이 표시됩니다.</p>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import {
  ensureBoard, createUser, grantPoints, upsertMarket, addMarketsBulk,
  setMarketStatus, setRoundStatus, resolveMarket, subscribeUsers,
} from '../data/store.js';
import { nameToUserId, hashPin } from '../auth/auth.js';

export default function AdminPage() {
  const { board } = useApp();
  const [msg, setMsg] = useState('');
  useEffect(() => { ensureBoard().catch(() => {}); }, []);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000); };
  const markets = board?.markets || [];
  const rounds = [...new Set(markets.map((m) => m.round).filter(Boolean))];

  return (
    <div>
      {msg && <div className="banner">{msg}</div>}
      <GrantPoints flash={flash} />
      <BulkBracket flash={flash} />
      <CreateMarket flash={flash} />
      <CreateUser flash={flash} />
      {rounds.length > 0 && (
        <div className="card">
          <h3>라운드 일괄 제어</h3>
          {rounds.map((r) => (
            <div key={r} className="row" style={{ marginBottom: 6 }}>
              <b style={{ width: 80 }}>{r}</b>
              <button className="ghost" onClick={() => setRoundStatus(r, 'open').then(() => flash(`${r} 베팅 오픈`))}>오픈</button>
              <button className="ghost" onClick={() => setRoundStatus(r, 'locked').then(() => flash(`${r} 베팅 마감`))}>마감</button>
            </div>
          ))}
        </div>
      )}
      <MarketList markets={markets} flash={flash} />
    </div>
  );
}

function CreateUser({ flash }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [bal, setBal] = useState(1000);
  async function go() {
    if (!name || !pin) return flash('이름과 PIN을 입력하세요.');
    await createUser({ userId: nameToUserId(name), name, pinHash: hashPin(pin), balance: Number(bal) });
    flash(`참가자 '${name}' 생성 (${bal}P)`);
    setName(''); setPin('');
  }
  return (
    <div className="card">
      <h3>참가자 직접 발급 (선택 — 보통은 참가자가 직접 가입)</h3>
      <div className="row">
        <input placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
        <input type="number" placeholder="시작 포인트" value={bal} onChange={(e) => setBal(e.target.value)} style={{ width: 120 }} />
        <button className="primary" onClick={go}>발급</button>
      </div>
    </div>
  );
}

function GrantPoints({ flash }) {
  const [name, setName] = useState('');
  const [delta, setDelta] = useState(100);
  async function go() {
    try {
      await grantPoints(nameToUserId(name), Number(delta));
      flash(`'${name}' 에 ${delta}P 지급/조정`);
    } catch (e) { flash('실패: ' + e.message); }
  }
  return (
    <div className="card">
      <h3>포인트 수동 지급/조정</h3>
      <div className="row">
        <input placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} style={{ width: 120 }} />
        <button className="primary" onClick={go}>적용</button>
      </div>
    </div>
  );
}

function BulkBracket({ flash }) {
  const [round, setRound] = useState('16강');
  const [text, setText] = useState('navi vs cat\n...');
  const [preview, setPreview] = useState([]);

  function parse(raw) {
    return raw.split('\n').map((l) => l.trim()).filter(Boolean)
      .map((line) => line.split(/\s+vs\s+|\s*,\s*|\s+VS\s+/).map((s) => s.trim()))
      .filter((pair) => pair.length === 2 && pair[0] && pair[1]);
  }

  function onText(v) {
    setText(v);
    setPreview(parse(v));
  }

  async function go() {
    const pairs = parse(text);
    if (pairs.length === 0) return flash('파싱된 경기가 없습니다. 한 줄에 "선수A vs 선수B" 형식으로.');
    const markets = pairs.map(([a, b], i) => ({
      id: `${round}-${i + 1}-${nameToUserId(a)}-vs-${nameToUserId(b)}`.slice(0, 90),
      type: 'match', round, title: `${round} ${i + 1}경기`,
      options: [{ id: 'A', label: a }, { id: 'B', label: b }], status: 'draft',
    }));
    await addMarketsBulk(markets);
    flash(`${markets.length}개 마켓 일괄 생성 (${round})`);
    setText(''); setPreview([]);
  }

  return (
    <div className="card">
      <h3>대진 일괄 입력</h3>
      <div className="row">
        <input placeholder="라운드(예: 16강)" value={round} onChange={(e) => setRound(e.target.value)} style={{ width: 140 }} />
        <span className="muted">한 줄에 한 경기: <code>선수A vs 선수B</code> (또는 쉼표)</span>
      </div>
      <textarea
        rows={8}
        value={text}
        onChange={(e) => onText(e.target.value)}
        style={{ width: '100%', marginTop: 8, background: 'var(--panel2)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 14, fontFamily: 'inherit' }}
        placeholder={'navi vs cat\nfoo vs bar\n...'}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={go}>{preview.length || 0}경기 생성</button>
        {preview.length > 0 && <span className="muted">미리보기: {preview.map((p) => `${p[0]}-${p[1]}`).join(', ')}</span>}
      </div>
    </div>
  );
}

function CreateMarket({ flash }) {
  const [round, setRound] = useState('16강');
  const [title, setTitle] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  async function go() {
    if (!title || !a || !b) return flash('제목과 양쪽 선수를 입력하세요.');
    const id = `${round}-${nameToUserId(a)}-vs-${nameToUserId(b)}`.slice(0, 90);
    await upsertMarket({
      id, type: 'match', round, title,
      options: [{ id: 'A', label: a }, { id: 'B', label: b }],
      status: 'draft',
    });
    flash(`마켓 생성: ${title}`);
    setTitle(''); setA(''); setB('');
  }
  return (
    <div className="card">
      <h3>매치 마켓 추가</h3>
      <div className="row">
        <input placeholder="라운드(예: 16강)" value={round} onChange={(e) => setRound(e.target.value)} style={{ width: 120 }} />
        <input placeholder="제목(예: A조 1경기)" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input placeholder="선수 A" value={a} onChange={(e) => setA(e.target.value)} />
        <span>vs</span>
        <input placeholder="선수 B" value={b} onChange={(e) => setB(e.target.value)} />
        <button className="primary" onClick={go}>추가</button>
      </div>
      <p className="muted">승점·우승 예측 등 다른 베팅도 같은 구조(type만 다름)로 확장됩니다.</p>
    </div>
  );
}

function MarketList({ markets, flash }) {
  if (markets.length === 0) return null;
  return (
    <div className="card">
      <h3>마켓 목록 / 정산</h3>
      <table className="board">
        <thead><tr><th>라운드</th><th>제목</th><th>상태</th><th>제어</th></tr></thead>
        <tbody>
          {markets.map((m) => <MarketRow key={m.id} m={m} flash={flash} />)}
        </tbody>
      </table>
    </div>
  );
}

function MarketRow({ m, flash }) {
  // 결과 선택은 A/B 고정(매치). 승자 id 로 정산.
  async function resolve(option) {
    const r = await resolveMarket({ marketId: m.id, winningOption: option });
    flash(r.voided
      ? `${m.title}: 무효(이긴 쪽 베팅 없음) — 원금 환불`
      : `${m.title}: 정산 완료 (총풀 ${r.totalPool}P, 승자 ${Object.keys(r.payouts).length}명)`);
  }
  return (
    <tr>
      <td>{m.round}</td>
      <td>{m.title}</td>
      <td><span className={`pill ${m.status}`}>{m.status}</span></td>
      <td>
        <div className="row">
          {m.status === 'draft' && <button className="ghost" onClick={() => setMarketStatus(m.id, 'open').then(() => flash('오픈'))}>오픈</button>}
          {m.status === 'open' && <button className="ghost" onClick={() => setMarketStatus(m.id, 'locked').then(() => flash('마감'))}>마감</button>}
          {(m.status === 'locked' || m.status === 'open') && (
            <>
              <button className="ghost" onClick={() => resolve('A')}>A승</button>
              <button className="ghost" onClick={() => resolve('B')}>B승</button>
            </>
          )}
          {m.status === 'resolved' && <span className="muted">결과: {m.result ?? '무효'}</span>}
        </div>
      </td>
    </tr>
  );
}

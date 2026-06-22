import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import {
  ensureBoard, createUser, grantPoints, upsertMarket, addMarketsBulk,
  setMarketStatus, setRoundStatus, resolveMarket, refreshBoardMirror, setMarketBlind,
  wipeMarketsAndBets, wipeUsers, grantAllPoints, subscribeUsers,
  getUserByName, updateUserProfile, transferPoints,
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
      <TransferPoints flash={flash} />
      <EditAccount flash={flash} />
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
      <DangerZone flash={flash} />
    </div>
  );
}

function DangerZone({ flash }) {
  async function wipeMatches() {
    if (!window.confirm('모든 대진/마켓/베팅을 삭제합니다. 참가자·잔액은 유지됩니다. 계속할까요?')) return;
    const n = await wipeMarketsAndBets();
    flash(`마켓 ${n}개 + 베팅 삭제, 대진 초기화 완료`);
  }
  async function wipeAll() {
    if (!window.confirm('⚠️ 참가자까지 포함해 전체 데이터를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
    const m = await wipeMarketsAndBets();
    const u = await wipeUsers();
    flash(`전체 초기화 완료 (마켓 ${m} · 참가자 ${u} 삭제)`);
  }
  return (
    <div className="card" style={{ borderColor: 'var(--lose)' }}>
      <h3 style={{ color: 'var(--lose)' }}>⚠️ 위험 구역 — 데이터 초기화</h3>
      <div className="row">
        <button className="ghost" onClick={wipeMatches}>대진·베팅만 초기화</button>
        <button className="ghost" onClick={wipeAll}>전체 초기화 (참가자 포함)</button>
      </div>
      <p className="muted">대회 리셋용. 삭제는 운영자만 가능(보안 규칙). 되돌릴 수 없습니다.</p>
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
  const [allDelta, setAllDelta] = useState(1000);
  async function go() {
    try {
      const u = await getUserByName(name);
      if (!u) return flash(`'${name}' 계정을 찾을 수 없습니다.`);
      await grantPoints(u.id, Number(delta));
      flash(`'${u.name}' 에 ${delta}P 지급/조정`);
    } catch (e) { flash('실패: ' + e.message); }
  }
  async function goAll() {
    if (!window.confirm(`등록된 전원에게 ${allDelta}P 를 지급합니다. 계속할까요?`)) return;
    try {
      const n = await grantAllPoints(Number(allDelta));
      flash(`전원 지급 완료 — ${n}명에게 각 ${allDelta}P`);
    } catch (e) { flash('실패: ' + e.message); }
  }
  return (
    <div className="card">
      <h3>포인트 지급/조정</h3>
      <div className="row">
        <input placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} style={{ width: 120 }} />
        <button className="primary" onClick={go}>개인 지급</button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className="muted" style={{ width: 110 }}>전원에게 +</span>
        <input type="number" value={allDelta} onChange={(e) => setAllDelta(e.target.value)} style={{ width: 120 }} />
        <button className="primary" onClick={goAll}>전원 지급</button>
      </div>
      <p className="muted">전원 지급은 현재 잔액에 가산됩니다(시작 포인트 일괄 지급용).</p>
    </div>
  );
}

function TransferPoints({ flash }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState(100);
  async function go() {
    try {
      const f = await getUserByName(from);
      const t = await getUserByName(to);
      if (!f) return flash(`보내는 계정 '${from}' 없음`);
      if (!t) return flash(`받는 계정 '${to}' 없음`);
      await transferPoints(f.id, t.id, Number(amt));
      flash(`전송 완료 — ${f.name} → ${t.name} ${amt}P`);
      setAmt(100);
    } catch (e) { flash('실패: ' + e.message); }
  }
  return (
    <div className="card">
      <h3>계정 간 포인트 전송 (운영자 중개)</h3>
      <div className="row">
        <input placeholder="보내는 이름" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span>→</span>
        <input placeholder="받는 이름" value={to} onChange={(e) => setTo(e.target.value)} />
        <input type="number" value={amt} onChange={(e) => setAmt(e.target.value)} style={{ width: 110 }} />
        <button className="primary" onClick={go}>보내기</button>
      </div>
    </div>
  );
}

function EditAccount({ flash }) {
  const [cur, setCur] = useState('');
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  async function go() {
    try {
      const u = await getUserByName(cur);
      if (!u) return flash(`'${cur}' 계정을 찾을 수 없습니다.`);
      const patch = {};
      if (newName.trim()) patch.name = newName.trim();
      if (newPin.trim()) patch.pinHash = hashPin(newPin.trim());
      if (Object.keys(patch).length === 0) return flash('변경할 이름 또는 PIN을 입력하세요.');
      await updateUserProfile(u.id, patch);
      flash(`'${u.name}' 수정 완료${patch.name ? ` → 이름 '${patch.name}'` : ''}${patch.pinHash ? ', PIN 변경' : ''}`);
      setCur(''); setNewName(''); setNewPin('');
    } catch (e) { flash('실패: ' + e.message); }
  }
  return (
    <div className="card">
      <h3>계정 수정 (이름 · PIN)</h3>
      <div className="row">
        <input placeholder="현재 이름" value={cur} onChange={(e) => setCur(e.target.value)} />
        <input placeholder="새 이름(선택)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input placeholder="새 PIN(선택)" value={newPin} onChange={(e) => setNewPin(e.target.value)} style={{ width: 120 }} />
        <button className="primary" onClick={go}>수정</button>
      </div>
      <p className="muted">로그인은 이름(표시명) 기준이라 이름을 바꾸면 새 이름으로 로그인합니다. 베팅 기록은 유지됩니다.</p>
    </div>
  );
}

function BulkBracket({ flash }) {
  const [round, setRound] = useState('16강');
  const [text, setText] = useState('navi vs cat\n...');
  const [preview, setPreview] = useState([]);
  const [blind, setBlind] = useState(false);

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
      options: [{ id: 'A', label: a }, { id: 'B', label: b }], status: 'draft', blind,
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
        <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> 🙈 블라인드</label>
        {preview.length > 0 && <span className="muted">미리보기: {preview.map((p) => `${p[0]}-${p[1]}`).join(', ')}</span>}
      </div>
    </div>
  );
}

// 1:1 ~ N지선다 공용 마켓 추가 (다자 대전 = 우승자 맞히기 등)
function CreateMarket({ flash }) {
  const [round, setRound] = useState('16강');
  const [title, setTitle] = useState('');
  const [players, setPlayers] = useState('');
  const [blind, setBlind] = useState(false);
  function labels() {
    return players.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
  }
  async function go() {
    const ls = labels();
    if (!title || ls.length < 2) return flash('제목과 선수/선택지 2개 이상을 입력하세요.');
    // 2지선다는 A/B, 그 이상은 o1..oN 으로 옵션 id 부여.
    const options = ls.map((label, i) => ({
      id: ls.length === 2 ? (i === 0 ? 'A' : 'B') : `o${i + 1}`,
      label,
    }));
    const id = `${round || '기타'}-${nameToUserId(title)}-${Date.now().toString(36)}`.slice(0, 90);
    await upsertMarket({ id, type: ls.length === 2 ? 'match' : 'multi', round, title, options, status: 'draft', blind });
    flash(`마켓 생성: ${title} (${ls.length}지선다${blind ? ', 블라인드' : ''})`);
    setTitle(''); setPlayers('');
  }
  const preview = labels();
  return (
    <div className="card">
      <h3>마켓 추가 (1:1 · 다자 공용)</h3>
      <div className="row">
        <input placeholder="라운드(예: 16강, 우승예측)" value={round} onChange={(e) => setRound(e.target.value)} style={{ width: 150 }} />
        <input placeholder="제목(예: A조 1경기 / 최종 우승자)" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <textarea
        rows={4}
        value={players}
        onChange={(e) => setPlayers(e.target.value)}
        placeholder={'선수/선택지를 줄바꿈 또는 쉼표로 구분\n예) 김규장, 김채연  (1:1)\n또는 4명 이상 = 다자 대전'}
        style={{ width: '100%', marginTop: 8, background: 'var(--panel2)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 14, fontFamily: 'inherit' }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={go}>추가 ({preview.length}지선다)</button>
        <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> 🙈 블라인드</label>
        {preview.length >= 2 && <span className="muted">{preview.join(' · ')}</span>}
      </div>
      <p className="muted">2명이면 1:1 매치, 3명 이상이면 다자 대전(우승자 맞히기). 정산은 동일한 패리뮤추얼.</p>
    </div>
  );
}

function MarketList({ markets, flash }) {
  if (markets.length === 0) return null;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>마켓 목록 / 정산</h3>
        <button className="ghost" onClick={() => refreshBoardMirror().then((n) => flash(`마켓 정보 갱신 (${n}개)`))}>대진 정보 갱신</button>
      </div>
      <table className="board">
        <thead><tr><th>라운드</th><th>대진 (제목)</th><th>상태</th><th>승자 확정 / 제어</th></tr></thead>
        <tbody>
          {markets.map((m) => <MarketRow key={m.id} m={m} flash={flash} />)}
        </tbody>
      </table>
    </div>
  );
}

function MarketRow({ m, flash }) {
  const options = m.options || [];
  const labelOf = (id) => options.find((o) => o.id === id)?.label || id;
  // 승자 id 로 정산. 옵션 개수 무관(1:1·다자 공용).
  async function resolve(option) {
    const r = await resolveMarket({ marketId: m.id, winningOption: option });
    flash(r.voided
      ? `${m.title}: 무효(이긴 쪽 베팅 없음) — 원금 환불`
      : `${labelOf(option)} 승 확정 — ${m.title}: 정산 완료 (총풀 ${r.totalPool}P, 승자 ${Object.keys(r.payouts).length}명)`);
  }
  const canResolve = m.status === 'locked' || m.status === 'open';
  return (
    <tr>
      <td>{m.round}</td>
      <td>
        <div><b>{options.map((o) => o.label).join('  vs  ')}</b>{m.blind && <span className="pill" style={{ marginLeft: 6 }}>🙈</span>}</div>
        <div className="muted">{m.title}</div>
      </td>
      <td><span className={`pill ${m.status}`}>{m.status}</span></td>
      <td>
        <div className="row">
          {m.status === 'draft' && <button className="ghost" onClick={() => setMarketStatus(m.id, 'open').then(() => flash('오픈'))}>오픈</button>}
          {m.status === 'open' && <button className="ghost" onClick={() => setMarketStatus(m.id, 'locked').then(() => flash('마감'))}>마감</button>}
          {m.status !== 'resolved' && (
            <button className="ghost" onClick={() => setMarketBlind(m.id, !m.blind).then(() => flash(m.blind ? '블라인드 해제' : '블라인드 설정'))}>
              {m.blind ? '🙈 해제' : '🙈 블라인드'}
            </button>
          )}
          {canResolve && options.map((o) => (
            <button key={o.id} className="ghost" onClick={() => resolve(o.id)}>{o.label} 승</button>
          ))}
          {m.status === 'resolved' && <span className="ok">✔ 승자: {m.result == null ? '무효' : labelOf(m.result)}</span>}
        </div>
      </td>
    </tr>
  );
}

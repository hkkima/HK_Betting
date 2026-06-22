import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { subscribeUsers } from '../data/store.js';

export default function LeaderboardPage() {
  const { configured } = useApp();
  const [users, setUsers] = useState(null);
  useEffect(() => { if (configured) return subscribeUsers(setUsers); }, [configured]);

  if (!configured) return <div className="card"><p className="muted">미리보기 모드 — 설정 후 잔액 순위가 표시됩니다.</p></div>;
  if (!users) return <p className="muted">불러오는 중…</p>;

  const ranked = [...users].sort((a, b) => (b.balance || 0) - (a.balance || 0));
  return (
    <div className="card">
      <table className="board">
        <thead><tr><th>순위</th><th>참가자</th><th>잔액</th></tr></thead>
        <tbody>
          {ranked.map((u, i) => (
            <tr key={u.id}>
              <td>{i + 1}</td>
              <td>{u.name}</td>
              <td className="balance">{(u.balance || 0).toLocaleString()} P</td>
            </tr>
          ))}
          {ranked.length === 0 && <tr><td colSpan="3" className="muted">참가자가 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

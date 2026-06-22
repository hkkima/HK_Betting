import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';

export default function LoginPage() {
  const { session, loginParticipant, loginAdmin, logout } = useApp();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');

  if (session.role !== 'guest') {
    return (
      <div className="card">
        <p>현재 <b>{session.name || session.email}</b> 로 로그인되어 있습니다.</p>
        <button className="ghost" onClick={logout}>로그아웃</button>
      </div>
    );
  }

  async function doParticipant(e) {
    e.preventDefault();
    setErr('');
    try { await loginParticipant(name, pin); }
    catch (e2) { setErr(e2.message); }
  }
  async function doAdmin() {
    setErr('');
    try { await loginAdmin(); }
    catch (e2) { setErr(e2.message); }
  }

  return (
    <div>
      <div className="card">
        <h3>참가자 로그인</h3>
        <form className="row" onSubmit={doParticipant}>
          <input placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="PIN" type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
          <button className="primary" type="submit">로그인</button>
        </form>
        <p className="muted">계정/포인트는 운영진이 발급합니다.</p>
      </div>
      <div className="card">
        <h3>운영자 로그인</h3>
        <button className="ghost" onClick={doAdmin}>Google로 로그인</button>
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

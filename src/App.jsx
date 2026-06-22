import { useState } from 'react';
import { useApp } from './state/AppContext.jsx';
import BoardPage from './pages/BoardPage.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import LoginPage from './pages/LoginPage.jsx';

export default function App() {
  const { configured, session, logout } = useApp();
  const [tab, setTab] = useState('board');

  const isAdmin = session.role === 'admin';
  const who =
    session.role === 'participant' ? session.name
    : session.role === 'admin' ? `운영자 (${session.email})`
    : '게스트';

  return (
    <div>
      <header className="top">
        <h1>♟️ 체스 베팅판</h1>
        <nav className="tabs">
          <button className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')}>베팅판</button>
          <button className={tab === 'rank' ? 'active' : ''} onClick={() => setTab('rank')}>리더보드</button>
          {isAdmin && <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>운영자</button>}
          <button className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}>
            {session.role === 'guest' ? '로그인' : '계정'}
          </button>
        </nav>
        <div className="spacer" />
        <span className="muted">{who}</span>
        {session.role !== 'guest' && <button className="ghost" onClick={logout}>로그아웃</button>}
      </header>

      <div className="wrap">
        {!configured && (
          <div className="banner">
            ⚙️ Firebase가 아직 설정되지 않았어요. <code>.env</code>에 <code>VITE_FIREBASE_*</code> 값을 채우면
            실시간 베팅이 동작합니다. (지금은 UI 미리보기만 가능)
          </div>
        )}
        {tab === 'board' && <BoardPage />}
        {tab === 'rank' && <LeaderboardPage />}
        {tab === 'admin' && isAdmin && <AdminPage />}
        {tab === 'login' && <LoginPage />}
      </div>
    </div>
  );
}

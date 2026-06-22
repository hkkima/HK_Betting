import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { isConfigured, ensureAnonAuth, signInWithGoogle, isAdminEmail } from '../data/firebase.js';
import { subscribeBoard, getUser } from '../data/store.js';
import { nameToUserId, verifyPin } from '../auth/auth.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const SESSION_KEY = 'hkbet.session';

export function AppProvider({ children }) {
  const configured = isConfigured();
  const [board, setBoard] = useState(null);
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || { role: 'guest' }; }
    catch { return { role: 'guest' }; }
  });

  // board 구독(전원 공유 리스너 1개)
  useEffect(() => {
    if (!configured) return;
    if (session.role === 'participant') ensureAnonAuth();
    return subscribeBoard(setBoard);
  }, [configured, session.role]);

  const persist = useCallback((s) => {
    setSession(s);
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  }, []);

  const loginParticipant = useCallback(async (name, pin) => {
    if (!configured) throw new Error('Firebase 설정이 필요합니다 (.env).');
    const userId = nameToUserId(name);
    const user = await getUser(userId);
    if (!user) throw new Error('등록되지 않은 참가자입니다. 운영진에게 계정 발급을 요청하세요.');
    if (!verifyPin(pin, user.pinHash)) throw new Error('PIN이 일치하지 않습니다.');
    await ensureAnonAuth();
    persist({ role: 'participant', userId, name: user.name });
  }, [configured, persist]);

  const loginAdmin = useCallback(async () => {
    if (!configured) throw new Error('Firebase 설정이 필요합니다 (.env).');
    const u = await signInWithGoogle();
    if (!isAdminEmail(u.email)) throw new Error(`운영자 권한이 없는 계정입니다: ${u.email}`);
    persist({ role: 'admin', email: u.email });
  }, [configured, persist]);

  const logout = useCallback(() => persist({ role: 'guest' }), [persist]);

  return (
    <Ctx.Provider value={{ configured, board, session, loginParticipant, loginAdmin, logout }}>
      {children}
    </Ctx.Provider>
  );
}

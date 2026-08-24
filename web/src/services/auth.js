/** จัดการสถานะผู้ใช้และการเข้าสู่ระบบด้วย LINE */
import api from '../core/api.js';
import appState from '../core/state.js';
import bootstrap from '../core/bootstrap.js';
import idb from '../core/idb.js';

export async function refreshUser() {
  try {
    const res = await api.get('/api/auth/me', { timeout: 10000 });
    appState.set({
      user: res.user,
      authenticated: res.authenticated,
      userType: res.userType,
      requiresFriend: res.requiresFriend,
      addFriendUrl: res.addFriendUrl || bootstrap.addFriendUrl,
    });
    if (res.user?.theme) applyTheme(res.user.theme);
    return res;
  } catch {
    return null;
  }
}

export function startLineLogin(nextPath = location.pathname) {
  location.href = `/api/auth/line/start?next=${encodeURIComponent(nextPath)}`;
}

export async function logout() {
  try { await api.post('/api/auth/logout', {}); } catch { /* ต่อไปได้ */ }
  await idb.clearAll();
  appState.set({ user: null, authenticated: false, userType: 'guest', requiresFriend: false });
}

export async function savePreferences(patch) {
  const state = appState.get();
  if (patch.theme) applyTheme(patch.theme);
  if (patch.language) {
    localStorage.setItem('dtpdf.language', patch.language);
    appState.set({ language: patch.language });
  }
  if (!state.authenticated) return null;
  try {
    const res = await api.patch('/api/auth/preferences', patch);
    appState.set({ user: res.user });
    return res.user;
  } catch { return null; }
}

/** ธีม: light / dark / system (spec ข้อ 59) */
export function applyTheme(theme) {
  const value = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
  document.documentElement.dataset.theme = value === 'system' ? '' : value;
  localStorage.setItem('dtpdf.theme', value);
  appState.set({ theme: value });

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = value === 'dark'
      || (value === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    meta.setAttribute('content', dark ? '#0b1220' : '#2563eb');
  }
}

export function initTheme() {
  applyTheme(localStorage.getItem('dtpdf.theme') || 'system');
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (appState.get().theme === 'system') applyTheme('system');
  });
}

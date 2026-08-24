/** Store เล็ก ๆ แบบ reactive — พอสำหรับแอปขนาดนี้ ไม่ต้องพึ่ง framework */
function createStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(patch) {
      const next = typeof patch === 'function' ? patch(value) : { ...value, ...patch };
      if (next === value) return value;
      value = next;
      listeners.forEach((fn) => { try { fn(value); } catch (err) { console.error(err); } });
      return value;
    },
    subscribe(fn, { immediate = false } = {}) {
      listeners.add(fn);
      if (immediate) fn(value);
      return () => listeners.delete(fn);
    },
  };
}

export const appState = createStore({
  user: null,
  authenticated: false,
  userType: 'guest',
  requiresFriend: false,
  addFriendUrl: '',
  stats: { online: { total: 0 }, today: { visits: 0, visitors: 0 }, total: { visits: 0, visitors: 0 } },
  capabilities: null,
  recentTools: [],
  online: navigator.onLine,
  isLiff: false,
  theme: localStorage.getItem('dtpdf.theme') || 'system',
  language: localStorage.getItem('dtpdf.language') || 'th',
});

export { createStore };
export default appState;

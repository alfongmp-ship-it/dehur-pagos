let _nt;

export function notify(msg, type = 'success') {
  const el = document.getElementById('notif');
  document.getElementById('nm').textContent = msg;
  document.getElementById('ni').textContent = type === 'success' ? '✓' : '✕';
  el.className = `notif show ${type}`;
  clearTimeout(_nt);
  _nt = setTimeout(() => el.classList.remove('show'), 3000);
}

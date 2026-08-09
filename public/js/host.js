const channel = new BroadcastChannel('tetris_referee_channel');
const statusEl = document.getElementById('host-status');

document.getElementById('start-btn').addEventListener('click', () => {
  channel.postMessage({ type: 'START_GAME' });
  statusEl.innerText = 'Befehl gesendet: MATCH GESTARTET';
  statusEl.style.color = '#00f0f0';
});

document.getElementById('reset-btn').addEventListener('click', () => {
  channel.postMessage({ type: 'RESET_GAME' });
  statusEl.innerText = 'Befehl gesendet: SPIEL ZURÜCKGESETZT';
  statusEl.style.color = '#ffaa00';
});

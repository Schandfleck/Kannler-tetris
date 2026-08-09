const socket = typeof io !== 'undefined' ? io() : null;

const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 24;

let gameMode = null; // 'local' oder 'online'
let currentRoomId = null;
let myOnlineIndex = 1;

const COLORS = [
  null,
'#00f0f0', '#0000f0', '#f0a000', '#f0f000',
'#00f000', '#a000f0', '#f00000', '#777777'
];

const BLOCK_IMAGE_SOURCES = [
  null,
'/pics/block1.png', '/pics/block2.png', '/pics/block3.png', '/pics/block4.png',
'/pics/block5.png', '/pics/block6.png', '/pics/block7.png', '/pics/block8.png'
];

const blockImagesLoaded = [];
BLOCK_IMAGE_SOURCES.forEach((src, index) => {
  if (!src) return;
  const img = new Image();
  img.src = src;
  blockImagesLoaded[index] = img;
});

const SHAPES = [
  [],
[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
[[2,0,0],[2,2,2],[0,0,0]],
[[0,0,3],[3,3,3],[0,0,0]],
[[4,4],[4,4]],
[[0,5,5],[5,5,0],[0,0,0]],
[[0,6,0],[6,6,6],[0,0,0]],
[[7,7,0],[0,7,7],[0,0,0]]
];

const defaultControls = {
  p1: {
    left: { type: 'key', code: 'KeyA' },
    right: { type: 'key', code: 'KeyD' },
    down: { type: 'key', code: 'KeyS' },
    drop: { type: 'key', code: 'KeyW' },
    rotLeft: { type: 'key', code: 'KeyQ' },
    rotRight: { type: 'key', code: 'KeyE' },
    hold: { type: 'key', code: 'Space' }
  },
  p2: {
    left: { type: 'key', code: 'ArrowLeft' },
    right: { type: 'key', code: 'ArrowRight' },
    down: { type: 'key', code: 'ArrowDown' },
    drop: { type: 'key', code: 'ArrowUp' },
    rotLeft: { type: 'key', code: 'KeyN' },
    rotRight: { type: 'key', code: 'KeyM' },
    hold: { type: 'key', code: 'ShiftRight' }
  }
};

let controls = JSON.parse(localStorage.getItem('tetris_controls_v2')) || defaultControls;

let gameActive = false;
let isCountingDown = false;
let countdownTimer = null;
let lastTime = 0;
let listeningButton = null;

const prevGamepadState = {};
const gamepadRepeatTimers = {};

const channel = new BroadcastChannel('tetris_referee_channel');

channel.onmessage = (event) => {
  if (gameMode === 'local') {
    if (event.data.type === 'START_GAME') startCountdown();
    else if (event.data.type === 'RESET_GAME') resetGame();
  }
};

// MENÜ SELEKTION
document.getElementById('btn-local-mode').addEventListener('click', () => {
  gameMode = 'local';
  document.getElementById('mode-selection').classList.add('hidden');
  document.getElementById('game-wrapper').classList.remove('hidden');
  document.getElementById('p2-controls-col').style.display = 'block';
  document.getElementById('room-display').classList.add('hidden');
  initGame();
});

document.getElementById('btn-online-mode').addEventListener('click', () => {
  gameMode = 'online';
  if (socket) socket.emit('find_match');
});

// SOCKET EVENTS (ONLINE)
if (socket) {
  socket.on('init_player', ({ playerIndex, roomId }) => {
    myOnlineIndex = playerIndex;
    currentRoomId = roomId;
    document.getElementById('mode-selection').classList.add('hidden');
    document.getElementById('game-wrapper').classList.remove('hidden');
    document.getElementById('player-2-area').classList.add('hidden');
    document.getElementById('p2-controls-col').style.display = 'none';

    const roomDisplay = document.getElementById('room-display');
    roomDisplay.innerText = `Raum: ${roomId}`;
    roomDisplay.classList.remove('hidden');

    document.getElementById('p1-title').innerText = `Du (Spieler ${playerIndex})`;
    document.getElementById('status').innerText = 'Warte auf Mitspieler...';
    initGame();
  });

  socket.on('player_status_update', ({ playerCount, readyToStart }) => {
    const statusEl = document.getElementById('status');
    if (playerCount < 2) {
      statusEl.innerText = 'Warte auf zweiten Spieler...';
      statusEl.style.color = '#ffaa00';
    } else if (readyToStart && !gameActive && !isCountingDown) {
      statusEl.innerText = 'Raum voll – Warte auf Start durch Referee...';
      statusEl.style.color = '#00f0f0';
    }
  });

  socket.on('referee_start_game', () => {
    startCountdown();
  });

  socket.on('referee_reset_game', () => {
    resetGame();
  });

  socket.on('receive_garbage', ({ lines }) => {
    if (gameActive && players[0]) sendGarbage(players[0], lines);
  });

    socket.on('opponent_game_over', () => {
      gameActive = false;
      document.getElementById('status').innerText = '🏆 GEGNER HAT VERLOREN – DU GEWINNST!';
      document.getElementById('status').style.color = '#00ff88';
    });

    socket.on('opponent_disconnected', () => {
      gameActive = false;
      document.getElementById('status').innerText = '❌ Gegner hat die Verbindung getrennt.';
      document.getElementById('status').style.color = '#ff0055';
    });
}

function createPlayer(id) {
  return {
    id: id,
    canvas: document.getElementById(`board-${id}`),
    ctx: document.getElementById(`board-${id}`)?.getContext('2d'),
    holdCanvas: document.getElementById(`hold-board-${id}`),
    holdCtx: document.getElementById(`hold-board-${id}`)?.getContext('2d'),
    grid: createGrid(),
    currentPiece: null,
    currentPieceId: null,
    currentX: 0,
    currentY: 0,
    heldPieceId: null,
    canHold: true,
    dropCounter: 0
  };
}

let players = [];

function initGame() {
  if (gameMode === 'local') {
    players = [createPlayer(1), createPlayer(2)];
  } else {
    players = [createPlayer(1)];
  }
  draw();
}

function createGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function startCountdown() {
  if (gameActive || isCountingDown) return;

  players.forEach(p => {
    p.grid = createGrid();
    p.heldPieceId = null;
    p.canHold = true;
    spawnPiece(p);
  });

  draw();

  isCountingDown = true;
  let count = 3;

  const statusEl = document.getElementById('status');
  statusEl.style.color = '#ffaa00';
  statusEl.innerText = `⏳ STARTE IN ${count}...`;

  if (countdownTimer) clearInterval(countdownTimer);

  countdownTimer = setInterval(() => {
    count--;
    if (count > 0) {
      statusEl.innerText = `⏳ STARTE IN ${count}...`;
    } else if (count === 0) {
      statusEl.innerText = '🔥 GO!';
      statusEl.style.color = '#00f0f0';
    } else {
      clearInterval(countdownTimer);
      countdownTimer = null;
      isCountingDown = false;
      gameActive = true;
      statusEl.innerText = '🔥 MATCH LÄUFT!';
    }
  }, 1000);
}

function resetGame() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  isCountingDown = false;
  gameActive = false;
  initGame();

  document.getElementById('status').innerText = 'Warte auf Freigabe durch Referee...';
  document.getElementById('status').style.color = '#ffaa00';
}

function spawnPiece(player, specificId = null) {
  const id = specificId !== null ? specificId : (Math.floor(Math.random() * 7) + 1);
  player.currentPieceId = id;
  player.currentPiece = SHAPES[id];
  player.currentY = 0;
  player.currentX = Math.floor((COLS - player.currentPiece[0].length) / 2);
  player.canHold = true;

  if (collide(player.grid, player.currentPiece, player.currentX, player.currentY)) {
    gameActive = false;
    if (gameMode === 'local') {
      const winnerId = player.id === 1 ? 2 : 1;
      document.getElementById('status').innerText = `🏆 GAME OVER – SPIELER ${winnerId} GEWINNT!`;
    } else {
      document.getElementById('status').innerText = `💥 GAME OVER – DU HAST VERLOREN!`;
      if (socket) socket.emit('game_over', { roomId: currentRoomId });
    }
    document.getElementById('status').style.color = '#ff0055';
  }
}

function holdPiece(player) {
  if (!player.canHold || !player.currentPiece) return;

  const previousHeldId = player.heldPieceId;
  player.heldPieceId = player.currentPieceId;

  if (previousHeldId === null) {
    spawnPiece(player);
  } else {
    spawnPiece(player, previousHeldId);
  }
  player.canHold = false;
}

function collide(grid, piece, offsetX, offsetY) {
  for (let r = 0; r < piece.length; r++) {
    for (let c = 0; c < piece[r].length; c++) {
      if (piece[r][c] !== 0) {
        const newX = offsetX + c;
        const newY = offsetY + r;
        if (newX < 0 || newX >= COLS || newY >= ROWS) return true;
        if (newY >= 0 && grid[newY][newX] !== 0) return true;
      }
    }
  }
  return false;
}

function mergePiece(player) {
  for (let r = 0; r < player.currentPiece.length; r++) {
    for (let c = 0; c < player.currentPiece[r].length; c++) {
      const type = player.currentPiece[r][c];
      if (type !== 0) {
        player.grid[player.currentY + r][player.currentX + c] = type;
      }
    }
  }
  clearLines(player);
  spawnPiece(player);
}

function clearLines(player) {
  let clearedLines = 0;

  for (let r = ROWS - 1; r >= 0; r--) {
    if (player.grid[r].every(val => val !== 0)) {
      player.grid.splice(r, 1);
      player.grid.unshift(Array(COLS).fill(0));
      clearedLines++;
      r++;
    }
  }

  if (clearedLines >= 2) {
    let garbageToSend = 0;
    if (clearedLines === 2) garbageToSend = 1;
    else if (clearedLines === 3) garbageToSend = 2;
    else if (clearedLines >= 4) garbageToSend = 4;

    if (gameMode === 'local') {
      const targetPlayer = players.find(p => p.id !== player.id);
      sendGarbage(targetPlayer, garbageToSend);
    } else {
      if (socket) socket.emit('send_garbage', { roomId: currentRoomId, lines: garbageToSend });
    }
  }
}

function sendGarbage(targetPlayer, lines) {
  for (let i = 0; i < lines; i++) {
    targetPlayer.grid.shift();
    const garbageRow = Array(COLS).fill(8);
    const holeIndex = Math.floor(Math.random() * COLS);
    garbageRow[holeIndex] = 0;
    targetPlayer.grid.push(garbageRow);
  }

  if (targetPlayer.currentPiece && collide(targetPlayer.grid, targetPlayer.currentPiece, targetPlayer.currentX, targetPlayer.currentY)) {
    targetPlayer.currentY = Math.max(0, targetPlayer.currentY - lines);
  }
}

function rotateClockwise(piece) {
  return piece[0].map((_, i) => piece.map(row => row[i]).reverse());
}

function rotateCounterClockwise(piece) {
  return piece[0].map((_, i) => piece.map(row => row[row.length - 1 - i]));
}

function attemptRotation(player, dir) {
  const rotated = dir === 'left' ? rotateCounterClockwise(player.currentPiece) : rotateClockwise(player.currentPiece);
  const kickOffsets = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];

  for (const [dx, dy] of kickOffsets) {
    if (!collide(player.grid, rotated, player.currentX + dx, player.currentY + dy)) {
      player.currentPiece = rotated;
      player.currentX += dx;
      player.currentY += dy;
      break;
    }
  }
}

function moveDown(player) {
  if (!collide(player.grid, player.currentPiece, player.currentX, player.currentY + 1)) {
    player.currentY++;
  } else {
    mergePiece(player);
  }
  player.dropCounter = 0;
}

function hardDrop(player) {
  while (!collide(player.grid, player.currentPiece, player.currentX, player.currentY + 1)) {
    player.currentY++;
  }
  mergePiece(player);
}

function handleAction(playerIndex, action) {
  const p = players[playerIndex];
  if (!p || !p.currentPiece) return;

  if (action === 'left') {
    if (!collide(p.grid, p.currentPiece, p.currentX - 1, p.currentY)) p.currentX--;
  } else if (action === 'right') {
    if (!collide(p.grid, p.currentPiece, p.currentX + 1, p.currentY)) p.currentX++;
  } else if (action === 'down') {
    moveDown(p);
  } else if (action === 'drop') {
    hardDrop(p);
  } else if (action === 'rotLeft') {
    attemptRotation(p, 'left');
  } else if (action === 'rotRight') {
    attemptRotation(p, 'right');
  } else if (action === 'hold') {
    holdPiece(p);
  }
}

// HAUPT-UPDATE-SCHLEIFE (Läuft permanent für Gameplay & Gamepad-Polling)
function mainLoop(time = 0) {
  const deltaTime = time - lastTime;
  lastTime = time;

  pollGamepads(deltaTime);

  if (gameActive) {
    players.forEach(p => {
      p.dropCounter += deltaTime;
      if (p.dropCounter > 800) {
        moveDown(p);
      }
    });
    draw();
  }

  requestAnimationFrame(mainLoop);
}

function draw() {
  players.forEach(p => {
    drawBoard(p);
    drawGhostPiece(p);
    drawActivePiece(p);
    drawHoldPiece(p);
  });
}

function drawBlock(ctx, type, x, y) {
  if (!ctx) return;
  const img = blockImagesLoaded[type];
  const px = x * BLOCK_SIZE;
  const py = y * BLOCK_SIZE;

  if (img && img.complete && img.naturalWidth !== 0) {
    ctx.drawImage(img, px, py, BLOCK_SIZE, BLOCK_SIZE);
  } else {
    ctx.fillStyle = COLORS[type] || '#777';
    ctx.fillRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
    ctx.strokeStyle = '#111';
    ctx.strokeRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
  }
}

function drawBoard(player) {
  const ctx = player.ctx;
  if (!ctx) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const type = player.grid[r][c];
      if (type !== 0) {
        drawBlock(ctx, type, c, r);
      }
    }
  }
}

function drawGhostPiece(player) {
  if (!player.currentPiece || !player.ctx) return;

  let ghostY = player.currentY;
  while (!collide(player.grid, player.currentPiece, player.currentX, ghostY + 1)) {
    ghostY++;
  }

  if (ghostY === player.currentY) return;

  const ctx = player.ctx;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.strokeStyle = '#ffffff';

  for (let r = 0; r < player.currentPiece.length; r++) {
    for (let c = 0; c < player.currentPiece[r].length; c++) {
      if (player.currentPiece[r][c] !== 0) {
        const px = (player.currentX + c) * BLOCK_SIZE;
        const py = (ghostY + r) * BLOCK_SIZE;
        ctx.fillRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
        ctx.strokeRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
      }
    }
  }
}

function drawActivePiece(player) {
  if (!player.currentPiece || !player.ctx) return;
  const ctx = player.ctx;

  for (let r = 0; r < player.currentPiece.length; r++) {
    for (let c = 0; c < player.currentPiece[r].length; c++) {
      const type = player.currentPiece[r][c];
      if (type !== 0) {
        drawBlock(ctx, type, player.currentX + c, player.currentY + r);
      }
    }
  }
}

function drawHoldPiece(player) {
  const ctx = player.holdCtx;
  if (!ctx) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (player.heldPieceId === null) return;

  const piece = SHAPES[player.heldPieceId];
  const offsetX = (player.holdCanvas.width / BLOCK_SIZE - piece[0].length) / 2;
  const offsetY = (player.holdCanvas.height / BLOCK_SIZE - piece.length) / 2;

  for (let r = 0; r < piece.length; r++) {
    for (let c = 0; c < piece[r].length; c++) {
      const type = piece[r][c];
      if (type !== 0) {
        drawBlock(ctx, type, offsetX + c, offsetY + r);
      }
    }
  }
}

// TASTATUR INPUT
document.addEventListener('keydown', (e) => {
  if (listeningButton) {
    e.preventDefault();
    const playerKey = listeningButton.dataset.player === '1' ? 'p1' : 'p2';
    const action = listeningButton.dataset.action;

    controls[playerKey][action] = { type: 'key', code: e.code };
    localStorage.setItem('tetris_controls_v2', JSON.stringify(controls));

    listeningButton.classList.remove('listening');
    listeningButton = null;
    updateKeyLabels();
    return;
  }

  if (!gameActive) return;

  const activeKeys = gameMode === 'local' ? ['p1', 'p2'] : ['p1'];

  activeKeys.forEach((pKey, index) => {
    Object.keys(controls[pKey]).forEach(action => {
      const bind = controls[pKey][action];
      if (bind && bind.type === 'key' && bind.code === e.code) {
        handleAction(index, action);
      }
    });
  });
});

// EVENT LISTENER FÜR GAMEPAD ANSCHLUSS/TRENNUNG
window.addEventListener('gamepadconnected', (e) => {
  console.log('Gamepad verbunden:', e.gamepad.id);
});

window.addEventListener('gamepaddisconnected', (e) => {
  console.log('Gamepad getrennt:', e.gamepad.id);
});

// GAMEPAD INPUT POLLING
function pollGamepads(deltaTime) {
  const rawGamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  let connectedCount = 0;

  for (let gIndex = 0; gIndex < rawGamepads.length; gIndex++) {
    const gp = rawGamepads[gIndex];
    if (!gp) continue;
    connectedCount++;

    if (listeningButton) {
      for (let bIndex = 0; bIndex < gp.buttons.length; bIndex++) {
        if (gp.buttons[bIndex].pressed) {
          bindGamepadInput(listeningButton, { type: 'padButton', padIndex: gp.index, buttonIndex: bIndex });
          return;
        }
      }
      for (let aIndex = 0; aIndex < gp.axes.length; aIndex++) {
        if (Math.abs(gp.axes[aIndex]) > 0.6) {
          const dir = gp.axes[aIndex] > 0 ? 1 : -1;
          bindGamepadInput(listeningButton, { type: 'padAxis', padIndex: gp.index, axisIndex: aIndex, direction: dir });
          return;
        }
      }
    } else if (gameActive) {
      const activeKeys = gameMode === 'local' ? ['p1', 'p2'] : ['p1'];

      activeKeys.forEach((pKey, pIdx) => {
        Object.keys(controls[pKey]).forEach(action => {
          const bind = controls[pKey][action];
          if (!bind || (bind.type !== 'padButton' && bind.type !== 'padAxis')) return;

          let isPressed = false;

          if (bind.type === 'padButton' && gp.index === bind.padIndex) {
            isPressed = gp.buttons[bind.buttonIndex] && gp.buttons[bind.buttonIndex].pressed;
          } else if (bind.type === 'padAxis' && gp.index === bind.padIndex) {
            const axisVal = gp.axes[bind.axisIndex];
            isPressed = bind.direction > 0 ? axisVal > 0.5 : axisVal < -0.5;
          }

          const stateKey = `${pKey}_${action}`;
          const wasPressed = !!prevGamepadState[stateKey];

          if (isPressed) {
            if (!wasPressed) {
              handleAction(pIdx, action);
              gamepadRepeatTimers[stateKey] = 0;
            } else {
              gamepadRepeatTimers[stateKey] = (gamepadRepeatTimers[stateKey] || 0) + deltaTime;
              if (action === 'left' || action === 'right' || action === 'down') {
                if (gamepadRepeatTimers[stateKey] > 160) {
                  handleAction(pIdx, action);
                  gamepadRepeatTimers[stateKey] = 100;
                }
              }
            }
          }
          prevGamepadState[stateKey] = isPressed;
        });
      });
    }
  }

  const statusEl = document.getElementById('gamepad-status');
  if (statusEl) {
    statusEl.innerText = connectedCount > 0 ? `🎮 Controller: ${connectedCount} verbunden` : `🎮 Controller: Nicht erkannt`;
    statusEl.classList.toggle('active', connectedCount > 0);
  }
}

function bindGamepadInput(btnElement, bindObj) {
  const playerKey = btnElement.dataset.player === '1' ? 'p1' : 'p2';
  const action = btnElement.dataset.action;

  controls[playerKey][action] = bindObj;
  localStorage.setItem('tetris_controls_v2', JSON.stringify(controls));

  btnElement.classList.remove('listening');
  listeningButton = null;
  updateKeyLabels();
}

// MODAL UI
const modal = document.getElementById('settings-modal');
document.getElementById('open-settings-btn').addEventListener('click', () => modal.classList.add('active'));
document.getElementById('close-settings-btn').addEventListener('click', () => modal.classList.remove('active'));

function formatBindLabel(bind) {
  if (!bind) return '-';
  if (bind.type === 'key') return bind.code.replace('Key', '').replace('Arrow', '');
  if (bind.type === 'padButton') return `P${bind.padIndex + 1}-Btn${bind.buttonIndex}`;
  if (bind.type === 'padAxis') return `P${bind.padIndex + 1}-Axis${bind.axisIndex}${bind.direction > 0 ? '+' : '-'}`;
  return '-';
}

function updateKeyLabels() {
  document.querySelectorAll('.key-btn').forEach(btn => {
    const p = btn.dataset.player === '1' ? 'p1' : 'p2';
    const action = btn.dataset.action;
    btn.innerText = formatBindLabel(controls[p][action]);
  });
}

document.querySelectorAll('.key-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (listeningButton) listeningButton.classList.remove('listening');
    listeningButton = btn;
    btn.classList.add('listening');
    btn.innerText = 'Drücken...';
  });
});

updateKeyLabels();

// Starte den dauerhaften Loop direkt beim Laden der Datei
requestAnimationFrame(mainLoop);

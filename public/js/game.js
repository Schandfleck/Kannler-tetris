const socket = typeof io !== 'undefined' ? io() : null;

const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 24;

let gameMode = null; // 'solo', 'endless', 'local' oder 'online'
let currentRoomId = null;
let myOnlineIndex = 1;

// SOLO LEVEL & SCORE SYSTEM
let score = 0;
let level = 1;
let maxUnlockedLevel = parseInt(localStorage.getItem('tetris_unlocked_level')) || 1;
const TARGET_SCORE = 10000;

const LEVEL_SPEEDS = {
  1: 800,
  2: 700,
  3: 600,
  4: 500,
  5: 420,
  6: 350,
  7: 280,
  8: 220,
  9: 170,
  10: 120
};

let dropInterval = LEVEL_SPEEDS[1];

// AUDIO SETTINGS
const bgm = new Audio('/audio/bgm.mp3');
bgm.loop = true;
bgm.volume = parseFloat(localStorage.getItem('tetris_bgm_volume')) || 0.3;

function playBGM() {
  bgm.play().catch(() => {
    console.log('Autoplay blockiert – Musik wartet auf Interaktion.');
  });
}

function stopBGM() {
  bgm.pause();
  bgm.currentTime = 0;
}

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

// BASE SHAPES
const ORIGINAL_SHAPES = [
  [],
[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
[[2,0,0],[2,2,2],[0,0,0]],                // J
[[0,0,3],[3,3,3],[0,0,0]],                // L
[[4,4],[4,4]],                            // O
[[0,5,5],[5,5,0],[0,0,0]],                // S
[[0,6,0],[6,6,6],[0,0,0]],                // T
[[7,7,0],[0,7,7],[0,0,0]]                 // Z
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
    drop: { type: 'key', code: 'ArrowDown' },
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
  if (gameMode === 'local' || gameMode === 'solo' || gameMode === 'endless') {
    if (event.data.type === 'START_GAME') startCountdown();
    else if (event.data.type === 'RESET_GAME') resetGame();
  }
};

document.getElementById('btn-solo-mode').addEventListener('click', () => {
  document.getElementById('mode-selection').classList.add('hidden');
  renderSoloLevelSelection();
});

document.getElementById('btn-back-to-menu')?.addEventListener('click', () => {
  document.getElementById('solo-level-selection').classList.add('hidden');
  document.getElementById('mode-selection').classList.remove('hidden');
});

document.getElementById('btn-local-mode').addEventListener('click', () => {
  gameMode = 'local';
  setupGameUI();
});

document.getElementById('btn-online-mode').addEventListener('click', () => {
  gameMode = 'online';
  if (socket) socket.emit('find_match');
});

function renderSoloLevelSelection() {
  const container = document.getElementById('level-buttons-container');
  const endlessBtn = document.getElementById('btn-endless-mode');

  if (!container) return;

  container.innerHTML = '';
  document.getElementById('solo-level-selection').classList.remove('hidden');

  if (endlessBtn) {
    endlessBtn.onclick = () => {
      gameMode = 'endless';
      dropInterval = 800;
      document.getElementById('solo-level-selection').classList.add('hidden');
      setupGameUI();
      startCountdown();
    };
  }

  for (let lvl = 1; lvl <= 10; lvl++) {
    const btn = document.createElement('button');
    btn.style.padding = '15px';
    btn.style.fontSize = '1.1rem';
    btn.style.cursor = 'pointer';

    const isUnlocked = lvl <= maxUnlockedLevel;

    if (isUnlocked) {
      btn.innerText = `Lvl ${lvl}\n⚡ ${LEVEL_SPEEDS[lvl]}ms`;
      btn.style.backgroundColor = '#00f0f0';
      btn.style.color = '#000';
      btn.style.fontWeight = 'bold';
      btn.addEventListener('click', () => {
        gameMode = 'solo';
        level = lvl;
        dropInterval = LEVEL_SPEEDS[lvl] || 800;
        document.getElementById('solo-level-selection').classList.add('hidden');
        setupGameUI();
        startCountdown();
      });
    } else {
      btn.innerText = `Lvl ${lvl}\n🔒 Gesperrt`;
      btn.style.backgroundColor = '#444';
      btn.style.color = '#888';
      btn.disabled = true;
    }

    container.appendChild(btn);
  }
}

function setupGameUI() {
  document.getElementById('mode-selection').classList.add('hidden');
  document.getElementById('game-wrapper').classList.remove('hidden');

  if (gameMode === 'solo' || gameMode === 'endless') {
    document.getElementById('player-2-area').classList.add('hidden');
    document.getElementById('p2-controls-col').style.display = 'none';
    document.getElementById('room-display').classList.add('hidden');
    document.getElementById('score-display').classList.remove('hidden');
    document.getElementById('p1-title').innerText = gameMode === 'endless' ? 'Endlos Modus' : `Solo - Level ${level}`;
  } else if (gameMode === 'local') {
    document.getElementById('player-2-area').classList.remove('hidden');
    document.getElementById('p2-controls-col').style.display = 'block';
    document.getElementById('room-display').classList.add('hidden');
    document.getElementById('score-display').classList.add('hidden');
    document.getElementById('p1-title').innerText = 'Spieler 1';
  }
  initGame();
}

if (socket) {
  socket.on('init_player', ({ playerIndex, roomId }) => {
    myOnlineIndex = playerIndex;
    currentRoomId = roomId;
    document.getElementById('mode-selection').classList.add('hidden');
    document.getElementById('game-wrapper').classList.remove('hidden');
    document.getElementById('player-2-area').classList.add('hidden');
    document.getElementById('p2-controls-col').style.display = 'none';
    document.getElementById('score-display').classList.add('hidden');

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

  socket.on('referee_start_game', () => startCountdown());
  socket.on('referee_reset_game', () => resetGame());

  socket.on('receive_garbage', ({ lines }) => {
    if (gameActive && players[0]) sendGarbage(players[0], lines);
  });

    socket.on('opponent_game_over', () => {
      gameActive = false;
      stopBGM();
      document.getElementById('status').innerText = '🏆 GEGNER HAT VERLOREN – DU GEWINNST!';
      document.getElementById('status').style.color = '#00ff88';
    });

    socket.on('opponent_disconnected', () => {
      gameActive = false;
      stopBGM();
      document.getElementById('status').innerText = '❌ Gegner hat die Verbindung getrennt.';
      document.getElementById('status').style.color = '#ff0055';
    });
}

function getRandomPieceId() {
  return Math.floor(Math.random() * 7) + 1;
}

function createPlayer(id) {
  return {
    id: id,
    canvas: document.getElementById(`board-${id}`),
    ctx: document.getElementById(`board-${id}`)?.getContext('2d'),
    holdCanvas: document.getElementById(`hold-board-${id}`),
    holdCtx: document.getElementById(`hold-board-${id}`)?.getContext('2d'),
    nextCanvas: document.getElementById(`next-board-${id}`),
    nextCtx: document.getElementById(`next-board-${id}`)?.getContext('2d'),
    grid: createGrid(),
    currentPiece: null,
    currentPieceId: null,
    rotationIndex: 0,
    nextPieceId: getRandomPieceId(),
    currentX: 0,
    currentY: 0,
    heldPieceId: null,
    canHold: true,
    dropCounter: 0
  };
}

let players = [];

function initGame() {
  score = 0;
  if (gameMode === 'solo') {
    dropInterval = LEVEL_SPEEDS[level] || 800;
  } else {
    dropInterval = 800;
  }
  updateScoreUI();

  if (gameMode === 'local') {
    players = [createPlayer(1), createPlayer(2)];
  } else {
    players = [createPlayer(1)];
  }
  draw();
}

function updateScoreUI() {
  const scoreVal = document.getElementById('score-val');
  const levelVal = document.getElementById('level-val');

  if (scoreVal) {
    if (gameMode === 'endless') {
      scoreVal.innerText = `${score} (Endlos)`;
    } else {
      scoreVal.innerText = `${score} / ${TARGET_SCORE}`;
    }
  }

  if (levelVal) {
    if (gameMode === 'endless') {
      const currentEndlessLevel = Math.floor(score / 1000) + 1;
      levelVal.innerText = `Endlos (Lvl ${currentEndlessLevel})`;
    } else {
      levelVal.innerText = level;
    }
  }
}

function createGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function startCountdown() {
  if (gameActive || isCountingDown) return;

  stopBGM();
  score = 0;
  if (gameMode === 'solo') {
    dropInterval = LEVEL_SPEEDS[level] || 800;
  } else {
    dropInterval = 800;
  }
  updateScoreUI();

  players.forEach(p => {
    p.grid = createGrid();
    p.heldPieceId = null;
    p.canHold = true;
    p.nextPieceId = getRandomPieceId();
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
      playBGM();
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
  stopBGM();
  initGame();

  document.getElementById('status').innerText = 'Warte auf Freigabe...';
  document.getElementById('status').style.color = '#ffaa00';
}

function spawnPiece(player, specificId = null) {
  if (specificId !== null) {
    player.currentPieceId = specificId;
  } else {
    player.currentPieceId = player.nextPieceId;
    player.nextPieceId = getRandomPieceId();
  }

  player.currentPiece = ORIGINAL_SHAPES[player.currentPieceId];
  player.rotationIndex = 0;
  player.currentY = 0;
  player.currentX = Math.floor((COLS - player.currentPiece[0].length) / 2);
  player.canHold = true;

  if (collide(player.grid, player.currentPiece, player.currentX, player.currentY)) {
    gameActive = false;
    stopBGM();

    if (gameMode === 'solo') {
      document.getElementById('status').innerText = `💥 GAME OVER – SCORE: ${score}/${TARGET_SCORE}`;
    } else if (gameMode === 'endless') {
      document.getElementById('status').innerText = `💥 GAME OVER – ENDSCORE: ${score} PUNKTE!`;
    } else if (gameMode === 'local') {
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

function getPieceBounds(piece) {
  let minR = piece.length, maxR = -1;
  let minC = piece[0].length, maxC = -1;

  for (let r = 0; r < piece.length; r++) {
    for (let c = 0; c < piece[r].length; c++) {
      if (piece[r][c] !== 0) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }

  return {
    minR, maxR,
    minC, maxC,
    rows: maxR - minR + 1,
    cols: maxC - minC + 1
  };
}

function mergePiece(player) {
  const piece = player.currentPiece;
  const type = player.currentPieceId;
  const baseShape = ORIGINAL_SHAPES[type];
  const bounds = getPieceBounds(baseShape);
  const N = piece.length;

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (piece[r][c] !== 0) {
        let origR = r;
        let origC = c;

        // Rückrechnung der Rotationen für das Original-Quellbild
        if (player.rotationIndex === 1) {
          origR = N - 1 - c;
          origC = r;
        } else if (player.rotationIndex === 2) {
          origR = N - 1 - r;
          origC = N - 1 - c;
        } else if (player.rotationIndex === 3) {
          origR = c;
          origC = N - 1 - r;
        }

        const localC = origC - bounds.minC;
        const localR = origR - bounds.minR;

        player.grid[player.currentY + r][player.currentX + c] = {
          type: type,
          rot: player.rotationIndex,
          localC: localC,
          localR: localR
        };
      }
    }
  }
  clearLines(player);
  if (gameActive) {
    spawnPiece(player);
  }
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

  if (clearedLines > 0) {
    if (gameMode === 'solo' || gameMode === 'endless') {
      const pointsTable = [0, 100, 300, 500, 800];
      score += pointsTable[clearedLines] || (clearedLines * 200);

      if (gameMode === 'endless') {
        const speedMultiplier = Math.floor(score / 1000);
        dropInterval = Math.max(50, 800 - (speedMultiplier * 40));
      }

      updateScoreUI();

      if (gameMode === 'solo' && score >= TARGET_SCORE) {
        gameActive = false;
        stopBGM();

        const statusEl = document.getElementById('status');
        statusEl.innerText = `🎉 LEVEL ${level} GESCHAFFT! KEHRE INS MENÜ ZURÜCK...`;
        statusEl.style.color = '#00ff88';

        if (level >= maxUnlockedLevel) {
          maxUnlockedLevel = level + 1;
          localStorage.setItem('tetris_unlocked_level', maxUnlockedLevel);
        }

        setTimeout(() => {
          document.getElementById('game-wrapper').classList.add('hidden');
          renderSoloLevelSelection();
        }, 2000);
      }
    } else {
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
      player.rotationIndex = (player.rotationIndex + (dir === 'left' ? 3 : 1)) % 4;
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

function mainLoop(time = 0) {
  const deltaTime = time - lastTime;
  lastTime = time;

  pollGamepads(deltaTime);

  if (gameActive) {
    players.forEach(p => {
      p.dropCounter += deltaTime;
      if (p.dropCounter > dropInterval) {
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
    drawNextPiece(p);
  });
}

function drawBlock(ctx, cellData, x, y) {
  if (!ctx || !cellData) return;
  const px = x * BLOCK_SIZE;
  const py = y * BLOCK_SIZE;

  const type = typeof cellData === 'object' ? cellData.type : cellData;
  const img = blockImagesLoaded[type];

  if (img && img.complete && img.naturalWidth !== 0 && typeof cellData === 'object') {
    const { rot, localC, localR } = cellData;
    const baseShape = ORIGINAL_SHAPES[type];
    const bounds = getPieceBounds(baseShape);

    // Bildausschnitt der ungedrehten Grundform
    const sourceX = (localC / bounds.cols) * img.naturalWidth;
    const sourceY = (localR / bounds.rows) * img.naturalHeight;
    const sourceW = img.naturalWidth / bounds.cols;
    const sourceH = img.naturalHeight / bounds.rows;

    ctx.save();
    ctx.translate(px + BLOCK_SIZE / 2, py + BLOCK_SIZE / 2);

    // Drehung um die eigene Achse für den jeweiligen Sub-Block
    ctx.rotate((rot * 90 * Math.PI) / 180);

    ctx.drawImage(
      img,
      sourceX, sourceY, sourceW, sourceH,
      -BLOCK_SIZE / 2, -BLOCK_SIZE / 2, BLOCK_SIZE, BLOCK_SIZE
    );

    ctx.restore();
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
      const cell = player.grid[r][c];
      if (cell !== 0) {
        drawBlock(ctx, cell, c, r);
      }
    }
  }
}

function drawActivePiece(player) {
  if (!player.currentPiece || !player.ctx) return;

  const ctx = player.ctx;
  const type = player.currentPieceId;
  const baseShape = ORIGINAL_SHAPES[type];
  const bounds = getPieceBounds(baseShape);
  const N = player.currentPiece.length;

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (player.currentPiece[r][c] !== 0) {
        let origR = r;
        let origC = c;

        if (player.rotationIndex === 1) {
          origR = N - 1 - c;
          origC = r;
        } else if (player.rotationIndex === 2) {
          origR = N - 1 - r;
          origC = N - 1 - c;
        } else if (player.rotationIndex === 3) {
          origR = c;
          origC = N - 1 - r;
        }

        const localC = origC - bounds.minC;
        const localR = origR - bounds.minR;

        const boardX = player.currentX + c;
        const boardY = player.currentY + r;

        const cellData = {
          type: type,
          rot: player.rotationIndex,
          localC: localC,
          localR: localR
        };

        drawBlock(ctx, cellData, boardX, boardY);
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

function drawHoldPiece(player) {
  const ctx = player.holdCtx;
  if (!ctx) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (player.heldPieceId === null) return;

  const type = player.heldPieceId;
  const piece = ORIGINAL_SHAPES[type];
  const bounds = getPieceBounds(piece);
  const img = blockImagesLoaded[type];

  const offsetX = (player.holdCanvas.width - bounds.cols * BLOCK_SIZE) / 2;
  const offsetY = (player.holdCanvas.height - bounds.rows * BLOCK_SIZE) / 2;

  if (img && img.complete && img.naturalWidth !== 0) {
    ctx.drawImage(img, offsetX, offsetY, bounds.cols * BLOCK_SIZE, bounds.rows * BLOCK_SIZE);
  } else {
    for (let r = 0; r < piece.length; r++) {
      for (let c = 0; c < piece[r].length; c++) {
        if (piece[r][c] !== 0) {
          drawBlock(ctx, type, (offsetX / BLOCK_SIZE) + c, (offsetY / BLOCK_SIZE) + r);
        }
      }
    }
  }
}

function drawNextPiece(player) {
  const ctx = player.nextCtx;
  if (!ctx) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (player.nextPieceId === null) return;

  const type = player.nextPieceId;
  const piece = ORIGINAL_SHAPES[type];
  const bounds = getPieceBounds(piece);
  const img = blockImagesLoaded[type];

  const offsetX = (player.nextCanvas.width - bounds.cols * BLOCK_SIZE) / 2;
  const offsetY = (player.nextCanvas.height - bounds.rows * BLOCK_SIZE) / 2;

  if (img && img.complete && img.naturalWidth !== 0) {
    ctx.drawImage(img, offsetX, offsetY, bounds.cols * BLOCK_SIZE, bounds.rows * BLOCK_SIZE);
  } else {
    for (let r = 0; r < piece.length; r++) {
      for (let c = 0; c < piece[r].length; c++) {
        if (piece[r][c] !== 0) {
          drawBlock(ctx, type, (offsetX / BLOCK_SIZE) + c, (offsetY / BLOCK_SIZE) + r);
        }
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

window.addEventListener('gamepadconnected', (e) => {
  console.log('Gamepad verbunden:', e.gamepad.id);
});

window.addEventListener('gamepaddisconnected', (e) => {
  console.log('Gamepad getrennt:', e.gamepad.id);
});

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

// MODAL & AUDIO UI
const modal = document.getElementById('settings-modal');
document.getElementById('open-settings-btn').addEventListener('click', () => modal.classList.add('active'));
document.getElementById('close-settings-btn').addEventListener('click', () => modal.classList.remove('active'));

const volumeSlider = document.getElementById('bgm-volume-slider');
if (volumeSlider) {
  volumeSlider.value = bgm.volume;
  volumeSlider.addEventListener('input', (e) => {
    bgm.volume = parseFloat(e.target.value);
    localStorage.setItem('tetris_bgm_volume', bgm.volume);
  });
}

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
requestAnimationFrame(mainLoop);

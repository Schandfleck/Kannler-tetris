const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Stellt statische Dateien bereit (inklusive /referee/index.html)
app.use(express.static('public'));

const rooms = {};

// Hilfsfunktion: Generiert einen 6-stelligen eindeutigen Turnier-Code
function generateTournamentCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms[code]);
  return code;
}

// Hilfsfunktion: Sucht einen offenen Raum mit < 2 Spielern oder erstellt einen neuen
function findOrCreateRoom() {
  for (const roomId in rooms) {
    if (!rooms[roomId].isTournament && rooms[roomId].players.length < 2) {
      return roomId;
    }
  }
  return 'room_' + Math.random().toString(36).substring(2, 9);
}

// Hilfsfunktion: Übersicht aller Räume an alle Clients/Referees senden
function emitRoomOverview() {
  const overview = Object.keys(rooms).map(id => ({
    id: id,
    playerCount: rooms[id].players.length,
    status: rooms[id].status,
    isTournament: !!rooms[id].isTournament
  }));
  io.emit('referee_room_list', overview);
}

io.on('connection', (socket) => {
  console.log('Neuer Client verbunden:', socket.id);

  // Sendet dem neu verbundenen Client (z. B. Referee) sofort den aktuellen Raumstatus
  emitRoomOverview();

  // --- TURNIER-LOBBY ERSTELLEN ODER BETRETEN ---
  socket.on('create_tournament_room', (callback) => {
    const code = generateTournamentCode();
    rooms[code] = { id: code, players: [], status: 'waiting', isTournament: true };

    rooms[code].players.push(socket.id);
    socket.join(code);

    socket.emit('init_player', { playerIndex: 1, roomId: code });

    io.to(code).emit('player_status_update', {
      playerCount: rooms[code].players.length,
      readyToStart: rooms[code].players.length === 2
    });

    emitRoomOverview();
    if (typeof callback === 'function') callback({ success: true, code });
  });

  socket.on('join_tournament_room', ({ code }, callback) => {
    const roomId = code ? code.trim().toUpperCase() : '';
    const room = rooms[roomId];

    if (!room) {
      if (typeof callback === 'function') callback({ success: false, message: 'Turnier-Code nicht gefunden.' });
      return;
    }

    if (room.players.includes(socket.id)) {
      // Bereits im Raum (z. B. Reconnect nach Reload)
      socket.join(roomId);
      const pIndex = room.players.indexOf(socket.id) + 1;
      socket.emit('init_player', { playerIndex: pIndex, roomId });
      if (typeof callback === 'function') callback({ success: true, code: roomId });
      return;
    }

    if (room.players.length >= 2) {
      if (typeof callback === 'function') callback({ success: false, message: 'Turnier-Lobby ist bereits voll.' });
      return;
    }

    room.players.push(socket.id);
    socket.join(roomId);

    const playerIndex = room.players.length;
    socket.emit('init_player', { playerIndex, roomId });

    io.to(roomId).emit('player_status_update', {
      playerCount: room.players.length,
      readyToStart: room.players.length === 2
    });

    emitRoomOverview();
    if (typeof callback === 'function') callback({ success: true, code: roomId });
  });

  // --- SPIELER MATCHMAKING (Standard Online) ---
  socket.on('find_match', () => {
    const roomId = findOrCreateRoom();

    if (!rooms[roomId]) {
      rooms[roomId] = { id: roomId, players: [], status: 'waiting', isTournament: false };
    }

    const room = rooms[roomId];
    room.players.push(socket.id);
    socket.join(roomId);

    const playerIndex = room.players.length;
    socket.emit('init_player', { playerIndex, roomId });

    io.to(roomId).emit('player_status_update', {
      playerCount: room.players.length,
      readyToStart: room.players.length === 2
    });

    emitRoomOverview();
  });

  // --- REFEREE STEUERUNG ---
  socket.on('referee_get_rooms', () => {
    emitRoomOverview();
  });

  socket.on('referee_start_room', ({ roomId }) => {
    if (rooms[roomId] && rooms[roomId].players.length === 2) {
      rooms[roomId].status = 'running';
      io.to(roomId).emit('referee_start_game');
      emitRoomOverview();
    }
  });

  socket.on('referee_reset_room', ({ roomId }) => {
    if (rooms[roomId]) {
      rooms[roomId].status = 'waiting';
      io.to(roomId).emit('referee_reset_game');
      emitRoomOverview();
    }
  });

  // --- GAMEPLAY EVENTS ---
  socket.on('send_garbage', (data) => {
    socket.to(data.roomId).emit('receive_garbage', data);
  });

  socket.on('game_over', (data) => {
    socket.to(data.roomId).emit('opponent_game_over');
    if (rooms[data.roomId]) {
      rooms[data.roomId].status = 'finished';
      emitRoomOverview();
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        io.to(roomId).emit('opponent_disconnected');

        if (room.players.length === 0) {
          delete rooms[roomId];
        } else {
          room.status = 'waiting';
        }
        emitRoomOverview();
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Stellt statische Dateien bereit (inklusive /referee/index.html)
app.use(express.static('public'));

const rooms = {};

// Hilfsfunktion: Sucht einen offenen Raum mit < 2 Spielern oder erstellt einen neuen
function findOrCreateRoom() {
  for (const roomId in rooms) {
    if (rooms[roomId].players.length < 2) {
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
    status: rooms[id].status
  }));
  io.emit('referee_room_list', overview);
}

io.on('connection', (socket) => {
  console.log('Neuer Client verbunden:', socket.id);

  // Sendet dem neu verbundenen Client (z. B. Referee) sofort den aktuellen Raumstatus
  emitRoomOverview();

  // --- SPIELER MATCHMAKING ---
  socket.on('find_match', () => {
    const roomId = findOrCreateRoom();

    if (!rooms[roomId]) {
      rooms[roomId] = { id: roomId, players: [], status: 'waiting' };
    }

    const room = rooms[roomId];
    room.players.push(socket.id);
    socket.join(roomId);

    const playerIndex = room.players.length;
    socket.emit('init_player', { playerIndex, roomId });

    // Informiere den Raum über den aktuellen Status
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

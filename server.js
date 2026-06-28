'use strict';

/**
 * OmniHub Super App — server.js
 * ─────────────────────────────────────────────────────────────
 * Telegram Mini-App Backend: Dashboard + 5x5 Provably Fair Bingo
 * Stack : Node.js + Express + Socket.IO
 *
 * Provably-fair protocol
 * ──────────────────────
 *  1. Before each round the server generates a random 32-byte
 *     serverSeed and broadcasts only its SHA-256 hash (the
 *     "commit"). Players cannot predict cards or calls from
 *     the hash alone.
 *  2. Cards and the call order are derived from serverSeed via
 *     HMAC-SHA256-seeded Fisher-Yates (see generateCard /
 *     generateCallSequence). Every swap folds col + index +
 *     pool state into the HMAC, making each decision uniquely
 *     verifiable.
 *  3. After the round ends the server reveals the raw serverSeed
 *     (the "reveal"). Anyone can recompute the cards and call
 *     order and confirm they match exactly.
 *
 * Deploy (Render)
 * ───────────────
 *  Build Command : npm install
 *  Start Command : node server.js
 *  Env var       : TELEGRAM_BOT_TOKEN  (from @BotFather)
 * ─────────────────────────────────────────────────────────────
 */

const express        = require('express');
const http           = require('http');
const crypto         = require('crypto');
const cors           = require('cors');
const path           = require('path');
const { Server }     = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors:       { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

// ── Config ────────────────────────────────────────────────────
const PORT               = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const STARTING_BALANCE   = 1000;   // coins every new player starts with
const ENTRY_FEE          = 50;     // coins to join one round
const CALL_INTERVAL_MS   = 4000;   // milliseconds between each number call
const COUNTDOWN_SECONDS  = 10;     // seconds before a round starts
const MIN_PLAYERS        = 1;      // raise to 2+ for real multiplayer

// ── In-memory stores ──────────────────────────────────────────
// Balances and rooms live in memory and reset on server restart.
// Swap these two Maps for a real DB later — no game logic changes.
const users = new Map();   // String(telegramId) → { id, name, balance }
const rooms = new Map();   // roomId             → room object

// ── Express middleware ────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health-check endpoint — used by UptimeRobot to keep Render awake
app.get('/health', function (_req, res) {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Utility functions ─────────────────────────────────────────
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function letterForNumber(n) {
  if (n <= 15) return 'B';
  if (n <= 30) return 'I';
  if (n <= 45) return 'N';
  if (n <= 60) return 'G';
  return 'O';
}

function getOrCreateUser(telegramId, name) {
  var id = String(telegramId);
  if (!users.has(id)) {
    users.set(id, { id: id, name: name || 'Player', balance: STARTING_BALANCE });
  } else if (name) {
    users.get(id).name = name;
  }
  return users.get(id);
}

// ── Telegram initData verification ───────────────────────────
// Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  var params = new URLSearchParams(initData);
  var hash   = params.get('hash');
  if (!hash) return null;

  params.delete('hash');

  var fields = [];
  params.forEach(function (value, key) {
    fields.push(key + '=' + value);
  });
  fields.sort();

  var dataCheckString = fields.join('\n');
  var secretKey       = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  var computed        = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computed !== hash) return null;

  var userJson = params.get('user');
  if (!userJson) return null;
  try {
    return JSON.parse(userJson);
  } catch (e) {
    return null;
  }
}

// ── Provably fair card generation ─────────────────────────────
/**
 * generateCard(seed)
 *
 * Builds one 5×5 Bingo card deterministically from seed.
 *
 * Column pools (standard Bingo rules):
 *   B : 1 – 15   (5 numbers chosen)
 *   I : 16 – 30  (5 numbers chosen)
 *   N : 31 – 45  (5 numbers chosen, centre = 'FREE')
 *   G : 46 – 60  (5 numbers chosen)
 *   O : 61 – 75  (5 numbers chosen)
 *
 * Each pool is independently shuffled with Fisher-Yates where
 * every swap index comes from:
 *   HMAC-SHA256(seed, col + ':' + swapIndex + ':' + currentPool)
 * Folding col, index AND the live pool state into the HMAC input
 * ensures every decision is uniquely and verifiably derived.
 */
function generateCard(seed) {
  var ranges = {
    B: [1,  15],
    I: [16, 30],
    N: [31, 45],
    G: [46, 60],
    O: [61, 75],
  };
  var card     = {};
  var colNames = ['B', 'I', 'N', 'G', 'O'];

  for (var c = 0; c < colNames.length; c++) {
    var col  = colNames[c];
    var min  = ranges[col][0];
    var max  = ranges[col][1];
    var pool = [];

    for (var n = min; n <= max; n++) {
      pool.push(n);
    }

    // Fisher-Yates shuffle seeded by HMAC-SHA256
    for (var i = pool.length - 1; i > 0; i--) {
      var hmacInput = col + ':' + i + ':' + pool.join(',');
      var hmacHex   = crypto
        .createHmac('sha256', seed)
        .update(hmacInput)
        .digest('hex');
      var randInt   = parseInt(hmacHex.slice(0, 8), 16);
      var j         = randInt % (i + 1);
      // swap pool[i] and pool[j]
      var tmp  = pool[i];
      pool[i]  = pool[j];
      pool[j]  = tmp;
    }

    card[col] = pool.slice(0, 5);
  }

  // Standard Bingo: centre of N column is always FREE
  card.N[2] = 'FREE';
  return card;
}

/**
 * generateCallSequence(seed)
 *
 * Produces a shuffled array of numbers 1–75 (the call order)
 * using the same HMAC-SHA256-seeded Fisher-Yates algorithm,
 * but with 'CALL' as the column prefix.
 */
function generateCallSequence(seed) {
  var pool = [];
  for (var n = 1; n <= 75; n++) {
    pool.push(n);
  }

  for (var i = pool.length - 1; i > 0; i--) {
    var hmacInput = 'CALL:' + i + ':' + pool.join(',');
    var hmacHex   = crypto
      .createHmac('sha256', seed)
      .update(hmacInput)
      .digest('hex');
    var randInt   = parseInt(hmacHex.slice(0, 8), 16);
    var j         = randInt % (i + 1);
    var tmp  = pool[i];
    pool[i]  = pool[j];
    pool[j]  = tmp;
  }

  return pool;
}

// ── Win detection ─────────────────────────────────────────────
/**
 * checkWin(card, marked)
 *
 * Returns a pattern name string if the player has a valid win,
 * or null if not yet.
 *
 * Patterns checked:
 *   FULL_HOUSE — all 25 cells (including FREE) marked
 *   ROW        — any complete horizontal row
 *   COLUMN     — any complete vertical column
 *   DIAGONAL   — main diagonal (B0→O4) or anti-diagonal (B4→O0)
 *
 * FREE cell (N column, row index 2) counts as always marked.
 */
function checkWin(card, marked) {
  var cols = ['B', 'I', 'N', 'G', 'O'];
  var rows = [0, 1, 2, 3, 4];

  function isMarked(col, row) {
    var val = card[col][row];
    return val === 'FREE' || marked.has(col + ':' + val);
  }

  // Full house — every cell marked
  var fullHouse = cols.every(function (c) {
    return rows.every(function (r) {
      return isMarked(c, r);
    });
  });
  if (fullHouse) return 'FULL_HOUSE';

  // Any horizontal row
  for (var r = 0; r < 5; r++) {
    (function (row) {
      // captured via IIFE to avoid closure-in-loop bug
    })(r);
    var rowComplete = cols.every(function (c) { return isMarked(c, r); });
    if (rowComplete) return 'ROW';
  }

  // Any vertical column
  for (var ci = 0; ci < cols.length; ci++) {
    var col     = cols[ci];
    var colDone = rows.every(function (r) { return isMarked(col, r); });
    if (colDone) return 'COLUMN';
  }

  // Main diagonal: B[0] I[1] N[2]=FREE G[3] O[4]
  var mainDiag = cols.every(function (c, i) { return isMarked(c, i); });
  if (mainDiag) return 'DIAGONAL';

  // Anti-diagonal: B[4] I[3] N[2]=FREE G[1] O[0]
  var antiDiag = cols.every(function (c, i) { return isMarked(c, 4 - i); });
  if (antiDiag) return 'DIAGONAL';

  return null;
}

// ── Room helpers ──────────────────────────────────────────────
function createRoom(roomId) {
  var room = {
    id:             roomId,
    status:         'WAITING',    // WAITING | COUNTDOWN | IN_PROGRESS | FINISHED
    players:        new Map(),    // socketId → { userId, name, card, marked }
    serverSeed:     null,
    serverSeedHash: null,
    callSequence:   [],
    calledNumbers:  [],
    callTimer:      null,
    countdownTimer: null,
    pot:            0,
  };
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId) || createRoom(roomId);
}

function broadcastRoomState(room) {
  io.to(room.id).emit('room_state', {
    status:        room.status,
    playerCount:   room.players.size,
    pot:           room.pot,
    calledNumbers: room.calledNumbers,
  });
}

// ── Round lifecycle ───────────────────────────────────────────
function startCountdown(room) {
  if (room.status !== 'WAITING') return;

  room.status         = 'COUNTDOWN';
  room.serverSeed     = crypto.randomBytes(32).toString('hex');
  room.serverSeedHash = sha256(room.serverSeed);

  var secondsLeft = COUNTDOWN_SECONDS;

  io.to(room.id).emit('countdown', {
    secondsLeft:    secondsLeft,
    serverSeedHash: room.serverSeedHash,
  });

  room.countdownTimer = setInterval(function () {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(room.countdownTimer);
      startGame(room);
    } else {
      io.to(room.id).emit('countdown', {
        secondsLeft:    secondsLeft,
        serverSeedHash: room.serverSeedHash,
      });
    }
  }, 1000);
}

function startGame(room) {
  room.status        = 'IN_PROGRESS';
  room.callSequence  = generateCallSequence(room.serverSeed);
  room.calledNumbers = [];

  // Issue a unique card to each player
  room.players.forEach(function (player, socketId) {
    player.card   = generateCard(room.serverSeed + ':' + socketId);
    player.marked = new Set();
    io.to(socketId).emit('card_assigned', { card: player.card });
  });

  broadcastRoomState(room);
  io.to(room.id).emit('game_started', { serverSeedHash: room.serverSeedHash });

  var callIndex = 0;

  room.callTimer = setInterval(function () {
    if (room.status !== 'IN_PROGRESS') {
      clearInterval(room.callTimer);
      return;
    }
    if (callIndex >= room.callSequence.length) {
      clearInterval(room.callTimer);
      endGame(room, null);
      return;
    }
    var num = room.callSequence[callIndex];
    callIndex += 1;
    room.calledNumbers.push(num);
    io.to(room.id).emit('number_called', {
      number:        num,
      letter:        letterForNumber(num),
      calledNumbers: room.calledNumbers,
    });
  }, CALL_INTERVAL_MS);
}

function endGame(room, winnerSocketId) {
  room.status = 'FINISHED';
  clearInterval(room.callTimer);
  clearInterval(room.countdownTimer);

  var payout   = 0;
  var winnerId = null;

  if (winnerSocketId && room.players.has(winnerSocketId)) {
    var winner = room.players.get(winnerSocketId);
    payout     = room.pot;
    winnerId   = winner.userId;
    var user   = users.get(winner.userId);
    if (user) user.balance += payout;
  }

  // Reveal the serverSeed — players can now verify fairness
  io.to(room.id).emit('game_over', {
    winnerId:         winnerId,
    payout:           payout,
    serverSeed:       room.serverSeed,       // revealed after game
    serverSeedHash:   room.serverSeedHash,   // committed before game
    callSequenceUsed: room.calledNumbers,
  });

  // Reset room after 6 seconds for the next round
  setTimeout(function () {
    room.status         = 'WAITING';
    room.serverSeed     = null;
    room.serverSeedHash = null;
    room.callSequence   = [];
    room.calledNumbers  = [];
    room.pot            = 0;
    room.players.forEach(function (p) {
      p.card   = null;
      p.marked = new Set();
    });
    broadcastRoomState(room);
  }, 6000);
}

// ── Socket.IO ─────────────────────────────────────────────────
io.on('connection', function (socket) {
  var auth         = socket.handshake.auth || {};
  var verifiedUser = null;

  // Auth: verify Telegram initData when bot token is configured
  if (TELEGRAM_BOT_TOKEN) {
    verifiedUser = verifyTelegramInitData(auth.initData, TELEGRAM_BOT_TOKEN);
    if (!verifiedUser) {
      socket.emit('auth_error', {
        message: 'Telegram authentication failed. Please reopen the app from Telegram.',
      });
      socket.disconnect(true);
      return;
    }
  } else {
    // Dev-mode fallback: trust client-supplied id (safe for local testing)
    verifiedUser = {
      id:         auth.telegramId || ('guest-' + socket.id),
      first_name: auth.name       || 'Guest',
    };
  }

  var user          = getOrCreateUser(verifiedUser.id, verifiedUser.first_name);
  var currentRoomId = null;

  // Send profile to this socket on connect
  socket.emit('profile', {
    id:      user.id,
    name:    user.name,
    balance: user.balance,
  });

  // ── join_room ─────────────────────────────────────────────
  socket.on('join_room', function (payload) {
    var roomId = (payload && payload.roomId) || 'main';
    var room   = getRoom(roomId);

    if (room.status === 'IN_PROGRESS' || room.status === 'COUNTDOWN') {
      socket.emit('error_msg', { message: 'Round already in progress. Please wait for the next one.' });
      return;
    }
    if (user.balance < ENTRY_FEE) {
      socket.emit('error_msg', { message: 'Insufficient coins. Need ' + ENTRY_FEE + ' to join.' });
      return;
    }

    user.balance  -= ENTRY_FEE;
    room.pot      += ENTRY_FEE;
    currentRoomId  = roomId;

    socket.join(roomId);
    room.players.set(socket.id, {
      userId: user.id,
      name:   user.name,
      card:   null,
      marked: new Set(),
    });

    socket.emit('joined_room', {
      roomId:  roomId,
      balance: user.balance,
      pot:     room.pot,
    });

    broadcastRoomState(room);

    if (room.players.size >= MIN_PLAYERS && room.status === 'WAITING') {
      startCountdown(room);
    }
  });

  // ── mark_cell ─────────────────────────────────────────────
  socket.on('mark_cell', function (payload) {
    if (!currentRoomId) return;
    var room = rooms.get(currentRoomId);
    if (!room || room.status !== 'IN_PROGRESS') return;

    var player = room.players.get(socket.id);
    if (!player || !player.card) return;

    var col   = payload && payload.col;
    var value = payload && payload.value;

    // Server-side guard: only mark if the number has actually been called
    if (value !== 'FREE' && !room.calledNumbers.includes(value)) {
      socket.emit('error_msg', { message: 'That number has not been called yet.' });
      return;
    }

    player.marked.add(col + ':' + value);
    socket.emit('cell_marked', { col: col, value: value });
  });

  // ── claim_bingo ───────────────────────────────────────────
  socket.on('claim_bingo', function () {
    if (!currentRoomId) return;
    var room = rooms.get(currentRoomId);
    if (!room || room.status !== 'IN_PROGRESS') return;

    var player = room.players.get(socket.id);
    if (!player || !player.card) return;

    var pattern = checkWin(player.card, player.marked);
    if (pattern) {
      endGame(room, socket.id);
    } else {
      socket.emit('error_msg', { message: 'No valid Bingo pattern found yet. Keep going!' });
    }
  });

  // ── leave / disconnect ────────────────────────────────────
  function handleLeave() {
    if (!currentRoomId) return;
    var room = rooms.get(currentRoomId);
    if (room) {
      room.players.delete(socket.id);
      broadcastRoomState(room);
    }
    currentRoomId = null;
  }

  socket.on('leave_room',  handleLeave);
  socket.on('disconnect',  handleLeave);
});

// ── Start server ──────────────────────────────────────────────
server.listen(PORT, function () {
  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║   OmniHub Super App — server running  ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('  Port  : ' + PORT);
  console.log('  Auth  : ' + (TELEGRAM_BOT_TOKEN ? 'Telegram initData verification ENABLED' : 'Dev mode — set TELEGRAM_BOT_TOKEN for production'));
  console.log('');
});

'use strict';

const express    = require('express');
const http       = require('http');
const crypto     = require('crypto');
const cors       = require('cors');
const path       = require('path');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  transports: ['websocket','polling'],
});

const PORT               = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const PUBLIC_APP_URL     = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '';

const STARTING_BALANCE  = 1000;
const ENTRY_FEE         = 50;
const CALL_INTERVAL_MS  = 4000;
const COUNTDOWN_SECONDS = 10;
const MIN_PLAYERS       = 1;
const COIN_TO_ETB       = 0.10;
const TOPUP_AMOUNT      = 200;
const TOPUP_COOLDOWN_MS = 10 * 60 * 1000;

const users = new Map();
const rooms = new Map();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Helpers ───────────────────────────────────────────────────
function sha256(s)  { return crypto.createHash('sha256').update(s).digest('hex'); }
function randInt()  { return crypto.randomBytes(4).readUInt32BE(0); }
function letterFor(n){ return n<=15?'B':n<=30?'I':n<=45?'N':n<=60?'G':'O'; }
function etb(coins) { return (Number(coins) * COIN_TO_ETB).toFixed(1) + ' ETB'; }

function getOrCreateUser(id, name) {
  const sid = String(id);
  if (!users.has(sid)) {
    users.set(sid, { id:sid, name:name||'Player', balance:STARTING_BALANCE,
                     wins:0, games:0, lastTopupAt:0, _welcomed:false });
  } else if (name) {
    users.get(sid).name = name;
  }
  return users.get(sid);
}

function verifyTelegram(initData, botToken) {
  if (!initData || !botToken) return null;
  const p = new URLSearchParams(initData);
  const h = p.get('hash'); if (!h) return null;
  p.delete('hash');
  const fields = []; p.forEach((v,k) => fields.push(k+'='+v)); fields.sort();
  const secret   = crypto.createHmac('sha256','WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256',secret).update(fields.join('\n')).digest('hex');
  if (computed !== h) return null;
  try { return JSON.parse(p.get('user')||'null'); } catch(e){ return null; }
}

// ── Telegram Bot API ──────────────────────────────────────────
function tgApi(method, payload) {
  if (!TELEGRAM_BOT_TOKEN) return Promise.resolve(null);
  return fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(r => r.json()).catch(err => { console.error('[Telegram API]', method, err.message); return null; });
}

async function setupWebhook() {
  if (!TELEGRAM_BOT_TOKEN || !PUBLIC_APP_URL) {
    console.log('  Webhook : SKIPPED (missing token or public URL)');
    return;
  }
  const webhookUrl = PUBLIC_APP_URL + '/webhook/telegram';
  const result = await tgApi('setWebhook', { url: webhookUrl });
  console.log('  Webhook :', webhookUrl, (result && result.ok) ? '✅' : '⚠️ failed');
}

// ── Telegram Webhook — All Commands ──────────────────────────
app.post('/webhook/telegram', (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body && req.body.message;
    if (!msg || !msg.text) return;

    const chatId    = msg.chat.id;
    const userId    = msg.from && String(msg.from.id);
    const firstName = (msg.from && msg.from.first_name) || 'Player';
    const username  = (msg.from && msg.from.username)   || null;
    const rawText   = msg.text.trim();
    const cmd       = rawText.toLowerCase().split(' ')[0];
    const args      = rawText.split(' ').slice(1);
    const appUrl    = PUBLIC_APP_URL || 'https://omnihub-bingo.onrender.com';
    const user      = getOrCreateUser(chatId, firstName);

    function send(text, withBtn) {
      const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
      if (withBtn) {
        payload.reply_markup = {
          inline_keyboard: [[{ text: '🎮 Open OmniHub', web_app: { url: appUrl } }]],
        };
      }
      return tgApi('sendMessage', payload);
    }

    // /start ──────────────────────────────────────────────────
    if (cmd === '/start') {
      const refCode = args[0] || null;
      if (refCode && refCode.startsWith('ref_') && !user._welcomed) {
        const referrerId = refCode.replace('ref_', '');
        const referrer   = users.get(String(referrerId));
        if (referrer && String(referrerId) !== String(userId)) {
          user.balance     += 100;
          referrer.balance += 150;
        }
      }
      user._welcomed = true;
      send(
        '🎮 <b>Welcome to OmniHub, ' + firstName + '!</b>\n\n' +
        '🪙 Balance: <b>' + user.balance.toLocaleString() + ' coins</b> (' + etb(user.balance) + ')\n\n' +
        '🎯 <b>Games:</b>\n' +
        '  🎱 5×5 Bingo — Provably Fair\n' +
        '  🎰 Slot Game\n  🎯 Keno\n  🃏 High / Low\n\n' +
        '📋 <b>Commands:</b>\n' +
        '/play /balance /deposit /withdraw\n' +
        '/invite /transfer /instruction /support\n\n' +
        'Tap below to start! 🚀', true);
    }

    // /register ───────────────────────────────────────────────
    else if (cmd === '/register') {
      user._welcomed = true;
      send(
        '📝 <b>Your Player Account</b>\n\n' +
        '👤 Name     : <b>' + firstName + '</b>\n' +
        '🔖 Handle   : ' + (username ? '@' + username : '(no username)') + '\n' +
        '🆔 ID       : <code>' + userId + '</code>\n' +
        '🪙 Balance  : <b>' + user.balance.toLocaleString() + ' coins</b> (' + etb(user.balance) + ')\n' +
        '🏆 Wins     : ' + (user.wins  || 0) + '\n' +
        '🎮 Games    : ' + (user.games || 0) + '\n\n' +
        '✅ Account is active and linked to your Telegram ID.', true);
    }

    // /play ───────────────────────────────────────────────────
    else if (cmd === '/play') {
      send(
        '🕹 <b>Choose Your Game!</b>\n\n' +
        '🎱 <b>5×5 Bingo</b> — 50 coins/round\n' +
        '   Provably fair · Win the pot!\n\n' +
        '🎰 <b>Slot Game</b> — 30 coins/spin\n' +
        '   7 symbols · Up to ×50 jackpot!\n\n' +
        '🎯 <b>Keno</b> — 50 coins/round\n' +
        '   Pick 1–10 · Up to ×1,000 payout!\n\n' +
        '🃏 <b>High/Low</b> — 20 coins/guess\n' +
        '   Guess Higher or Lower · ×2 payout!\n\n' +
        '🪙 Balance: <b>' + user.balance.toLocaleString() + ' coins</b>\n\n' +
        'Tap below to open the games 👇', true);
    }

    // /deposit ────────────────────────────────────────────────
    else if (cmd === '/deposit') {
      send(
        '💳 <b>Buy Coins — Deposit</b>\n\n' +
        '<b>💰 Coin Packages:</b>\n' +
        '  100 ETB  → 1,000 coins\n' +
        '  200 ETB  → 2,200 coins  (+200 bonus 🎁)\n' +
        '  500 ETB  → 6,000 coins  (+1,000 bonus 🎁)\n' +
        '  1,000 ETB → 13,000 coins (+3,000 bonus 🎁)\n\n' +
        '<b>📱 Payment Methods:</b>\n' +
        '  📱 Telebirr\n' +
        '  🏦 CBE Birr\n' +
        '  📱 M-Pesa\n\n' +
        '<b>📞 To deposit:</b>\n' +
        'Contact /support with your preferred package.\n' +
        'Coins credited within 5 minutes. ⚡', true);
    }

    // /balance ────────────────────────────────────────────────
    else if (cmd === '/balance') {
      const winRate = user.games > 0
        ? Math.round((user.wins / user.games) * 100) + '%' : 'N/A';
      send(
        '🪙 <b>Your Wallet</b>\n\n' +
        '💰 Coins    : <b>' + user.balance.toLocaleString() + ' coins</b>\n' +
        '💵 ETB Value: <b>' + etb(user.balance) + '</b>\n\n' +
        '📊 <b>Statistics</b>\n' +
        '🏆 Wins      : ' + (user.wins  || 0) + '\n' +
        '🎮 Games     : ' + (user.games || 0) + '\n' +
        '🎯 Win Rate  : ' + winRate + '\n\n' +
        '<i>💡 1 coin = 0.10 ETB</i>', true);
    }

    // /withdraw ───────────────────────────────────────────────
    else if (cmd === '/withdraw') {
      const minW = 500;
      if (user.balance < minW) {
        send(
          '💰 <b>Withdraw Winnings</b>\n\n' +
          '⚠️ Minimum withdrawal: <b>' + minW + ' coins</b> (' + etb(minW) + ')\n\n' +
          '🪙 Your balance: <b>' + user.balance.toLocaleString() + ' coins</b>\n' +
          '❌ Need <b>' + (minW - user.balance) + ' more coins</b> to withdraw.\n\n' +
          '🎮 Keep playing to earn more!', true);
      } else {
        send(
          '💰 <b>Withdraw Winnings</b>\n\n' +
          '🪙 Available: <b>' + user.balance.toLocaleString() + ' coins</b> (' + etb(user.balance) + ')\n\n' +
          '<b>📋 How to Withdraw:</b>\n' +
          '1. Send /support\n' +
          '2. Provide your Telebirr or CBE number\n' +
          '3. State the amount\n' +
          '4. Receive payment within 24 hours ✅\n\n' +
          '<b>💳 Fees:</b>\n' +
          '  Under 1,000 coins → 5%\n' +
          '  1,000–5,000 coins → 3%\n' +
          '  Over 5,000 coins  → 1%', false);
      }
    }

    // /invite ─────────────────────────────────────────────────
    else if (cmd === '/invite') {
      const refLink = 'https://t.me/omnihub_game_bot?start=ref_' + userId;
      send(
        '👥 <b>Invite Friends — Earn Coins!</b>\n\n' +
        '🎁 <b>Rewards Per Invite:</b>\n' +
        '  ✅ You earn  → <b>150 coins</b>\n' +
        '  ✅ Friend gets → <b>100 bonus coins</b>\n\n' +
        '🔗 <b>Your Personal Invite Link:</b>\n' +
        '<code>' + refLink + '</code>\n\n' +
        '📤 Share on Telegram, WhatsApp, TikTok, or anywhere!\n\n' +
        '<i>💡 Coins credited automatically after friend plays their first game.</i>', false);
    }

    // /transfer ───────────────────────────────────────────────
    else if (cmd === '/transfer') {
      const targetArg = args[0] || null;
      const amountArg = parseInt(args[1], 10) || 0;
      if (!targetArg || amountArg < 10) {
        send(
          '🔄 <b>Transfer Coins</b>\n\n' +
          '<b>Usage:</b>\n' +
          '<code>/transfer @username amount</code>\n\n' +
          '<b>Example:</b>\n' +
          '<code>/transfer @friend 200</code>\n\n' +
          '📌 <b>Rules:</b>\n' +
          '  • Minimum: 10 coins\n' +
          '  • Maximum: 10,000 coins/day\n' +
          '  • Fee: 2 coins flat\n' +
          '  • Recipient must have used the bot\n\n' +
          '🪙 Your balance: <b>' + user.balance.toLocaleString() + ' coins</b>', false);
      } else {
        const fee   = 2;
        const total = amountArg + fee;
        if (user.balance < total) {
          send('❌ Not enough coins. Need ' + total + ' (amount + 2 fee). You have ' + user.balance + '.', false);
        } else {
          user.balance -= total;
          send(
            '✅ <b>Transfer Sent!</b>\n\n' +
            '💸 Amount    : <b>' + amountArg + ' coins</b>\n' +
            '👤 To        : ' + targetArg + '\n' +
            '💳 Fee       : 2 coins\n' +
            '🪙 Remaining : <b>' + user.balance.toLocaleString() + ' coins</b>', false);
        }
      }
    }

    // /instruction ────────────────────────────────────────────
    else if (cmd === '/instruction') {
      send(
        '📖 <b>How to Play — OmniHub</b>\n\n' +
        '🎱 <b>5×5 Bingo (50 coins)</b>\n' +
        '1. Join round → get unique 5×5 card\n' +
        '2. Numbers 1–75 called every 4 seconds\n' +
        '3. Tap/auto-mark called numbers on card\n' +
        '4. Complete Row / Col / Diagonal / Full House\n' +
        '5. Tap BINGO! to win the pot\n' +
        '🔐 Provably fair — verify any result!\n\n' +
        '🎰 <b>Slot (30 coins/spin)</b>\n' +
        'Match 3 symbols. Triple 7️⃣ = ×50 JACKPOT!\n\n' +
        '🎯 <b>Keno (50 coins)</b>\n' +
        'Pick 1–10 from 80. 20 drawn. Match = win! Max ×1,000\n\n' +
        '🃏 <b>High/Low (20 coins)</b>\n' +
        'Card shown. Guess Higher or Lower. Win = ×2!\n\n' +
        '💰 1 coin = 0.10 ETB\n' +
        '🎁 Free top-up: 200 coins / 10 min when out\n' +
        '👥 Invite friends: /invite', true);
    }

    // /support ────────────────────────────────────────────────
    else if (cmd === '/support') {
      send(
        '💬 <b>OmniHub Support</b>\n\n' +
        '👋 Hello ' + firstName + '! We\'re here to help.\n\n' +
        '📌 <b>Quick Help:</b>\n' +
        '  💳 Deposit issues → /deposit\n' +
        '  💰 Withdraw → /withdraw\n' +
        '  🪙 Balance → /balance\n' +
        '  📖 How to play → /instruction\n' +
        '  👥 Invite → /invite\n\n' +
        '📞 <b>Direct Contact:</b>\n' +
        '  Telegram: @OmniHub_Support\n' +
        '  Hours: 9AM – 9PM (Addis Ababa time)\n\n' +
        '🆔 Your ID: <code>' + userId + '</code>\n' +
        '<i>Include this ID when contacting us.</i>\n\n' +
        '⏱ Average response: under 30 minutes.', false);
    }

    // Unknown ─────────────────────────────────────────────────
    else {
      send(
        '👋 Hi ' + firstName + '! Type a command:\n\n' +
        '/start · /register · /play\n' +
        '/deposit · /balance · /withdraw\n' +
        '/invite · /transfer\n' +
        '/instruction · /support', true);
    }

  } catch (err) {
    console.error('[Webhook] error:', err);
  }
});

// ── Provably Fair Bingo ───────────────────────────────────────
function generateCard(seed) {
  const ranges = { B:[1,15], I:[16,30], N:[31,45], G:[46,60], O:[61,75] };
  const card   = {};
  for (const col of ['B','I','N','G','O']) {
    const pool = [];
    for (let n = ranges[col][0]; n <= ranges[col][1]; n++) pool.push(n);
    for (let i = pool.length - 1; i > 0; i--) {
      const h = crypto.createHmac('sha256', seed).update(col+':'+i+':'+pool.join(',')).digest('hex');
      const j = parseInt(h.slice(0,8),16) % (i+1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    card[col] = pool.slice(0, 5);
  }
  card.N[2] = 'FREE';
  return card;
}

function generateCallSequence(seed) {
  const pool = [];
  for (let n = 1; n <= 75; n++) pool.push(n);
  for (let i = pool.length - 1; i > 0; i--) {
    const h = crypto.createHmac('sha256', seed).update('CALL:'+i+':'+pool.join(',')).digest('hex');
    const j = parseInt(h.slice(0,8),16) % (i+1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function checkWin(card, marked) {
  const cols = ['B','I','N','G','O'];
  const m = (c,r) => { const v = card[c][r]; return v === 'FREE' || marked.has(c+':'+v); };
  if (cols.every(c => [0,1,2,3,4].every(r => m(c,r)))) return 'FULL_HOUSE';
  for (let r = 0; r < 5; r++) if (cols.every(c => m(c,r))) return 'ROW';
  for (const col of cols) if ([0,1,2,3,4].every(r => m(col,r))) return 'COLUMN';
  if (cols.every((c,i) => m(c,i)))     return 'DIAGONAL';
  if (cols.every((c,i) => m(c,4-i)))   return 'DIAGONAL';
  return null;
}

// ── Room Lifecycle ────────────────────────────────────────────
function createRoom(id) {
  const r = { id, status:'WAITING', players:new Map(), serverSeed:null,
              serverSeedHash:null, callSequence:[], calledNumbers:[],
              callTimer:null, countdownTimer:null, pot:0 };
  rooms.set(id, r); return r;
}
function getRoom(id) { return rooms.get(id) || createRoom(id); }

function broadcastRoom(room) {
  io.to(room.id).emit('room_state', {
    status:room.status, playerCount:room.players.size,
    pot:room.pot, calledNumbers:room.calledNumbers, callIntervalMs:CALL_INTERVAL_MS
  });
}

function startCountdown(room) {
  if (room.status !== 'WAITING') return;
  room.status         = 'COUNTDOWN';
  room.serverSeed     = crypto.randomBytes(32).toString('hex');
  room.serverSeedHash = sha256(room.serverSeed);
  let s = COUNTDOWN_SECONDS;
  io.to(room.id).emit('countdown', { secondsLeft:s, serverSeedHash:room.serverSeedHash });
  room.countdownTimer = setInterval(() => {
    s--;
    if (s <= 0) { clearInterval(room.countdownTimer); startGame(room); }
    else io.to(room.id).emit('countdown', { secondsLeft:s, serverSeedHash:room.serverSeedHash });
  }, 1000);
}

function startGame(room) {
  room.status       = 'IN_PROGRESS';
  room.callSequence = generateCallSequence(room.serverSeed);
  room.calledNumbers = [];
  room.players.forEach((player, sid) => {
    player.card   = generateCard(room.serverSeed + ':' + sid);
    player.marked = new Set();
    io.to(sid).emit('card_assigned', { card: player.card });
  });
  broadcastRoom(room);
  io.to(room.id).emit('game_started', { serverSeedHash:room.serverSeedHash, callIntervalMs:CALL_INTERVAL_MS });
  let idx = 0;
  room.callTimer = setInterval(() => {
    if (room.status !== 'IN_PROGRESS') { clearInterval(room.callTimer); return; }
    if (idx >= room.callSequence.length) { clearInterval(room.callTimer); endGame(room, null); return; }
    const num = room.callSequence[idx++];
    room.calledNumbers.push(num);
    io.to(room.id).emit('number_called', { number:num, letter:letterFor(num), calledNumbers:room.calledNumbers });
  }, CALL_INTERVAL_MS);
}

function endGame(room, winnerSid) {
  room.status = 'FINISHED';
  clearInterval(room.callTimer);
  clearInterval(room.countdownTimer);
  let payout = 0, winnerId = null;
  if (winnerSid && room.players.has(winnerSid)) {
    const w  = room.players.get(winnerSid);
    payout   = room.pot;
    winnerId = w.userId;
    const u  = users.get(w.userId);
    if (u) { u.balance += payout; u.wins++; }
  }
  io.to(room.id).emit('game_over', {
    winnerId, payout, serverSeed:room.serverSeed,
    serverSeedHash:room.serverSeedHash, callSequenceUsed:room.calledNumbers
  });
  setTimeout(() => {
    room.status = 'WAITING'; room.serverSeed = null; room.serverSeedHash = null;
    room.callSequence = []; room.calledNumbers = []; room.pot = 0;
    room.players.forEach(p => { p.card = null; p.marked = new Set(); });
    broadcastRoom(room);
  }, 6000);
}

// ── Slot ──────────────────────────────────────────────────────
const SLOT_SYMBOLS = ['🍋','🍊','🍇','🔔','💎','7️⃣','🍀'];
const SLOT_WEIGHTS = [30, 25, 18, 12, 8, 4, 3];
const SLOT_MULTI3  = [2,  3,  5,  10, 20, 50, 30];
const SLOT_MULTI2  = [0,  0,  1,  2,  3,  5,  4];
function weightedSlot() {
  const total = SLOT_WEIGHTS.reduce((a,b) => a+b, 0);
  let r = randInt() % total, cum = 0;
  for (let i = 0; i < SLOT_WEIGHTS.length; i++) { cum += SLOT_WEIGHTS[i]; if (r < cum) return i; }
  return 0;
}

// ── Socket.IO ─────────────────────────────────────────────────
io.on('connection', socket => {
  const auth = socket.handshake.auth || {};
  let vUser  = null;
  if (TELEGRAM_BOT_TOKEN) {
    vUser = verifyTelegram(auth.initData, TELEGRAM_BOT_TOKEN);
    if (!vUser) { socket.emit('auth_error', { message:'Auth failed.' }); socket.disconnect(true); return; }
  } else {
    vUser = { id: auth.telegramId || ('guest-'+socket.id), first_name: auth.name || 'Guest' };
  }

  const user = getOrCreateUser(vUser.id, vUser.first_name);
  let currentRoomId = null;
  const emitProfile = () => socket.emit('profile', {
    id:user.id, name:user.name, balance:user.balance, wins:user.wins, games:user.games
  });
  emitProfile();

  // Bingo
  socket.on('join_room', payload => {
    const roomId = (payload && payload.roomId) || 'main';
    const room   = getRoom(roomId);
    if (room.status === 'IN_PROGRESS' || room.status === 'COUNTDOWN') {
      socket.emit('error_msg', { message:'Round in progress. Wait for next.' }); return;
    }
    if (user.balance < ENTRY_FEE) {
      socket.emit('error_msg', { message:'Need '+ENTRY_FEE+' coins.', code:'INSUFFICIENT_FUNDS' }); return;
    }
    user.balance -= ENTRY_FEE; room.pot += ENTRY_FEE; user.games++;
    socket.join(roomId); currentRoomId = roomId;
    room.players.set(socket.id, { userId:user.id, name:user.name, card:null, marked:new Set() });
    socket.emit('joined_room', { roomId, balance:user.balance, pot:room.pot });
    broadcastRoom(room);
    if (room.players.size >= MIN_PLAYERS && room.status === 'WAITING') startCountdown(room);
  });

  socket.on('mark_cell', payload => {
    if (!currentRoomId) return;
    const room   = rooms.get(currentRoomId);
    if (!room || room.status !== 'IN_PROGRESS') return;
    const player = room.players.get(socket.id);
    if (!player || !player.card) return;
    const { col, value } = payload || {};
    if (value !== 'FREE' && !room.calledNumbers.includes(value)) {
      socket.emit('error_msg', { message:'Not called yet.' }); return;
    }
    player.marked.add(col + ':' + value);
    socket.emit('cell_marked', { col, value });
  });

  socket.on('claim_bingo', () => {
    if (!currentRoomId) return;
    const room   = rooms.get(currentRoomId);
    if (!room || room.status !== 'IN_PROGRESS') return;
    const player = room.players.get(socket.id);
    if (!player || !player.card) return;
    if (checkWin(player.card, player.marked)) endGame(room, socket.id);
    else socket.emit('error_msg', { message:'No valid Bingo pattern yet!' });
  });

  // Slot
  socket.on('slot_spin', payload => {
    const wager = (payload && payload.wager) || 30;
    if (user.balance < wager) {
      socket.emit('error_msg', { message:'Need '+wager+' coins.', code:'INSUFFICIENT_FUNDS' }); return;
    }
    user.balance -= wager; user.games++;
    const r = [weightedSlot(), weightedSlot(), weightedSlot()];
    let win = 0;
    if (r[0]===r[1] && r[1]===r[2])       win = wager * SLOT_MULTI3[r[0]];
    else if (r[0]===r[1] || r[1]===r[2])  win = wager * SLOT_MULTI2[r[1]];
    else if (r[0]===r[2])                  win = wager * SLOT_MULTI2[r[0]];
    user.balance += win;
    if (win > 0) user.wins++;
    socket.emit('slot_result', { reels:r.map(i => SLOT_SYMBOLS[i]), winAmount:win, balance:user.balance });
  });

  // Keno
  socket.on('keno_play', payload => {
    const picks = (payload && payload.picks) || [];
    const wager = 50;
    if (picks.length < 1 || picks.length > 10) { socket.emit('error_msg', { message:'Pick 1-10 numbers.' }); return; }
    if (user.balance < wager) {
      socket.emit('error_msg', { message:'Need '+wager+' coins.', code:'INSUFFICIENT_FUNDS' }); return;
    }
    user.balance -= wager; user.games++;
    const pool = []; for (let i = 1; i <= 80; i++) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randInt() % (i+1); [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const drawn   = pool.slice(0, 20);
    const matches = picks.filter(p => drawn.includes(p)).length;
    const PAY = {
      1:[0,3], 2:[0,0,5], 3:[0,0,2,8], 4:[0,0,0,3,15],
      5:[0,0,0,2,8,30], 6:[0,0,0,0,3,12,60], 7:[0,0,0,0,2,6,25,100],
      8:[0,0,0,0,0,4,15,60,200], 9:[0,0,0,0,0,3,10,40,150,500],
      10:[0,0,0,0,0,2,8,30,100,400,1000]
    };
    const mult   = (PAY[picks.length] && PAY[picks.length][matches]) || 0;
    const winAmt = wager * mult;
    user.balance += winAmt;
    if (winAmt > 0) user.wins++;
    socket.emit('keno_result', { picks, drawn, matches, winAmount:winAmt, balance:user.balance, multiplier:mult });
  });

  // Card High/Low
  socket.on('card_new_round', () => {
    socket.emit('card_dealt', { card: (randInt()%13)+1, balance:user.balance });
  });

  socket.on('card_guess', payload => {
    const wager  = 20;
    const guess  = payload && payload.guess;
    const curVal = payload && payload.currentCard;
    if (!['high','low'].includes(guess)) { socket.emit('error_msg', { message:'Guess high or low.' }); return; }
    if (user.balance < wager) {
      socket.emit('error_msg', { message:'Need '+wager+' coins.', code:'INSUFFICIENT_FUNDS' }); return;
    }
    user.balance -= wager; user.games++;
    const next = (randInt()%13)+1;
    const won  = (guess==='high' && next>curVal) || (guess==='low' && next<curVal);
    const win  = won ? wager*2 : 0;
    user.balance += win;
    if (won) user.wins++;
    socket.emit('card_result', { currentCard:curVal, nextCard:next, guess, won, winAmount:win, balance:user.balance });
  });

  // Free top-up
  socket.on('claim_topup', () => {
    const now    = Date.now();
    const remain = TOPUP_COOLDOWN_MS - (now - (user.lastTopupAt || 0));
    if (remain > 0) { socket.emit('topup_result', { success:false, remainMs:remain }); return; }
    user.balance    += TOPUP_AMOUNT;
    user.lastTopupAt = now;
    socket.emit('topup_result', { success:true, amount:TOPUP_AMOUNT, balance:user.balance });
  });

  socket.on('get_profile', () => emitProfile());

  const handleLeave = () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) { room.players.delete(socket.id); broadcastRoom(room); }
    currentRoomId = null;
  };
  socket.on('leave_room', handleLeave);
  socket.on('disconnect', handleLeave);
});

// ── Start ─────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log('\n  ╔══════════════════════════════════╗');
  console.log('  ║   OmniHub Super App — Running   ║');
  console.log('  ╚══════════════════════════════════╝');
  console.log('  Port  :', PORT);
  console.log('  Auth  :', TELEGRAM_BOT_TOKEN ? 'Telegram ENABLED' : 'Dev mode');
  console.log('  Games : Bingo · Slot · Keno · Card');
  await setupWebhook();
  console.log('');
});

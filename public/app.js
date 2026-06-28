'use strict';

/**
 * OmniHub Super App — public/app.js  (FIXED VERSION)
 * ─────────────────────────────────────────────────
 * Fix 1: Navigation works ALWAYS — even without socket
 * Fix 2: Socket wrapped in try/catch — crash won't stop clicks
 * Fix 3: Uses /socket.io/socket.io.js (local) not CDN
 */

var BACKEND_URL = window.location.origin;

// ── Telegram WebApp SDK ───────────────────────────────────────
var tg = (window.Telegram && window.Telegram.WebApp)
  ? window.Telegram.WebApp : null;

var telegramUser = {
  id:         'guest-' + Math.floor(Math.random() * 999999),
  first_name: 'Guest',
};
var initDataRaw = '';

if (tg) {
  tg.ready();
  tg.expand();
  tg.enableClosingConfirmation();
  if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    telegramUser = tg.initDataUnsafe.user;
  }
  initDataRaw = tg.initData || '';
}

function haptic(style) {
  try {
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(style || 'light');
  } catch(e) {}
}
function hapticNotify(type) {
  try {
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(type || 'success');
  } catch(e) {}
}

// ── DOM references ────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

var viewDashboard  = el('view-dashboard');
var viewBingo      = el('view-bingo');
var balanceEl      = el('balance-amount');
var balanceGameEl  = el('balance-amount-game');
var userNameEl     = el('user-name');
var openBingoBtn   = el('open-bingo');
var backBtn        = el('back-to-dashboard');
var statusBannerEl = el('status-banner');
var calledStripEl  = el('called-strip');
var bingoGridEl    = el('bingo-grid');
var joinBtn        = el('join-btn');
var bingoBtn       = el('bingo-btn');

// ── State ─────────────────────────────────────────────────────
var currentCard   = null;
var calledNumbers = [];
var roomStatus    = 'WAITING';
var myUserId      = String(telegramUser.id);

// ── Helpers ───────────────────────────────────────────────────
function setBalance(n) {
  var v = Number(n).toLocaleString();
  if (balanceEl)     balanceEl.textContent     = v;
  if (balanceGameEl) balanceGameEl.textContent = v;
}

function setBanner(text, live) {
  if (!statusBannerEl) return;
  statusBannerEl.textContent = text;
  if (live) statusBannerEl.classList.add('live');
  else      statusBannerEl.classList.remove('live');
}

function showView(name) {
  if (viewDashboard) viewDashboard.classList.toggle('active', name === 'dashboard');
  if (viewBingo)     viewBingo.classList.toggle('active',     name === 'bingo');
}

function resetBingoView() {
  currentCard   = null;
  calledNumbers = [];
  if (bingoGridEl)   bingoGridEl.innerHTML   = '';
  if (calledStripEl) calledStripEl.innerHTML = '';
  if (joinBtn)  joinBtn.classList.remove('hidden');
  if (bingoBtn) bingoBtn.classList.add('hidden');
  setBanner('Tap Join to enter the next round');
}

// ── NAVIGATION — works with OR without socket ─────────────────
// These listeners are attached FIRST — before any socket code
// so clicking always works even if socket fails to load.

if (openBingoBtn) {
  openBingoBtn.addEventListener('click', function () {
    haptic('light');
    showView('bingo');
  });
}

if (backBtn) {
  backBtn.addEventListener('click', function () {
    haptic('light');
    if (socket) { try { socket.emit('leave_room'); } catch(e) {} }
    showView('dashboard');
    resetBingoView();
  });
}

if (joinBtn) {
  joinBtn.addEventListener('click', function () {
    haptic('medium');
    if (socket) { try { socket.emit('join_room', { roomId: 'main' }); } catch(e) {} }
    else setBanner('Reconnecting... please wait');
  });
}

if (bingoBtn) {
  bingoBtn.addEventListener('click', function () {
    haptic('heavy');
    if (socket) { try { socket.emit('claim_bingo'); } catch(e) {} }
  });
}

// ── Rendering ─────────────────────────────────────────────────
function renderCalledStrip() {
  if (!calledStripEl) return;
  calledStripEl.innerHTML = '';
  var recent = calledNumbers.slice(-14);
  for (var idx = 0; idx < recent.length; idx++) {
    var chip = document.createElement('div');
    chip.className   = 'called-chip' + (idx === recent.length - 1 ? ' recent' : '');
    chip.textContent = recent[idx];
    calledStripEl.appendChild(chip);
  }
  if (calledStripEl.lastChild) {
    try {
      calledStripEl.lastChild.scrollIntoView({ behavior: 'smooth', inline: 'end' });
    } catch(e) {}
  }
}

function renderCard() {
  if (!bingoGridEl) return;
  bingoGridEl.innerHTML = '';
  if (!currentCard) return;
  var cols = ['B', 'I', 'N', 'G', 'O'];
  for (var row = 0; row < 5; row++) {
    for (var ci = 0; ci < cols.length; ci++) {
      var col   = cols[ci];
      var value = currentCard[col][row];
      var cell  = document.createElement('div');
      cell.className   = 'bingo-cell';
      cell.textContent = value;
      if (value === 'FREE') {
        cell.classList.add('free', 'marked');
      } else {
        // IIFE to capture col + value correctly in closure
        (function (c, v, cellEl) {
          cellEl.addEventListener('click', function () {
            onCellClick(c, v, cellEl);
          });
        })(col, value, cell);
      }
      bingoGridEl.appendChild(cell);
    }
  }
}

function onCellClick(col, value, cellEl) {
  if (roomStatus !== 'IN_PROGRESS') return;
  if (!calledNumbers.includes(value)) {
    haptic('rigid');
    setBanner('Number ' + value + ' has not been called yet!');
    return;
  }
  if (cellEl.classList.contains('marked')) return;
  cellEl.classList.add('marked');
  haptic('light');
  if (socket) {
    try { socket.emit('mark_cell', { col: col, value: value }); } catch(e) {}
  }
}

// ── Socket.IO ─────────────────────────────────────────────────
// Wrapped in try/catch — if socket fails, navigation still works.
var socket = null;

try {
  socket = io(BACKEND_URL, {
    transports: ['websocket', 'polling'],
    auth: {
      initData:   initDataRaw,
      telegramId: telegramUser.id,
      name:       telegramUser.first_name,
    },
    reconnection:      true,
    reconnectionDelay: 1000,
    timeout:           10000,
  });

  socket.on('connect', function () {
    console.log('[OmniHub] Connected:', socket.id);
    setBanner('Connected! Tap Join to play.');
  });

  socket.on('connect_error', function (err) {
    console.warn('[OmniHub] Connection error:', err.message);
    setBanner('Connecting to server...');
  });

  socket.on('profile', function (data) {
    myUserId = String(data.id);
    setBalance(data.balance);
    if (userNameEl) userNameEl.textContent = ', ' + (data.name || 'Player');
  });

  socket.on('auth_error', function (data) {
    setBanner(data.message || 'Auth failed.');
  });

  socket.on('joined_room', function (data) {
    setBalance(data.balance);
    if (joinBtn) joinBtn.classList.add('hidden');
    setBanner('Joined! Waiting for round to start...');
  });

  socket.on('room_state', function (data) {
    roomStatus    = data.status;
    calledNumbers = data.calledNumbers || [];
    renderCalledStrip();
    if (data.status === 'WAITING') {
      setBanner('Waiting for players — Pot: ' + data.pot + ' coins');
      if (joinBtn)  joinBtn.classList.remove('hidden');
      if (bingoBtn) bingoBtn.classList.add('hidden');
    }
  });

  socket.on('countdown', function (data) {
    setBanner('Starting in ' + data.secondsLeft + 's...', true);
  });

  socket.on('card_assigned', function (data) {
    currentCard = data.card;
    renderCard();
  });

  socket.on('game_started', function () {
    setBanner('Round live! Mark your numbers.', true);
    if (bingoBtn) bingoBtn.classList.remove('hidden');
    if (joinBtn)  joinBtn.classList.add('hidden');
  });

  socket.on('number_called', function (data) {
    calledNumbers = data.calledNumbers;
    renderCalledStrip();
    haptic('light');
  });

  socket.on('cell_marked', function () {
    // confirmed by server — UI already updated on click
  });

  socket.on('game_over', function (data) {
    if (bingoBtn) bingoBtn.classList.add('hidden');
    if (data.winnerId && String(data.winnerId) === myUserId) {
      setBanner('You won ' + data.payout + ' coins!', true);
      hapticNotify('success');
    } else if (data.winnerId) {
      setBanner('Round over — another player won.');
      hapticNotify('warning');
    } else {
      setBanner('Round over — no winner this time.');
    }
    setTimeout(function () { resetBingoView(); }, 5000);
  });

  socket.on('error_msg', function (data) {
    setBanner(data.message || 'Error.');
    hapticNotify('error');
  });

} catch (socketError) {
  console.error('[OmniHub] Socket init failed:', socketError);
  setBanner('Server connecting...');
}

// ── Init ──────────────────────────────────────────────────────
showView('dashboard');

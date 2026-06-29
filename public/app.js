'use strict';

var BACKEND_URL = window.location.origin;

// ── Telegram SDK ──────────────────────────────────────────────
var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
var telegramUser = { id: 'guest-' + Math.floor(Math.random() * 999999), first_name: 'Guest' };
var initDataRaw  = '';

if (tg) {
  tg.ready();
  tg.expand();
  tg.enableClosingConfirmation();
  if (tg.initDataUnsafe && tg.initDataUnsafe.user) telegramUser = tg.initDataUnsafe.user;
  initDataRaw = tg.initData || '';
}

function haptic(s)  { try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(s||'light'); } catch(e){} }
function hapticN(t) { try { if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(t||'success'); } catch(e){} }

// ── DOM ───────────────────────────────────────────────────────
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
var hashRow        = el('hash-row');
var hashDisplay    = el('seed-hash-display');
var dashWins       = el('dash-wins');
var dashGames      = el('dash-games');

// ── State ─────────────────────────────────────────────────────
var currentCard   = null;
var calledNumbers = [];
var roomStatus    = 'WAITING';
var myUserId      = String(telegramUser.id);
var totalWins     = 0;
var totalGames    = 0;

// ── Helpers ───────────────────────────────────────────────────
function setBalance(n) {
  var v = Number(n).toLocaleString();
  if (balanceEl)     balanceEl.textContent     = v;
  if (balanceGameEl) balanceGameEl.textContent = v;
}

function setBanner(text, type) {
  if (!statusBannerEl) return;
  statusBannerEl.textContent = text;
  statusBannerEl.className   = 'status-banner';
  if (type) statusBannerEl.classList.add(type);
}

function showView(name) {
  if (viewDashboard) viewDashboard.classList.toggle('active', name === 'dashboard');
  if (viewBingo)     viewBingo.classList.toggle('active',     name === 'bingo');
}

function updateStats() {
  if (dashWins)  dashWins.textContent  = totalWins;
  if (dashGames) dashGames.textContent = totalGames;
}

function showHash(hash) {
  if (!hashRow || !hashDisplay) return;
  if (hash) {
    hashDisplay.textContent = hash.slice(0, 20) + '...';
    hashRow.classList.remove('hidden');
  } else {
    hashRow.classList.add('hidden');
  }
}

function resetBingoView() {
  currentCard   = null;
  calledNumbers = [];
  if (bingoGridEl) {
    // restore skeleton
    bingoGridEl.innerHTML = '';
    for (var s = 0; s < 25; s++) {
      var sk = document.createElement('div');
      sk.className   = 'bingo-cell';
      sk.textContent = s === 12 ? 'FREE' : '?';
      sk.style.opacity = '0.15';
      if (s === 12) { sk.classList.add('free','marked'); sk.style.opacity = '1'; }
      bingoGridEl.appendChild(sk);
    }
  }
  if (calledStripEl) calledStripEl.innerHTML = '';
  if (joinBtn)  joinBtn.classList.remove('hidden');
  if (bingoBtn) bingoBtn.classList.add('hidden');
  showHash(null);
  setBanner('Tap Join to enter the next round');
}

// ── Rendering ─────────────────────────────────────────────────
function renderCalledStrip() {
  if (!calledStripEl) return;
  calledStripEl.innerHTML = '';
  var recent = calledNumbers.slice(-16);
  for (var i = 0; i < recent.length; i++) {
    var chip = document.createElement('div');
    chip.className   = 'called-chip' + (i === recent.length - 1 ? ' recent' : '');
    chip.textContent = recent[i];
    calledStripEl.appendChild(chip);
  }
  if (calledStripEl.lastChild) {
    try { calledStripEl.lastChild.scrollIntoView({ behavior: 'smooth', inline: 'end' }); } catch(e){}
  }
}

function renderCard() {
  if (!bingoGridEl || !currentCard) return;
  bingoGridEl.innerHTML = '';
  var cols = ['B','I','N','G','O'];
  // Build column by column, row by row
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
        (function(c, v, cellEl) {
          cellEl.addEventListener('click', function() { onCellClick(c, v, cellEl); });
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
    setBanner('❌ Number ' + value + ' not called yet!', 'warning');
    setTimeout(function() {
      setBanner('Round live! Mark your numbers.', 'live');
    }, 1500);
    return;
  }
  if (cellEl.classList.contains('marked')) return;
  cellEl.classList.add('marked');
  haptic('light');
  if (socket) { try { socket.emit('mark_cell', { col: col, value: value }); } catch(e){} }
}

// ── Navigation — attached BEFORE socket so always works ───────
if (openBingoBtn) {
  openBingoBtn.addEventListener('click', function() {
    haptic('light');
    showView('bingo');
  });
}

if (backBtn) {
  backBtn.addEventListener('click', function() {
    haptic('light');
    if (socket) { try { socket.emit('leave_room'); } catch(e){} }
    showView('dashboard');
    resetBingoView();
  });
}

if (joinBtn) {
  joinBtn.addEventListener('click', function() {
    haptic('medium');
    if (socket) {
      try { socket.emit('join_room', { roomId: 'main' }); } catch(e){}
    } else {
      setBanner('Connecting... please try again in a moment.', 'warning');
    }
  });
}

if (bingoBtn) {
  bingoBtn.addEventListener('click', function() {
    haptic('heavy');
    if (socket) { try { socket.emit('claim_bingo'); } catch(e){} }
  });
}

// ── Socket.IO ─────────────────────────────────────────────────
var socket = null;

try {
  socket = io(BACKEND_URL, {
    transports:       ['websocket', 'polling'],
    auth:             { initData: initDataRaw, telegramId: telegramUser.id, name: telegramUser.first_name },
    reconnection:     true,
    reconnectionDelay: 1000,
    timeout:          10000,
  });

  socket.on('connect', function() {
    console.log('[OmniHub] Socket connected:', socket.id);
  });

  socket.on('connect_error', function(err) {
    console.warn('[OmniHub] Connection error:', err.message);
    setBanner('Connecting to server...', 'warning');
  });

  socket.on('profile', function(data) {
    myUserId = String(data.id);
    setBalance(data.balance);
    if (userNameEl) userNameEl.textContent = ', ' + (data.name || 'Player');
  });

  socket.on('auth_error', function(data) {
    setBanner(data.message || 'Auth failed.');
  });

  socket.on('joined_room', function(data) {
    setBalance(data.balance);
    totalGames++;
    updateStats();
    if (joinBtn) joinBtn.classList.add('hidden');
    setBanner('✅ Joined! Waiting for round to start...');
  });

  socket.on('room_state', function(data) {
    roomStatus    = data.status;
    calledNumbers = data.calledNumbers || [];
    renderCalledStrip();
    if (data.status === 'WAITING') {
      setBanner('⏳ Waiting for players — Pot: ' + data.pot + ' coins');
      if (joinBtn)  joinBtn.classList.remove('hidden');
      if (bingoBtn) bingoBtn.classList.add('hidden');
    }
  });

  socket.on('countdown', function(data) {
    showHash(data.serverSeedHash);
    setBanner('🔐 Starting in ' + data.secondsLeft + 's — Fairness committed!', 'live');
  });

  socket.on('card_assigned', function(data) {
    currentCard = data.card;
    renderCard();
  });

  socket.on('game_started', function(data) {
    setBanner('🎯 Round live! Tap called numbers on your card.', 'live');
    if (bingoBtn) bingoBtn.classList.remove('hidden');
    if (joinBtn)  joinBtn.classList.add('hidden');
    if (data && data.serverSeedHash) showHash(data.serverSeedHash);
  });

  socket.on('number_called', function(data) {
    calledNumbers = data.calledNumbers;
    renderCalledStrip();
    haptic('light');
    setBanner('📢 Called: ' + data.letter + '-' + data.number + '  (Total: ' + calledNumbers.length + ')', 'live');
  });

  socket.on('cell_marked', function() {
    // server confirmation — UI already updated on tap
  });

  socket.on('game_over', function(data) {
    if (bingoBtn) bingoBtn.classList.add('hidden');
    if (data.serverSeed && hashDisplay) {
      hashDisplay.textContent = 'Revealed: ' + data.serverSeed.slice(0, 20) + '...';
    }
    if (data.winnerId && String(data.winnerId) === myUserId) {
      totalWins++;
      updateStats();
      setBalance(Number((balanceEl && balanceEl.textContent.replace(/,/g,'')) || 0) + data.payout);
      setBanner('🏆 YOU WON ' + data.payout + ' coins! Congratulations!', 'live');
      hapticN('success');
    } else if (data.winnerId) {
      setBanner('Round over — another player won this round.');
      hapticN('warning');
    } else {
      setBanner('Round over — no winner. Try again!');
    }
    setTimeout(function() { resetBingoView(); }, 5000);
  });

  socket.on('error_msg', function(data) {
    setBanner(data.message || 'Something went wrong.', 'warning');
    hapticN('error');
  });

} catch(socketError) {
  console.error('[OmniHub] Socket init failed:', socketError);
  setBanner('Connecting...', 'warning');
}

// ── Init ──────────────────────────────────────────────────────
showView('dashboard');
updateStats();

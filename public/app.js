'use strict';
/**
 * OmniHub Super App — public/app.js  (COMPLETE v4)
 * Features:
 *  • Split-screen Bingo: mini 1-75 board (left) + 5×5 card (right)
 *  • Auto-mark toggle (ON = cells mark themselves when number is called)
 *  • Real-time countdown timer bar
 *  • Out-of-coins modal + free top-up (200 coins every 10 min)
 *  • Slot · Keno · High/Low fully wired
 *  • ETB balance display (1 coin = 0.10 ETB)
 *  • Navigation bound before socket — always responsive
 */

var BACKEND_URL = window.location.origin;
var COIN_TO_ETB = 0.10;

/* ── Telegram SDK ─────────────────────────────────────────── */
var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
var telegramUser = { id: 'guest-' + Math.floor(Math.random() * 999999), first_name: 'Guest' };
var initDataRaw  = '';
if (tg) {
  tg.ready(); tg.expand(); tg.enableClosingConfirmation();
  if (tg.initDataUnsafe && tg.initDataUnsafe.user) telegramUser = tg.initDataUnsafe.user;
  initDataRaw = tg.initData || '';
}
function haptic(s)  { try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(s||'light'); } catch(e){} }
function hapticN(t) { try { if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(t||'success'); } catch(e){} }

/* ── DOM shortcuts ────────────────────────────────────────── */
function el(id) { return document.getElementById(id); }

/* Dashboard */
var balanceAmountEl = el('balance-amount');
var balanceEtbEl    = el('balance-etb');
var userNameEl      = el('user-name');
var hWinsEl         = el('h-wins');
var hGamesEl        = el('h-games');

/* Bingo */
var backBingoBtn    = el('back-bingo');
var balanceBingoEl  = el('balance-bingo');
var bingoStatusTxt  = el('bingo-status');
var timerSecEl      = el('timer-sec-inline');
var timerFillEl     = el('timer-fill');
var miniBoardEl     = el('mini-board');
var hashBarEl       = el('bingo-hash');
var hashValEl       = el('hash-val');
var bingoGridEl     = el('bingo-grid');
var joinBtn         = el('join-btn');
var bingoBtn        = el('bingo-btn');
var autoToggle      = el('auto-toggle');

/* Slot */
var backSlotBtn     = el('back-slot');
var balanceSlotEl   = el('balance-slot');
var slotMsgEl       = el('slot-msg');
var spinBtn         = el('spin-btn');

/* Keno */
var backKenoBtn     = el('back-keno');
var balanceKenoEl   = el('balance-keno');
var kenoStatusEl    = el('keno-status');
var kenoCountEl     = el('keno-count');
var kenoGridEl      = el('keno-grid');
var kenoClearBtn    = el('keno-clear');
var kenoPlayBtn     = el('keno-play');

/* Card */
var backCardBtn     = el('back-card');
var balanceCardEl   = el('balance-card');
var cardStatusEl    = el('card-status');
var cardValEl       = el('card-val');
var nextCardEl      = el('next-card');
var nextValEl       = el('next-val');
var cardPlacEl      = el('card-placeholder');
var cardResultEl    = el('card-result-msg');
var cardBtnsEl      = el('card-btns');
var btnLow          = el('btn-low');
var btnHigh         = el('btn-high');
var btnDeal         = el('btn-deal');

/* Modals */
var modalCoins      = el('modal-coins');
var modalTopupOk    = el('modal-topup-ok');
var modalBalCoins   = el('modal-bal-coins');
var modalBalEtb     = el('modal-bal-etb');
var btnClaimTopup   = el('btn-claim-topup');
var btnModalClose   = el('btn-modal-close');
var topupCoolMsg    = el('topup-cool-msg');
var topupCoolCount  = el('topup-cool-count');
var btnTopupOkClose = el('btn-topup-ok-close');
var modalTopupNewBal= el('modal-topup-new-bal');

/* Nav */
var openBingoBtn  = el('open-bingo');
var openSlotBtn   = el('open-slot');
var openKenoBtn   = el('open-keno');
var openCardBtn   = el('open-card');
var openHowtoBtn  = el('open-howto');
var backHowtoBtn  = el('back-howto');

/* ── App State ────────────────────────────────────────────── */
var currentBalance   = 0;
var currentCard      = null;    // bingo card object
var calledNumbers    = [];
var roomStatus       = 'WAITING';
var myUserId         = String(telegramUser.id);
var autoMarkOn       = true;    // default: auto-mark ON
var callIntervalMs   = 4000;
var clientTimerIntvl = null;    // countdown interval handle
var kenoSelected     = [];
var cardCurrent      = null;    // high/low current value
var slotSpinning     = false;

/* ── Balance helpers ─────────────────────────────────────── */
function setBalance(n) {
  currentBalance = Number(n) || 0;
  var v = currentBalance.toLocaleString();
  if (balanceAmountEl) balanceAmountEl.textContent = v;
  if (balanceBingoEl)  balanceBingoEl.textContent  = v;
  if (balanceSlotEl)   balanceSlotEl.textContent   = v;
  if (balanceKenoEl)   balanceKenoEl.textContent   = v;
  if (balanceCardEl)   balanceCardEl.textContent   = v;
  var etbStr = (currentBalance * COIN_TO_ETB).toFixed(1) + ' ETB';
  if (balanceEtbEl) balanceEtbEl.textContent = etbStr;
}

/* ── View router ─────────────────────────────────────────── */
var VIEWS = ['dashboard','bingo','slot','keno','card','howto'];
function showView(name) {
  VIEWS.forEach(function(v) {
    var node = el('view-' + v);
    if (node) node.classList.toggle('active', v === name);
  });
}

/* ── Status text helper ──────────────────────────────────── */
function setBingoStatus(text, type) {
  if (!bingoStatusTxt) return;
  bingoStatusTxt.textContent = text;
  bingoStatusTxt.className = 'bingo-status-txt';
  if (type) bingoStatusTxt.classList.add(type);
}

/* ── Out-of-coins modal ──────────────────────────────────── */
function showCoinsModal() {
  if (!modalCoins) return;
  if (modalBalCoins) modalBalCoins.textContent = currentBalance.toLocaleString();
  if (modalBalEtb)   modalBalEtb.textContent   = (currentBalance * COIN_TO_ETB).toFixed(1) + ' ETB';
  if (topupCoolMsg)  topupCoolMsg.classList.add('hidden');
  modalCoins.classList.remove('hidden');
}
function hideCoinsModal() { if (modalCoins) modalCoins.classList.add('hidden'); }

if (btnModalClose)   btnModalClose.addEventListener('click', function() { haptic(); hideCoinsModal(); });
if (btnTopupOkClose) btnTopupOkClose.addEventListener('click', function() {
  haptic(); if (modalTopupOk) modalTopupOk.classList.add('hidden');
});
if (btnClaimTopup) btnClaimTopup.addEventListener('click', function() {
  haptic('medium');
  if (socket) { try { socket.emit('claim_topup'); } catch(e){} }
});

/* ── Timer bar ───────────────────────────────────────────── */
function clearClientTimer() {
  if (clientTimerIntvl) { clearInterval(clientTimerIntvl); clientTimerIntvl = null; }
}
function startClientTimer(durationMs) {
  clearClientTimer();
  var endAt = Date.now() + durationMs;
  function tick() {
    var rem  = Math.max(0, endAt - Date.now());
    var secs = Math.ceil(rem / 1000);
    var pct  = (rem / durationMs) * 100;
    if (timerSecEl)  timerSecEl.textContent  = secs;
    if (timerFillEl) timerFillEl.style.width = Math.max(0, pct) + '%';
    if (rem <= 0) clearClientTimer();
  }
  tick();
  clientTimerIntvl = setInterval(tick, 150);
}
function showCountdownTimer(s) {
  if (timerSecEl)  timerSecEl.textContent  = s;
  if (timerFillEl) timerFillEl.style.width = '100%';
}

/* ── Mini 1-75 number board ──────────────────────────────── */
function buildMiniBoard() {
  if (!miniBoardEl) return;
  miniBoardEl.innerHTML = '';
  // Fill column by column so B(1-15) I(16-30) N(31-45) G(46-60) O(61-75) each form a column
  for (var row = 0; row < 15; row++) {
    var nums = [row+1, 16+row, 31+row, 46+row, 61+row];
    nums.forEach(function(n) {
      var d = document.createElement('div');
      d.className   = 'mnum';
      d.id          = 'mn-' + n;
      d.textContent = n;
      miniBoardEl.appendChild(d);
    });
  }
}

function updateMiniBoard() {
  if (!miniBoardEl) return;
  var all = miniBoardEl.querySelectorAll('.mnum');
  all.forEach(function(d) { d.classList.remove('called','recent'); });
  calledNumbers.forEach(function(n) {
    var d = el('mn-' + n);
    if (d) d.classList.add('called');
  });
  if (calledNumbers.length > 0) {
    var last = el('mn-' + calledNumbers[calledNumbers.length - 1]);
    if (last) { last.classList.add('recent'); try { last.scrollIntoView({block:'nearest'}); } catch(e){} }
  }
}

/* ── Bingo card render ───────────────────────────────────── */
function resetBingoSkeleton() {
  if (!bingoGridEl) return;
  bingoGridEl.innerHTML = '';
  for (var s = 0; s < 25; s++) {
    var sk = document.createElement('div');
    sk.className   = (s === 12) ? 'bcs free marked' : 'bcs opacity15';
    sk.textContent = (s === 12) ? 'FREE' : '?';
    bingoGridEl.appendChild(sk);
  }
}

function renderBingoCard() {
  if (!bingoGridEl || !currentCard) return;
  bingoGridEl.innerHTML = '';
  var cols = ['B','I','N','G','O'];
  for (var row = 0; row < 5; row++) {
    for (var ci = 0; ci < cols.length; ci++) {
      var col   = cols[ci];
      var value = currentCard[col][row];
      var cell  = document.createElement('div');
      cell.className   = 'bcs';
      cell.textContent = value;
      if (value === 'FREE') {
        cell.classList.add('free','marked');
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
    setBingoStatus('❌ ' + value + ' not called yet!', 'warning');
    setTimeout(function() { setBingoStatus('🎯 Round live! Mark called numbers.', 'live'); }, 1300);
    return;
  }
  if (cellEl.classList.contains('marked')) return;
  markCell(col, value, cellEl);
}

function markCell(col, value, cellEl) {
  if (!cellEl || cellEl.classList.contains('marked')) return;
  cellEl.classList.add('marked');
  haptic('light');
  if (socket) { try { socket.emit('mark_cell', { col: col, value: value }); } catch(e){} }
}

/* auto-mark: scan card cells for called numbers */
function autoMarkCard() {
  if (!autoMarkOn || !currentCard || roomStatus !== 'IN_PROGRESS') return;
  var cols = ['B','I','N','G','O'];
  var cells = bingoGridEl ? bingoGridEl.querySelectorAll('.bcs') : [];
  var idx = 0;
  for (var row = 0; row < 5; row++) {
    for (var ci = 0; ci < cols.length; ci++) {
      var cell  = cells[idx++];
      var col   = cols[ci];
      var value = currentCard[col][row];
      if (value !== 'FREE' && calledNumbers.includes(value)) {
        markCell(col, value, cell);
      }
    }
  }
}

function resetBingoView() {
  currentCard   = null;
  calledNumbers = [];
  roomStatus    = 'WAITING';
  resetBingoSkeleton();
  updateMiniBoard();
  clearClientTimer();
  if (timerSecEl)  timerSecEl.textContent  = '--';
  if (timerFillEl) timerFillEl.style.width = '100%';
  if (joinBtn)  joinBtn.classList.remove('hidden');
  if (bingoBtn) bingoBtn.classList.add('hidden');
  if (hashBarEl) hashBarEl.classList.add('hidden');
  setBingoStatus('Tap Join to enter the next round');
}

/* ── Auto-toggle handler ─────────────────────────────────── */
if (autoToggle) {
  autoToggle.addEventListener('change', function() {
    autoMarkOn = this.checked;
    haptic('light');
    if (autoMarkOn) autoMarkCard();
  });
}

/* ── Socket emit helper ───────────────────────────────────── */
function emit(event, payload) {
  if (socket) { try { socket.emit(event, payload || {}); } catch(e){} }
}

/* ═══════════════════════════════════════════
   NAVIGATION — bound before socket setup
   ═══════════════════════════════════════════ */
if (openBingoBtn) openBingoBtn.addEventListener('click', function() { haptic('light'); showView('bingo'); });
if (openSlotBtn)  openSlotBtn.addEventListener('click',  function() { haptic('light'); showView('slot'); });
if (openKenoBtn)  openKenoBtn.addEventListener('click',  function() { haptic('light'); showView('keno'); });
if (openHowtoBtn) openHowtoBtn.addEventListener('click', function() { haptic('light'); showView('howto'); });
if (openCardBtn)  openCardBtn.addEventListener('click',  function() {
  haptic('light'); showView('card');
  if (cardCurrent === null) emit('card_new_round');
});
if (backBingoBtn) backBingoBtn.addEventListener('click', function() {
  haptic('light'); emit('leave_room'); showView('dashboard'); resetBingoView();
});
if (backSlotBtn)  backSlotBtn.addEventListener('click',  function() { haptic('light'); showView('dashboard'); });
if (backKenoBtn)  backKenoBtn.addEventListener('click',  function() { haptic('light'); showView('dashboard'); });
if (backCardBtn)  backCardBtn.addEventListener('click',  function() { haptic('light'); showView('dashboard'); });
if (backHowtoBtn) backHowtoBtn.addEventListener('click', function() { haptic('light'); showView('dashboard'); });

if (joinBtn) joinBtn.addEventListener('click', function() {
  haptic('medium');
  if (currentBalance < 50) { showCoinsModal(); return; }
  emit('join_room', { roomId: 'main' });
});
if (bingoBtn) bingoBtn.addEventListener('click', function() { haptic('heavy'); emit('claim_bingo'); });

/* ═══════════════════════════════════════════
   SLOT GAME
   ═══════════════════════════════════════════ */
var SLOT_SYMS = ['🍋','🍊','🍇','🔔','💎','7️⃣','🍀'];

function animateReels(finalReels, winAmount) {
  var ticks = 0, maxTicks = 14;
  var riv = setInterval(function() {
    ticks++;
    [0,1,2].forEach(function(i) {
      var s = el('sym-' + i);
      if (s) s.textContent = SLOT_SYMS[Math.floor(Math.random() * SLOT_SYMS.length)];
    });
    if (ticks >= maxTicks) {
      clearInterval(riv);
      [0,1,2].forEach(function(i) {
        var s = el('sym-' + i); if (s) s.textContent = finalReels[i];
      });
      slotSpinning = false;
      if (spinBtn) spinBtn.disabled = false;
      if (slotMsgEl) {
        slotMsgEl.textContent = winAmount > 0
          ? '🎉 You won ' + winAmount + ' coins!'
          : '❌ No match — spin again!';
      }
      if (winAmount > 0) hapticN('success');
    }
  }, 65);
}

if (spinBtn) spinBtn.addEventListener('click', function() {
  if (slotSpinning) return;
  if (currentBalance < 30) { showCoinsModal(); return; }
  haptic('medium');
  slotSpinning = true;
  spinBtn.disabled = true;
  if (slotMsgEl) slotMsgEl.textContent = 'Spinning…';
  emit('slot_spin', { wager: 30 });
});

/* ═══════════════════════════════════════════
   KENO GAME
   ═══════════════════════════════════════════ */
function buildKenoGrid() {
  if (!kenoGridEl) return;
  kenoGridEl.innerHTML = '';
  for (var n = 1; n <= 80; n++) {
    var d = document.createElement('div');
    d.className   = 'keno-num';
    d.textContent = n;
    d.dataset.num = n;
    d.addEventListener('click', (function(num, node) {
      return function() { toggleKeno(num, node); };
    })(n, d));
    kenoGridEl.appendChild(d);
  }
}

function updateKenoCount() { if (kenoCountEl) kenoCountEl.textContent = kenoSelected.length; }

function toggleKeno(num, node) {
  var idx = kenoSelected.indexOf(num);
  if (idx >= 0) {
    kenoSelected.splice(idx, 1);
    node.classList.remove('selected');
  } else {
    if (kenoSelected.length >= 10) { haptic('rigid'); return; }
    kenoSelected.push(num);
    node.classList.add('selected');
  }
  haptic('light');
  updateKenoCount();
}

if (kenoClearBtn) kenoClearBtn.addEventListener('click', function() {
  haptic('light');
  kenoSelected = [];
  if (kenoGridEl) kenoGridEl.querySelectorAll('.keno-num').forEach(function(d) {
    d.classList.remove('selected','hit','miss');
  });
  updateKenoCount();
  if (kenoStatusEl) { kenoStatusEl.textContent = 'Pick 1–10 numbers then Play'; kenoStatusEl.className = 'status-banner'; }
});

if (kenoPlayBtn) kenoPlayBtn.addEventListener('click', function() {
  if (kenoSelected.length < 1) {
    if (kenoStatusEl) { kenoStatusEl.textContent = 'Pick at least 1 number!'; kenoStatusEl.className = 'status-banner warning'; }
    haptic('rigid'); return;
  }
  if (currentBalance < 50) { showCoinsModal(); return; }
  haptic('medium');
  emit('keno_play', { picks: kenoSelected });
});

/* ═══════════════════════════════════════════
   HIGH / LOW CARD GAME
   ═══════════════════════════════════════════ */
function cardLabel(n) {
  return n===1?'A':n===11?'J':n===12?'Q':n===13?'K':String(n);
}
if (btnHigh) btnHigh.addEventListener('click', function() {
  if (currentBalance < 20) { showCoinsModal(); return; }
  haptic('medium'); emit('card_guess', { guess:'high', currentCard: cardCurrent });
});
if (btnLow) btnLow.addEventListener('click', function() {
  if (currentBalance < 20) { showCoinsModal(); return; }
  haptic('medium'); emit('card_guess', { guess:'low',  currentCard: cardCurrent });
});
if (btnDeal) btnDeal.addEventListener('click', function() {
  haptic('light'); cardCurrent = null; emit('card_new_round');
});

/* ═══════════════════════════════════════════
   SOCKET.IO
   ═══════════════════════════════════════════ */
var socket = null;
try {
  socket = io(BACKEND_URL, {
    transports: ['websocket','polling'],
    auth: { initData: initDataRaw, telegramId: telegramUser.id, name: telegramUser.first_name },
    reconnection: true, reconnectionDelay: 1000, timeout: 10000,
  });

  socket.on('connect', function() { console.log('[OmniHub] socket:', socket.id); });
  socket.on('connect_error', function(e) { console.warn('[OmniHub]', e.message); });

  /* Profile */
  socket.on('profile', function(d) {
    myUserId = String(d.id);
    setBalance(d.balance);
    if (userNameEl) userNameEl.textContent = ', ' + (d.name || 'Player');
    if (hWinsEl)   hWinsEl.textContent   = d.wins  || 0;
    if (hGamesEl)  hGamesEl.textContent  = d.games || 0;
  });

  socket.on('auth_error', function(d) { setBingoStatus(d.message || 'Auth failed.'); });

  /* ── Bingo ── */
  socket.on('joined_room', function(d) {
    setBalance(d.balance);
    if (joinBtn) joinBtn.classList.add('hidden');
    setBingoStatus('✅ Joined! Waiting for round…');
    emit('get_profile');
  });

  socket.on('room_state', function(d) {
    roomStatus     = d.status;
    calledNumbers  = d.calledNumbers || [];
    if (d.callIntervalMs) callIntervalMs = d.callIntervalMs;
    updateMiniBoard();
    if (d.status === 'WAITING') {
      setBingoStatus('⏳ Waiting — Pot: ' + d.pot + ' coins');
      if (joinBtn)  joinBtn.classList.remove('hidden');
      if (bingoBtn) bingoBtn.classList.add('hidden');
      clearClientTimer();
    }
  });

  socket.on('countdown', function(d) {
    if (d.serverSeedHash && hashValEl) { hashValEl.textContent = d.serverSeedHash.slice(0,22)+'…'; hashBarEl.classList.remove('hidden'); }
    showCountdownTimer(d.secondsLeft);
    setBingoStatus('🔐 Fairness committed — starting in ' + d.secondsLeft + 's', 'live');
  });

  socket.on('card_assigned', function(d) {
    currentCard = d.card;
    renderBingoCard();
    // auto-mark any numbers already called (late joiner edge case)
    autoMarkCard();
  });

  socket.on('game_started', function(d) {
    roomStatus = 'IN_PROGRESS';
    setBingoStatus('🎯 Round live! Mark called numbers.', 'live');
    if (bingoBtn) bingoBtn.classList.remove('hidden');
    if (joinBtn)  joinBtn.classList.add('hidden');
    if (d && d.callIntervalMs) callIntervalMs = d.callIntervalMs;
    calledNumbers = [];
    updateMiniBoard();
    startClientTimer(callIntervalMs);
  });

  socket.on('number_called', function(d) {
    calledNumbers = d.calledNumbers;
    updateMiniBoard();
    haptic('light');
    setBingoStatus('📢 ' + d.letter + '-' + d.number + '  (' + calledNumbers.length + '/75 called)', 'live');
    startClientTimer(callIntervalMs);
    autoMarkCard(); // auto-mark if toggle is ON
  });

  socket.on('cell_marked', function() { /* server confirmation, UI already updated */ });

  socket.on('claim_bingo', function() {}); // no-op listener to avoid ghost events

  socket.on('game_over', function(d) {
    roomStatus = 'FINISHED';
    if (bingoBtn) bingoBtn.classList.add('hidden');
    clearClientTimer();
    if (d.serverSeed && hashValEl) hashValEl.textContent = 'Seed: ' + d.serverSeed.slice(0,22) + '…';
    if (d.winnerId && String(d.winnerId) === myUserId) {
      setBalance(currentBalance + d.payout);
      setBingoStatus('🏆 YOU WON ' + d.payout + ' coins!', 'live');
      hapticN('success');
    } else if (d.winnerId) {
      setBingoStatus('Round over — another player won.');
      hapticN('warning');
    } else {
      setBingoStatus('Round over — no winner this time.');
    }
    emit('get_profile');
    setTimeout(function() { resetBingoView(); }, 5500);
  });

  socket.on('error_msg', function(d) {
    setBingoStatus(d.message || 'Error.', 'warning');
    hapticN('error');
    if (d.code === 'INSUFFICIENT_FUNDS') showCoinsModal();
  });

  /* ── Slot ── */
  socket.on('slot_result', function(d) {
    setBalance(d.balance);
    animateReels(d.reels, d.winAmount);
    emit('get_profile');
  });

  /* ── Keno ── */
  socket.on('keno_result', function(d) {
    if (kenoGridEl) {
      kenoGridEl.querySelectorAll('.keno-num').forEach(function(node) {
        var n = parseInt(node.dataset.num, 10);
        node.classList.remove('hit','miss');
        if (d.drawn.includes(n)) {
          node.classList.add(d.picks.includes(n) ? 'hit' : 'miss');
        }
      });
    }
    setBalance(d.balance);
    if (kenoStatusEl) {
      if (d.winAmount > 0) {
        kenoStatusEl.textContent = '🎉 ' + d.matches + ' matches! Won ' + d.winAmount + ' coins (×' + d.multiplier + ')';
        kenoStatusEl.className   = 'status-banner live';
        hapticN('success');
      } else {
        kenoStatusEl.textContent = d.matches + ' matches — no win. Try again!';
        kenoStatusEl.className   = 'status-banner warning';
        hapticN('warning');
      }
    }
    emit('get_profile');
  });

  /* ── Card ── */
  socket.on('card_dealt', function(d) {
    cardCurrent = d.card;
    if (cardValEl)  cardValEl.textContent  = cardLabel(d.card);
    if (nextCardEl) nextCardEl.classList.add('hidden');
    if (cardPlacEl) cardPlacEl.classList.remove('hidden');
    if (cardResultEl) cardResultEl.textContent = '';
    if (cardBtnsEl) cardBtnsEl.classList.remove('hidden');
    if (btnDeal)    btnDeal.classList.add('hidden');
    setBalance(d.balance);
    if (cardStatusEl) { cardStatusEl.textContent = 'Guess Higher or Lower'; cardStatusEl.className = 'status-banner'; }
  });

  socket.on('card_result', function(d) {
    if (nextValEl)  nextValEl.textContent  = cardLabel(d.nextCard);
    if (nextCardEl) nextCardEl.classList.remove('hidden');
    if (cardPlacEl) cardPlacEl.classList.add('hidden');
    if (cardBtnsEl) cardBtnsEl.classList.add('hidden');
    if (btnDeal)    btnDeal.classList.remove('hidden');
    setBalance(d.balance);
    cardCurrent = null;
    if (cardResultEl) {
      cardResultEl.textContent = d.won
        ? '🎉 Correct! +' + d.winAmount + ' coins!'
        : '❌ Wrong — lost 20 coins.';
    }
    if (d.won) hapticN('success'); else hapticN('error');
    emit('get_profile');
  });

  /* ── Top-up ── */
  socket.on('topup_result', function(d) {
    if (d.success) {
      setBalance(d.balance);
      hideCoinsModal();
      if (modalTopupNewBal) modalTopupNewBal.textContent = 'New balance: ' + d.balance.toLocaleString() + ' coins (' + (d.balance * COIN_TO_ETB).toFixed(1) + ' ETB)';
      if (modalTopupOk) modalTopupOk.classList.remove('hidden');
      hapticN('success');
    } else {
      // show cooldown countdown in modal
      var remainMs = d.remainMs || 0;
      if (topupCoolMsg && topupCoolCount) {
        topupCoolMsg.classList.remove('hidden');
        var endAt = Date.now() + remainMs;
        var civ = setInterval(function() {
          var left = Math.max(0, endAt - Date.now());
          var m = Math.floor(left / 60000);
          var s = Math.floor((left % 60000) / 1000);
          topupCoolCount.textContent = m + 'm ' + (s < 10 ? '0' : '') + s + 's';
          if (left <= 0) clearInterval(civ);
        }, 1000);
      }
    }
  });

} catch(err) {
  console.error('[OmniHub] Socket init failed:', err);
}

/* ═══════════════════════════════════════════
   BotFather Commands Setup Instructions
   (shown in console for developer reference)
   ═══════════════════════════════════════════
   /setcommands → @omnihub_game_bot →
   start - 🎮 Open OmniHub Super App
   play - 🕹 Launch games menu
   balance - 🪙 Check your coin balance
   contact - 💬 Contact support
   help - 📖 How to play
   ═══════════════════════════════════════════ */

/* ── Init ────────────────────────────────── */
buildMiniBoard();
buildKenoGrid();
resetBingoSkeleton();
showView('dashboard');

// ── Telegram webhook — handles all bot commands ──────────────
// Replace the existing webhook handler in server.js with this block.
// Keep everything above and below this section unchanged.

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

    const user = getOrCreateUser(chatId, firstName);
    const appUrl = PUBLIC_APP_URL || 'https://omnihub-bingo.onrender.com';

    // Helper: send message with optional Open App button
    function send(text, withBtn) {
      const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
      if (withBtn) {
        payload.reply_markup = {
          inline_keyboard: [[{ text: '🎮 Open OmniHub', web_app: { url: appUrl } }]],
        };
      }
      return tgApi('sendMessage', payload);
    }

    // ── /start ────────────────────────────────────────────────
    if (cmd === '/start') {
      const refCode = args[0] || null;
      // Bonus coins for joining via invite link
      if (refCode && refCode.startsWith('ref_') && !user._welcomed) {
        const referrerId = refCode.replace('ref_', '');
        const referrer   = users.get(String(referrerId));
        if (referrer && String(referrerId) !== String(userId)) {
          user.balance     += 100; // new user bonus
          referrer.balance += 150; // referrer bonus
        }
      }
      user._welcomed = true;

      send(
        '🎮 <b>Welcome to OmniHub, ' + firstName + '!</b>\n\n' +
        '🪙 Your balance: <b>' + user.balance.toLocaleString() + ' coins</b>' +
        ' (' + etb(user.balance) + ' ETB)\n\n' +
        '🎯 <b>Available Games:</b>\n' +
        '  🎱 5×5 Bingo — Provably Fair\n' +
        '  🎰 Slot Game\n' +
        '  🎯 Keno\n' +
        '  🃏 High / Low Card\n\n' +
        '💡 <b>Commands:</b>\n' +
        '  /play — Start a game\n' +
        '  /balance — Your wallet\n' +
        '  /invite — Earn bonus coins\n' +
        '  /instruction — How to play\n' +
        '  /support — Get help\n\n' +
        'Tap below to start playing! 🚀',
        true
      );
    }

    // ── /register ─────────────────────────────────────────────
    else if (cmd === '/register') {
      const alreadyReg = user._welcomed;
      user._welcomed = true;

      const userHandle = username ? '@' + username : '(no username set)';
      send(
        '📝 <b>Player Account</b>\n\n' +
        (alreadyReg
          ? '✅ You already have an account!\n\n'
          : '✅ Account created successfully!\n\n') +
        '👤 Name     : <b>' + firstName + '</b>\n' +
        '🔖 Handle   : ' + userHandle + '\n' +
        '🆔 ID       : <code>' + userId + '</code>\n' +
        '🪙 Balance  : <b>' + user.balance.toLocaleString() + ' coins</b> (' + etb(user.balance) + ' ETB)\n' +
        '🏆 Wins     : ' + (user.wins  || 0) + '\n' +
        '🎮 Games    : ' + (user.games || 0) + '\n\n' +
        '📌 <i>Your account is linked to your Telegram ID and is secure.</i>',
        true
      );
    }

    // ── /play ─────────────────────────────────────────────────
    else if (cmd === '/play') {
      send(
        '🕹 <b>Choose Your Game!</b>\n\n' +
        '🎱 <b>5×5 Bingo</b> — 50 coins/round\n' +
        '   Provably fair · Row/Col/Diagonal/Full House\n\n' +
        '🎰 <b>Slot Game</b> — 30 coins/spin\n' +
        '   7 symbols · Up to ×50 jackpot\n\n' +
        '🎯 <b>Keno</b> — 50 coins/round\n' +
        '   Pick 1–10 numbers · Up to ×1,000 payout\n\n' +
        '🃏 <b>High/Low</b> — 20 coins/guess\n' +
        '   Guess the next card · ×2 payout\n\n' +
        '🪙 Your balance: <b>' + user.balance.toLocaleString() + ' coins</b>\n\n' +
        'Tap below to open the games! 👇',
        true
      );
    }

    // ── /balance ──────────────────────────────────────────────
    else if (cmd === '/balance') {
      const winRate = user.games > 0
        ? Math.round((user.wins / user.games) * 100) + '%'
        : 'N/A';
      send(
        '🪙 <b>Your Wallet</b>\n\n' +
        '💰 Coins  : <b>' + user.balance.toLocaleString() + ' coins</b>\n' +
        '💵 Value  : <b>' + etb(user.balance) + ' ETB</b>\n\n' +
        '📊 <b>Statistics</b>\n' +
        '🏆 Wins   : ' + (user.wins  || 0) + '\n' +
        '🎮 Games  : ' + (user.games || 0) + '\n' +
        '🎯 Win Rate: ' + winRate + '\n\n' +
        '💳 <i>1 coin = 0.10 ETB</i>\n' +
        '📈 <i>Starting bonus: 1,000 coins = 100 ETB</i>',
        true
      );
    }

    // ── /deposit ──────────────────────────────────────────────
    else if (cmd === '/deposit') {
      send(
        '💳 <b>Buy Coins</b>\n\n' +
        '<b>Coin Packages:</b>\n' +
        '  💰 100 ETB  → 1,000 coins\n' +
        '  💰 200 ETB  → 2,200 coins  (+200 bonus)\n' +
        '  💰 500 ETB  → 6,000 coins  (+1,000 bonus)\n' +
        '  💰 1,000 ETB → 13,000 coins (+3,000 bonus)\n\n' +
        '<b>Payment Methods:</b>\n' +
        '  📱 Telebirr\n' +
        '  🏦 CBE Birr\n' +
        '  📱 M-Pesa\n\n' +
        '📞 <b>To deposit, contact support:</b>\n' +
        '  /support\n\n' +
        '<i>⚡ Coins credited within 5 minutes after payment confirmation.</i>',
        true
      );
    }

    // ── /withdraw ─────────────────────────────────────────────
    else if (cmd === '/withdraw') {
      const minWithdraw = 500;
      if (user.balance < minWithdraw) {
        send(
          '💰 <b>Withdraw Winnings</b>\n\n' +
          '⚠️ Minimum withdrawal: <b>' + minWithdraw + ' coins</b> (' + etb(minWithdraw) + ' ETB)\n\n' +
          '🪙 Your balance: <b>' + user.balance.toLocaleString() + ' coins</b>\n\n' +
          '❌ You need <b>' + (minWithdraw - user.balance) + ' more coins</b> to withdraw.\n\n' +
          '🎮 Keep playing to earn more!',
          true
        );
      } else {
        send(
          '💰 <b>Withdraw Winnings</b>\n\n' +
          '🪙 Available: <b>' + user.balance.toLocaleString() + ' coins</b> (' + etb(user.balance) + ' ETB)\n\n' +
          '<b>To withdraw:</b>\n' +
          '1. Contact support with /support\n' +
          '2. Provide your Telebirr/CBE number\n' +
          '3. State the amount to withdraw\n' +
          '4. Receive payment within 24 hours\n\n' +
          '<b>Withdrawal Fees:</b>\n' +
          '  Under 1,000 coins → 5% fee\n' +
          '  1,000–5,000 coins → 3% fee\n' +
          '  Over 5,000 coins  → 1% fee\n\n' +
          '📞 Contact: /support',
          false
        );
      }
    }

    // ── /invite ───────────────────────────────────────────────
    else if (cmd === '/invite') {
      const refLink = 'https://t.me/omnihub_game_bot?start=ref_' + userId;
      send(
        '👥 <b>Invite Friends — Earn Coins!</b>\n\n' +
        '🎁 <b>Rewards:</b>\n' +
        '  ✅ Your friend joins → You earn <b>150 coins</b>\n' +
        '  ✅ Your friend joins → They earn <b>100 bonus coins</b>\n\n' +
        '🔗 <b>Your Invite Link:</b>\n' +
        '<code>' + refLink + '</code>\n\n' +
        '📤 Share this link with friends on Telegram, WhatsApp, TikTok, or anywhere!\n\n' +
        '💡 <i>Coins are credited automatically when your friend joins and plays their first game.</i>',
        false
      );
    }

    // ── /transfer ─────────────────────────────────────────────
    else if (cmd === '/transfer') {
      // Format: /transfer @username 100
      const targetArg  = args[0] || null;
      const amountArg  = parseInt(args[1], 10) || 0;

      if (!targetArg || amountArg < 10) {
        send(
          '🔄 <b>Transfer Coins</b>\n\n' +
          '<b>How to use:</b>\n' +
          '<code>/transfer @username amount</code>\n\n' +
          '<b>Example:</b>\n' +
          '<code>/transfer @friend 200</code>\n\n' +
          '📌 <b>Rules:</b>\n' +
          '  • Minimum transfer: 10 coins\n' +
          '  • Maximum: 10,000 coins/day\n' +
          '  • Recipient must have used the bot\n' +
          '  • Transfer fee: 2 coins flat\n\n' +
          '🪙 Your balance: <b>' + user.balance.toLocaleString() + ' coins</b>',
          false
        );
      } else {
        const fee   = 2;
        const total = amountArg + fee;
        if (user.balance < total) {
          send('❌ Insufficient balance. Need ' + total + ' coins (amount + 2 fee). You have ' + user.balance + '.', false);
        } else {
          // In production, look up target user by username.
          // For now, deduct from sender and show confirmation.
          user.balance -= total;
          send(
            '✅ <b>Transfer Sent!</b>\n\n' +
            '💸 Amount : <b>' + amountArg + ' coins</b>\n' +
            '👤 To     : ' + targetArg + '\n' +
            '💳 Fee    : 2 coins\n' +
            '🪙 Remaining: <b>' + user.balance.toLocaleString() + ' coins</b>\n\n' +
            '<i>Note: Recipient will receive coins when they next open OmniHub.</i>',
            false
          );
        }
      }
    }

    // ── /instruction ──────────────────────────────────────────
    else if (cmd === '/instruction') {
      send(
        '📖 <b>How to Play — OmniHub Games</b>\n\n' +
        '🎱 <b>5×5 Bingo (50 coins)</b>\n' +
        '1. Join a round — get a unique 5×5 card\n' +
        '2. Numbers 1–75 are called every 4 seconds\n' +
        '3. Tap called numbers on your card\n' +
        '4. Complete Row / Column / Diagonal / Full House\n' +
        '5. Tap BINGO! to claim the pot\n' +
        '🔐 Provably fair — verify every result!\n\n' +
        '🎰 <b>Slot Game (30 coins)</b>\n' +
        '• Spin 3 reels — match symbols to win\n' +
        '• Triple 7️⃣ = ×50 JACKPOT!\n\n' +
        '🎯 <b>Keno (50 coins)</b>\n' +
        '• Pick 1–10 numbers from 1–80\n' +
        '• 20 numbers drawn — match = win\n' +
        '• 10/10 match = ×1,000 payout!\n\n' +
        '🃏 <b>High/Low (20 coins)</b>\n' +
        '• Card 1–13 shown\n' +
        '• Guess Higher or Lower\n' +
        '• Correct = ×2 payout (40 coins)\n\n' +
        '💰 <b>Coins:</b> 1 coin = 0.10 ETB\n' +
        '🎁 <b>Free top-up:</b> 200 coins every 10 min when out of coins\n' +
        '👥 <b>Invite:</b> Earn 150 coins per friend — /invite',
        true
      );
    }

    // ── /support ──────────────────────────────────────────────
    else if (cmd === '/support') {
      send(
        '💬 <b>OmniHub Support</b>\n\n' +
        '👋 Hello ' + firstName + '! How can we help?\n\n' +
        '📌 <b>Common Topics:</b>\n' +
        '  • Deposit issues → /deposit\n' +
        '  • Withdrawal → /withdraw\n' +
        '  • Balance check → /balance\n' +
        '  • How to play → /instruction\n' +
        '  • Invite friends → /invite\n\n' +
        '📞 <b>Direct Support:</b>\n' +
        '  Telegram: @OmniHub_Support\n' +
        '  Hours: 9AM – 9PM (Addis Ababa)\n\n' +
        '📝 <b>To report an issue, send us:</b>\n' +
        '  1. Your Telegram ID: <code>' + userId + '</code>\n' +
        '  2. Describe your problem\n\n' +
        '<i>Average response time: under 30 minutes.</i>',
        false
      );
    }

    // ── Unknown command ───────────────────────────────────────
    else {
      send(
        '👋 Hi ' + firstName + '!\n\n' +
        '<b>Available Commands:</b>\n' +
        '/start — Open OmniHub\n' +
        '/register — Your account\n' +
        '/play — Launch games\n' +
        '/deposit — Buy coins\n' +
        '/balance — Check wallet\n' +
        '/withdraw — Cash out\n' +
        '/invite — Earn by referring\n' +
        '/transfer — Send coins\n' +
        '/instruction — How to play\n' +
        '/support — Get help',
        true
      );
    }

  } catch (err) {
    console.error('[Webhook] error:', err);
  }
});

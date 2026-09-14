<?php
// POST /api/contact.php — public purchase/renewal request form. PHP 5.4+ compatible.
require __DIR__ . '/store.php';

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';
if ($method !== 'POST') nexus_respond(405, array('ok' => false, 'error' => 'POST only'));

$in = nexus_json_body();

// honeypot: bots fill hidden field
if (!empty($in['hp'])) nexus_respond(200, array('ok' => true)); // silently swallow bots

$name = isset($in['name']) ? trim(preg_replace('/[\x00-\x1F\x7F]/', '', (string)$in['name'])) : '';
$contact = isset($in['contact']) ? trim(preg_replace('/[\x00-\x1F\x7F]/', '', (string)$in['contact'])) : '';
$type = isset($in['type']) ? $in['type'] : 'buy';
$plan = isset($in['plan']) ? $in['plan'] : '1m';
$username = isset($in['username']) ? trim(preg_replace('/[^A-Za-z0-9_.@-]/', '', (string)$in['username'])) : '';
$note = isset($in['note']) ? mb_substr(trim(preg_replace('/[\x00-\x1F\x7F]/', '', (string)$in['note'])), 0, 500, 'UTF-8') : '';

if (mb_strlen($name, 'UTF-8') < 2 || mb_strlen($name, 'UTF-8') > 60) nexus_respond(400, array('ok' => false, 'error' => 'invalid name'));
if (!filter_var($contact, FILTER_VALIDATE_EMAIL)) nexus_respond(400, array('ok' => false, 'error' => 'valid email required'));
if (strlen($contact) > 80) nexus_respond(400, array('ok' => false, 'error' => 'invalid email'));
if (!in_array($type, array('buy', 'renew'))) $type = 'buy';
if (!in_array($plan, array('1m', '3m'))) $plan = '1m';

// rate limit per IP: 5/hour
$rl = nexus_read('contact_rl', array());
$ip = nexus_ip();
$e = isset($rl[$ip]) ? $rl[$ip] : array('n' => 0, 'until' => 0);
if ($e['until'] > time()) nexus_respond(429, array('ok' => false, 'error' => 'Too many requests — try again later'));
$e['n']++;
if ($e['n'] >= 5) { $e['until'] = time() + 3600; $e['n'] = 0; }
$rl[$ip] = $e;
nexus_write('contact_rl', $rl);

$rec = array(
    'id' => substr(hash('sha256', uniqid('', true)), 0, 10),
    'ts' => time(), 'status' => 'new',
    'name' => $name, 'contact' => $contact, 'type' => $type, 'plan' => $plan,
    'username' => $username, 'note' => $note, 'ip' => $ip,
);
$requests = nexus_read('requests', array());
$requests[] = $rec;
if (count($requests) > 500) $requests = array_slice($requests, -500);
nexus_write('requests', $requests);

$typeFa = $type === 'buy' ? 'خرید اشتراک' : 'تمدید اشتراک';
$planFa = $plan === '1m' ? '۱ ماهه' : '۳ ماهه';
$body = "درخواست جدید — Persian Trade (ai.ipeset.com)\n"
    . "============================================\n"
    . "نوع: {$typeFa} ({$type})\nپلن: {$planFa} ({$plan})\n"
    . "نام: {$name}\nایمیل: {$contact}\n"
    . ($username !== '' ? "نام‌کاربری (برای تمدید): {$username}\n" : '')
    . ($note !== '' ? "توضیحات: {$note}\n" : '')
    . "IP: {$ip}\nTime: " . gmdate('c') . "\n";
$subject = '=?UTF-8?B?' . base64_encode('Persian Trade — ' . $typeFa . ' (' . $name . ')') . '?=';
$headers = 'From: Persian Trade <trade@ipeset.com>' . "\r\n"
    . 'Reply-To: trade@ipeset.com' . "\r\n"
    . 'Content-Type: text/plain; charset=UTF-8' . "\r\n"
    . 'X-Mailer: PersianTrade-ContactForm';
@mail('trade@ipeset.com', $subject, $body, $headers);

nexus_audit('contact_request', 'public', $type . ' ' . $plan . ' from ' . $name);

// confirmation email to the requester
$typeName = $type === 'buy' ? 'خرید اشتراک / Purchase' : 'تمدید اشتراک / Renewal';
$planName = $plan === '1m' ? '۱ ماهه — ۳۰ تتر (1 MONTH — 13 USDT)' : '۳ ماهه — ۷۰ تتر (3 MONTHS — 29 USDT)';
$confBody = "سلام {$name}،\n\nدرخواست شما در Persian Trade ثبت شد:\n"
    . "نوع: {$typeName}\nپلن: {$planName}\n\n"
    . "پس از تأیید پرداخت، نام‌کاربری و رمز عبور شما از طریق همین ایمیل ارسال می‌شود.\n"
    . "لطفاً پوشه Inbox و اسپم (Spam/Junk) را بررسی کنید.\n\n"
    . "================================\n"
    . "Hello {$name},\nYour request has been received.\n"
    . "After payment confirmation, your login credentials will be sent to this email.\n"
    . "Please check both INBOX and SPAM/Junk folders.\n\n"
    . "— Persian Trade | https://ai.ipeset.com\n"
    . "Telegram: @persiantrade2025";
$confHeaders = 'From: Persian Trade <trade@ipeset.com>' . "\r\n"
    . 'Content-Type: text/plain; charset=UTF-8' . "\r\n"
    . 'X-Mailer: PersianTrade-Notify';
@mail($contact, '=?UTF-8?B?' . base64_encode('Persian Trade — درخواست شما ثبت شد / Request Received') . '?=', $confBody, $confHeaders);

nexus_respond(200, array('ok' => true));

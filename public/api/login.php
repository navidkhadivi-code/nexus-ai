<?php
// POST /api/login.php  {action:'setup'|'login', username, password} — PHP 5.4+ compatible
require __DIR__ . '/store.php';

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';
if ($method !== 'POST') nexus_respond(405, array('ok' => false, 'error' => 'POST only'));

$in = nexus_json_body();
$action = isset($in['action']) ? $in['action'] : 'login';
$usernameRaw = isset($in['username']) ? (string)$in['username'] : '';
$password = isset($in['password']) ? (string)$in['password'] : '';
$username = substr(preg_replace('/[^A-Za-z0-9_.@-]/', '', $usernameRaw), 0, 32);
$users = nexus_read('users', array());
$sessions = nexus_read('sessions', array());

function issue_token(&$sessions, $username, $role) {
    $tok = nexus_random_token();
    $sessions[hash('sha256', $tok)] = array('user' => $username, 'role' => $role, 'exp' => time() + 7 * 86400, 'created' => time());
    foreach ($sessions as $h => $s) {
        $exp = isset($s['exp']) ? $s['exp'] : 0;
        if ($exp < time()) unset($sessions[$h]);
    }
    return $tok;
}

if ($action === 'setup') {
    if (!empty($users)) nexus_respond(403, array('ok' => false, 'error' => 'Already configured'));
    if (strlen($username) < 3) nexus_respond(400, array('ok' => false, 'error' => 'Username too short (min 3)'));
    if (strlen($password) < 8) nexus_respond(400, array('ok' => false, 'error' => 'Password too short (min 8)'));
    $users[$username] = array('hash' => password_hash($password, PASSWORD_DEFAULT), 'role' => 'SUPER_ADMIN', 'created' => time());
    if (!nexus_write('users', $users)) nexus_respond(500, array('ok' => false, 'error' => 'Storage write failed'));
    $tok = issue_token($sessions, $username, 'SUPER_ADMIN');
    nexus_write('sessions', $sessions);
    nexus_audit('setup_admin', $username);
    nexus_set_cookie($tok, time() + 7 * 86400);
    nexus_respond(200, array('ok' => true, 'user' => $username, 'role' => 'SUPER_ADMIN'));
}

if ($username === '' || $password === '') nexus_respond(400, array('ok' => false, 'error' => 'Missing credentials'));

$attempts = nexus_read('attempts', array());
$key = nexus_ip() . '|' . $username;
$a = isset($attempts[$key]) ? $attempts[$key] : array('n' => 0, 'until' => 0);
$until = isset($a['until']) ? $a['until'] : 0;
if ($until > time()) {
    nexus_respond(429, array('ok' => false, 'error' => 'Too many failed attempts. Try again in ' . ceil(($until - time()) / 60) . ' min'));
}

if (empty($users)) nexus_respond(200, array('ok' => false, 'setupRequired' => true));

$user = isset($users[$username]) ? $users[$username] : null;
$valid = false;
if ($user) {
    $valid = password_verify($password, $user['hash']);
} else {
    password_verify($password, '$2y$10$Cn6Z0Cn6Z0Cn6Z0Cn6Z0Cn6Z0Cn6Z0Cn6Z0Cn6Z0Cn6Z0Cn6Z0Cn'); // equalize timing
}

if ($valid) {
    unset($attempts[$key]);
    nexus_write('attempts', $attempts);
    $tok = issue_token($sessions, $username, $user['role']);
    nexus_write('sessions', $sessions);
    nexus_audit('login', $username, 'ok');
    nexus_set_cookie($tok, time() + 7 * 86400);
    nexus_respond(200, array('ok' => true, 'user' => $username, 'role' => $user['role']));
}

$n = isset($a['n']) ? (int)$a['n'] : 0;
$a['n'] = $n + 1;
if ($a['n'] >= 5) { $a['until'] = time() + 900; $a['n'] = 0; }
$attempts[$key] = $a;
nexus_write('attempts', $attempts);
nexus_audit('login_failed', $username);
nexus_respond(401, array('ok' => false, 'error' => 'Invalid username or password'));

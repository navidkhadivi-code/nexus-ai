<?php
// POST /api/users.php — admin-only subscription management. PHP 5.4+ compatible.
// Actions: list | create | disable | enable | extend | pass | delete
require __DIR__ . '/store.php';

$PLAN_SECS = array('1m' => 30 * 86400, '3m' => 90 * 86400);

function admin_check($tok) {
    if ($tok === '') nexus_respond(401, array('ok' => false, 'error' => 'Authentication required'));
    $sessions = nexus_read('sessions', array());
    $h = hash('sha256', $tok);
    $s = isset($sessions[$h]) ? $sessions[$h] : null;
    $exp = ($s && isset($s['exp'])) ? $s['exp'] : 0;
    if (!$s || $exp < time()) nexus_respond(401, array('ok' => false, 'error' => 'Session expired'));
    $users = nexus_read('users', array());
    $me = isset($users[$s['user']]) ? $users[$s['user']] : null;
    if (!$me || ($me['role'] !== 'ADMIN' && $me['role'] !== 'SUPER_ADMIN')) nexus_respond(403, array('ok' => false, 'error' => 'Admin only'));
    return $s['user'];
}

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';
if ($method !== 'POST') nexus_respond(405, array('ok' => false, 'error' => 'POST only'));

$tok = isset($_COOKIE['nexus_admin']) ? $_COOKIE['nexus_admin'] : '';
$adminUser = admin_check($tok);

$in = nexus_json_body();
$action = isset($in['action']) ? $in['action'] : 'list';
$users = nexus_read('users', array());

function public_users($users) {
    $out = array();
    foreach ($users as $u => $rec) {
        $out[] = array(
            'user' => $u, 'role' => $rec['role'],
            'plan' => isset($rec['plan']) ? $rec['plan'] : null,
            'expires' => isset($rec['expires']) ? $rec['expires'] : null,
            'disabled' => !empty($rec['disabled']),
            'created' => isset($rec['created']) ? $rec['created'] : null,
        );
    }
    usort($out, function ($a, $b) { return strcmp($a['user'], $b['user']); });
    return $out;
}

function purge_user_sessions($username) {
    $sessions = nexus_read('sessions', array());
    $changed = false;
    foreach ($sessions as $h => $s) {
        if (isset($s['user']) && $s['user'] === $username) { unset($sessions[$h]); $changed = true; }
    }
    if ($changed) nexus_write('sessions', $sessions);
}

if ($action === 'list') {
    nexus_respond(200, array('ok' => true, 'users' => public_users($users)));
}

$username = isset($in['username']) ? substr(preg_replace('/[^A-Za-z0-9_.@-]/', '', (string)$in['username']), 0, 32) : '';
if ($username === '') nexus_respond(400, array('ok' => false, 'error' => 'Missing username'));

if ($action === 'create') {
    if (isset($users[$username])) nexus_respond(409, array('ok' => false, 'error' => 'Username already exists'));
    $password = isset($in['password']) ? (string)$in['password'] : '';
    $plan = isset($in['plan']) ? $in['plan'] : '1m';
    if (!isset($PLAN_SECS[$plan])) nexus_respond(400, array('ok' => false, 'error' => 'Plan must be 1m or 3m'));
    if (strlen($password) < 8) nexus_respond(400, array('ok' => false, 'error' => 'Password too short (min 8)'));
    $users[$username] = array(
        'hash' => password_hash($password, PASSWORD_DEFAULT), 'role' => 'USER', 'plan' => $plan,
        'created' => time(), 'expires' => time() + $PLAN_SECS[$plan], 'disabled' => false,
    );
    nexus_write('users', $users);
    nexus_audit('user_create', $adminUser, $username . ' plan=' . $plan);
    nexus_respond(200, array('ok' => true, 'users' => public_users($users)));
}

if (!isset($users[$username])) nexus_respond(404, array('ok' => false, 'error' => 'User not found'));

if ($users[$username]['role'] === 'ADMIN' || $users[$username]['role'] === 'SUPER_ADMIN') nexus_respond(403, array('ok' => false, 'error' => 'Cannot modify admin account here'));

if ($action === 'disable') {
    $users[$username]['disabled'] = true;
    nexus_write('users', $users);
    purge_user_sessions($username); // kicks them out immediately
    nexus_audit('user_disable', $adminUser, $username);
    nexus_respond(200, array('ok' => true, 'users' => public_users($users)));
}
if ($action === 'enable') {
    $users[$username]['disabled'] = false;
    nexus_write('users', $users);
    nexus_audit('user_enable', $adminUser, $username);
    nexus_respond(200, array('ok' => true, 'users' => public_users($users)));
}
if ($action === 'extend') {
    $plan = isset($in['plan']) ? $in['plan'] : '1m';
    if (!isset($PLAN_SECS[$plan])) nexus_respond(400, array('ok' => false, 'error' => 'Plan must be 1m or 3m'));
    $cur = isset($users[$username]['expires']) ? (int)$users[$username]['expires'] : 0;
    $base = max($cur, time());
    $users[$username]['expires'] = $base + $PLAN_SECS[$plan];
    $users[$username]['plan'] = $plan;
    $users[$username]['disabled'] = false;
    nexus_write('users', $users);
    nexus_audit('user_extend', $adminUser, $username . ' +' . $plan);
    nexus_respond(200, array('ok' => true, 'users' => public_users($users)));
}
if ($action === 'pass') {
    $password = isset($in['password']) ? (string)$in['password'] : '';
    if (strlen($password) < 8) nexus_respond(400, array('ok' => false, 'error' => 'Password too short (min 8)'));
    $users[$username]['hash'] = password_hash($password, PASSWORD_DEFAULT);
    nexus_write('users', $users);
    purge_user_sessions($username);
    nexus_audit('user_password_reset', $adminUser, $username);
    nexus_respond(200, array('ok' => true));
}
if ($action === 'delete') {
    unset($users[$username]);
    nexus_write('users', $users);
    purge_user_sessions($username);
    nexus_audit('user_delete', $adminUser, $username);
    nexus_respond(200, array('ok' => true, 'users' => public_users($users)));
}

nexus_respond(400, array('ok' => false, 'error' => 'Unknown action'));

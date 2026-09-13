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
            'email' => isset($rec['email']) ? $rec['email'] : '',
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

function user_mail($to, $subject, $lines) {
    $body = "Persian Trade — ai.ipeset.com\n================================\n\n" . implode("\n", $lines) . "\n";
    $headers = 'From: Persian Trade <trade@ipeset.com>' . "\r\n"
        . 'Content-Type: text/plain; charset=UTF-8' . "\r\n"
        . 'X-Mailer: PersianTrade-Notify';
    return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers);
}

function plan_label($plan) { return $plan === '3m' ? '۳ ماهه (3 MONTHS)' : '۱ ماهه (1 MONTH)'; }

if ($action === 'list') {
    nexus_respond(200, array('ok' => true, 'users' => public_users($users)));
}

$username = isset($in['username']) ? substr(preg_replace('/[^A-Za-z0-9_.@-]/', '', (string)$in['username']), 0, 32) : '';
if ($username === '') nexus_respond(400, array('ok' => false, 'error' => 'Missing username'));

if ($action === 'create') {
    if (isset($users[$username])) nexus_respond(409, array('ok' => false, 'error' => 'Username already exists'));
    $password = isset($in['password']) ? (string)$in['password'] : '';
    $plan = isset($in['plan']) ? $in['plan'] : '1m';
    $email = isset($in['email']) ? trim((string)$in['email']) : '';
    $email = filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : '';
    if (!isset($PLAN_SECS[$plan])) nexus_respond(400, array('ok' => false, 'error' => 'Plan must be 1m or 3m'));
    if (strlen($password) < 8) nexus_respond(400, array('ok' => false, 'error' => 'Password too short (min 8)'));
    $exp = time() + $PLAN_SECS[$plan];
    $users[$username] = array(
        'hash' => password_hash($password, PASSWORD_DEFAULT), 'role' => 'USER', 'plan' => $plan,
        'created' => time(), 'expires' => $exp, 'disabled' => false, 'email' => $email,
    );
    nexus_write('users', $users);
    nexus_audit('user_create', $adminUser, $username . ' plan=' . $plan . ' email=' . $email);

    // auto-close matching purchase requests
    $requests = nexus_read('requests', array());
    $changed = false;
    foreach ($requests as $i => $r) {
        if (isset($r['status']) && $r['status'] === 'new' && isset($r['username']) && strcasecmp($r['username'], $username) === 0) {
            $requests[$i]['status'] = 'done';
            $changed = true;
        }
    }
    if ($changed) nexus_write('requests', array_values($requests));

    // activation email to the buyer
    if ($email !== '') {
        user_mail($email, 'Persian Trade — حساب شما فعال شد / Account Activated', array(
            'کاربر گرامی ' . $username . '، اشتراک شما فعال شد:',
            '',
            'نام‌کاربری: ' . $username,
            'رمز عبور: ' . $password,
            'اشتراک: ' . plan_label($plan) . ' — تا ' . gmdate('Y-m-d', $exp) . ' (UTC)',
            '',
            'آدرس ورود: https://ai.ipeset.com',
            'با این مشخصات وارد شوید و از سیگنال‌های زنده استفاده کنید.',
            '',
            'Dear ' . $username . ', your subscription is now ACTIVE.',
            'Login at https://ai.ipeset.com with username: ' . $username,
            '',
            '— Persian Trade',
        ));
    }
    nexus_respond(200, array('ok' => true, 'users' => public_users($users), 'mailSent' => $email !== ''));
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
    $em = isset($users[$username]['email']) ? $users[$username]['email'] : '';
    if ($em !== '') {
        user_mail($em, 'Persian Trade — اشتراک تمدید شد / Subscription Extended', array(
            'نام‌کاربری: ' . $username,
            'اشتراک جدید: ' . plan_label($plan) . ' — معتبر تا ' . gmdate('Y-m-d', $users[$username]['expires']) . ' (UTC)',
            'ورود: https://ai.ipeset.com',
            '',
            'Your subscription has been extended until ' . gmdate('Y-m-d', $users[$username]['expires']) . ' UTC.',
        ));
    }
    nexus_respond(200, array('ok' => true, 'users' => public_users($users)));
}
if ($action === 'pass') {
    $password = isset($in['password']) ? (string)$in['password'] : '';
    if (strlen($password) < 8) nexus_respond(400, array('ok' => false, 'error' => 'Password too short (min 8)'));
    $users[$username]['hash'] = password_hash($password, PASSWORD_DEFAULT);
    nexus_write('users', $users);
    purge_user_sessions($username);
    nexus_audit('user_password_reset', $adminUser, $username);
    $em2 = isset($users[$username]['email']) ? $users[$username]['email'] : '';
    if ($em2 !== '') {
        user_mail($em2, 'Persian Trade — رمز جدید / New Password', array(
            'نام‌کاربری: ' . $username,
            'رمز عبور جدید: ' . $password,
            'ورود: https://ai.ipeset.com',
        ));
    }
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

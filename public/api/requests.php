<?php
// POST /api/requests.php — admin-only: list | done | delete purchase requests. PHP 5.4+ compatible.
require __DIR__ . '/store.php';

function req_admin_check($tok) {
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
$adminUser = req_admin_check($tok);

$in = nexus_json_body();
$action = isset($in['action']) ? $in['action'] : 'list';
$requests = nexus_read('requests', array());

if ($action === 'list') {
    $out = array_reverse($requests);
    nexus_respond(200, array('ok' => true, 'requests' => $out));
}

$id = isset($in['id']) ? preg_replace('/[^a-f0-9]/', '', (string)$in['id']) : '';
$found = false;
foreach ($requests as $i => $r) {
    if (isset($r['id']) && $r['id'] === $id) {
        $found = true;
        if ($action === 'done') $requests[$i]['status'] = 'done';
        if ($action === 'delete') unset($requests[$i]);
    }
}
if (!$found) nexus_respond(404, array('ok' => false, 'error' => 'Not found'));
$requests = array_values($requests);
nexus_write('requests', $requests);
nexus_audit('request_' . $action, $adminUser, $id);
nexus_respond(200, array('ok' => true, 'requests' => array_reverse($requests)));

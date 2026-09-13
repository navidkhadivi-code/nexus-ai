<?php
// GET /api/session.php — auth probe for the SPA. PHP 5.4+ compatible.
require __DIR__ . '/store.php';

$users = nexus_read('users', array());
$setupRequired = empty($users);

$tok = isset($_COOKIE['nexus_admin']) ? $_COOKIE['nexus_admin'] : '';
if ($tok === '') nexus_respond(200, array('authenticated' => false, 'setupRequired' => $setupRequired));

$sessions = nexus_read('sessions', array());
$h = hash('sha256', $tok);
$s = isset($sessions[$h]) ? $sessions[$h] : null;
$exp = ($s && isset($s['exp'])) ? $s['exp'] : 0;
if (!$s || $exp < time()) {
    if ($s) { unset($sessions[$h]); nexus_write('sessions', $sessions); }
    nexus_respond(200, array('authenticated' => false, 'setupRequired' => $setupRequired));
}
nexus_respond(200, array('authenticated' => true, 'user' => $s['user'], 'role' => $s['role'], 'setupRequired' => false));

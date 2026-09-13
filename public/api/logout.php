<?php
// POST /api/logout.php — PHP 5.4+ compatible.
require __DIR__ . '/store.php';

$tok = isset($_COOKIE['nexus_admin']) ? $_COOKIE['nexus_admin'] : '';
if ($tok !== '') {
    $sessions = nexus_read('sessions', array());
    $h = hash('sha256', $tok);
    if (isset($sessions[$h])) {
        $u = isset($sessions[$h]['user']) ? $sessions[$h]['user'] : '?';
        nexus_audit('logout', $u);
        unset($sessions[$h]);
        nexus_write('sessions', $sessions);
    }
}
nexus_set_cookie('', time() - 3600);
nexus_respond(200, array('ok' => true));

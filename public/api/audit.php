<?php
// GET /api/audit.php — audit log (authenticated only). PHP 5.4+ compatible.
require __DIR__ . '/store.php';

$tok = isset($_COOKIE['nexus_admin']) ? $_COOKIE['nexus_admin'] : '';
$sessions = nexus_read('sessions', array());
$h = hash('sha256', $tok);
$s = isset($sessions[$h]) ? $sessions[$h] : null;
$exp = ($s && isset($s['exp'])) ? $s['exp'] : 0;
if ($tok === '' || !$s || $exp < time()) {
    nexus_respond(401, array('ok' => false, 'error' => 'Authentication required'));
}
$lines = nexus_audit_lines(200);
$out = array();
foreach ($lines as $l) { $out[] = json_decode($l, true); }
nexus_respond(200, array('ok' => true, 'lines' => $out));

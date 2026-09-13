<?php
// Persian Trade admin gate — PHP 5.4+ compatible (host runs legacy PHP). Data OUTSIDE webroot.

$home = dirname(dirname(__DIR__)); // /home3/<user>
if (!is_dir($home . '/nexus_data')) { @mkdir($home . '/nexus_data', 0700, true); }
define('NEXUS_DATA', $home . '/nexus_data');

function nexus_path($name) { return NEXUS_DATA . '/' . $name . '.json'; }

function nexus_read($name, $default = null) {
    $f = nexus_path($name);
    if (!file_exists($f)) return $default;
    $x = json_decode((string)file_get_contents($f), true);
    return $x === null ? $default : $x;
}

function nexus_write($name, $data) {
    $f = nexus_path($name);
    $t = $f . '.tmp';
    if (file_put_contents($t, json_encode($data, JSON_UNESCAPED_SLASHES), LOCK_EX) === false) return false;
    @chmod($t, 0600);
    return rename($t, $f);
}

function nexus_respond($code, $obj) {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($obj);
    exit;
}

function nexus_ip() { return isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown'; }

function nexus_json_body() {
    $raw = file_get_contents('php://input');
    if (!$raw) return array();
    $ct = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : '';
    if (stripos($ct, 'application/json') === false && empty($_SERVER['HTTP_X_REQUESTED_WITH'])) return array();
    $x = json_decode($raw, true);
    return is_array($x) ? $x : array();
}

function nexus_random_token() {
    if (function_exists('random_bytes')) return bin2hex(random_bytes(32));
    if (function_exists('openssl_random_pseudo_bytes')) return bin2hex(openssl_random_pseudo_bytes(32));
    return sha1(uniqid(mt_rand(), true)) . sha1(uniqid(mt_rand(), true));
}

function nexus_set_cookie($tok, $expire) {
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $c = 'nexus_admin=' . $tok
        . '; expires=' . gmdate('D, d-M-Y H:i:s T', $expire)
        . '; path=/; HttpOnly'
        . ($secure ? '; Secure' : '')
        . '; SameSite=Lax';
    header('Set-Cookie: ' . $c);
}

function nexus_audit($action, $user, $detail = '') {
    $line = json_encode(array(
        'ts' => gmdate('c'), 'ip' => nexus_ip(), 'action' => $action,
        'user' => $user, 'detail' => $detail,
    ), JSON_UNESCAPED_SLASHES) . "\n";
    @file_put_contents(NEXUS_DATA . '/audit.log', $line, FILE_APPEND | LOCK_EX);
    @chmod(NEXUS_DATA . '/audit.log', 0600);
}

function nexus_audit_lines($n = 100) {
    $f = NEXUS_DATA . '/audit.log';
    if (!file_exists($f)) return array();
    $lines = file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    return array_slice(array_reverse($lines), 0, $n);
}

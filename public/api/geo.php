<?php
// GET /api/geo.php — server-side visitor country detection (no browser CORS issues).
require __DIR__ . '/store.php';

$ip = '';
if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
    $parts = explode(',', (string)$_SERVER['HTTP_X_FORWARDED_FOR']);
    $ip = trim($parts[0]);
}
if ($ip === '' && !empty($_SERVER['REMOTE_ADDR'])) $ip = (string)$_SERVER['REMOTE_ADDR'];
if (filter_var($ip, FILTER_VALIDATE_IP) === false) $ip = '';

$out = array('ok' => false, 'country' => '');
if ($ip !== '' && !in_array($ip, array('127.0.0.1', '::1'))) {
    $cacheKey = 'geo_' . substr(hash('sha256', $ip), 0, 16);
    $cached = nexus_read($cacheKey, null);
    if (is_array($cached) && (isset($cached['ts']) ? (int)$cached['ts'] : 0) > time() - 600) {
        $out = array('ok' => true, 'country' => $cached['country']);
    } else {
        $url = 'http://ip-api.com/json/' . rawurlencode($ip) . '?fields=status,countryCode';
        $body = false;
        if (ini_get('allow_url_fopen')) {
            $ctx = stream_context_create(array('http' => array('timeout' => 8)));
            $body = @file_get_contents($url, false, $ctx);
        }
        if ($body === false && function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8));
            $body = curl_exec($ch);
            curl_close($ch);
        }
        if ($body) {
            $j = json_decode($body, true);
            if (is_array($j) && (isset($j['status']) ? $j['status'] : '') === 'success' && !empty($j['countryCode'])) {
                $out = array('ok' => true, 'country' => strtoupper((string)$j['countryCode']));
                nexus_write($cacheKey, array('ts' => time(), 'country' => $out['country']));
            }
        }
    }
}

header('Content-Type: application/json');
echo json_encode($out);

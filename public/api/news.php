<?php
// GET /api/news.php?t=bitcoin — server-side Google News RSS proxy (bypasses browser CORS).
// Real headlines only; cached 10 minutes. PHP 5.4+ compatible.
require __DIR__ . '/store.php';

$TOPICS = array(
    'crypto'   => 'cryptocurrency market',
    'bitcoin'  => 'bitcoin',
    'ethereum' => 'ethereum',
    'solana'   => 'solana',
    'bnb'      => 'BNB binance',
    'xrp'      => 'XRP ripple',
    'doge'     => 'dogecoin',
    'gold'     => 'gold price',
);

$t = isset($_GET['t']) ? strtolower(preg_replace('/[^a-z]/', '', (string)$_GET['t'])) : 'crypto';
if (!isset($TOPICS[$t])) $t = 'crypto';

$cacheFile = NEXUS_DATA . '/news_' . $t . '.json';
if (file_exists($cacheFile) && (time() - (int)@filemtime($cacheFile)) < 600) {
    header('Content-Type: application/json');
    header('X-Cache: HIT');
    echo (string)file_get_contents($cacheFile);
    exit;
}

$rssUrl = 'https://news.google.com/rss/search?q=' . rawurlencode($TOPICS[$t] . ' when:1d') . '&hl=en-US&gl=US&ceid=US:en';

$xml = false;
$ctx = stream_context_create(array('http' => array('timeout' => 12, 'header' => "User-Agent: Mozilla/5.0 (X11; Linux x86_64)\r\nAccept: */*\r\n")));
if (function_exists('file_get_contents') && ini_get('allow_url_fopen')) {
    $xml = @file_get_contents($rssUrl, false, $ctx);
}
if (!$xml && function_exists('curl_init')) {
    $ch = curl_init($rssUrl);
    curl_setopt_array($ch, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (X11; Linux x86_64)'));
    $xml = curl_exec($ch);
    curl_close($ch);
}

$out = array('ok' => false, 'items' => array(), 'cached' => 0);
if ($xml && strpos($xml, '<item>') !== false && class_exists('SimpleXMLElement')) {
    libxml_use_internal_errors(true);
    $rss = simplexml_load_string($xml);
    if ($rss && isset($rss->channel->item)) {
        $items = array();
        foreach ($rss->channel->item as $it) {
            if (count($items) >= 30) break;
            $title = trim((string)$it->title);
            $source = '';
            if (isset($it->source)) $source = trim((string)$it->source);
            if ($source === '' && strpos($title, ' - ') !== false) {
                $p = strrpos($title, ' - ');
                $source = substr($title, $p + 3);
            }
            // strip trailing " - Source" from title (source shown separately)
            if ($source !== '' && substr($title, -strlen($source) - 3) === ' - ' . $source) {
                $title = trim(substr($title, 0, -strlen($source) - 3));
            }
            $items[] = array(
                'title' => $title,
                'link'  => (string)$it->link,
                'source' => $source !== '' ? $source : 'Google News',
                'ts' => strtotime((string)$it->pubDate) ?: time(),
            );
        }
        $out = array('ok' => true, 'items' => $items, 'cached' => time());
        @file_put_contents($cacheFile, json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        @chmod($cacheFile, 0644);
    }
}

header('Content-Type: application/json');
header('X-Cache: MISS');
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

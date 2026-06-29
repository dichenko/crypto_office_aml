<?php

function load_env(string $path): void
{
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
            continue;
        }

        [$key, $value] = explode('=', $line, 2);
        $_ENV[trim($key)] = trim($value);
    }
}

function request_json(string $url, array $headers, string $method = 'GET'): array
{
    $curl = curl_init();
    curl_setopt_array($curl, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
    ]);

    $response = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error = curl_error($curl);
    curl_close($curl);

    if ($response === false) {
        throw new RuntimeException($error);
    }

    $json = json_decode($response, true);
    return [$status, $json ?? $response];
}

function encrypt_phrase(string $secret, string $phrase): string
{
    $key = sodium_crypto_generichash($secret, '', 32);
    $nonce = random_bytes(SODIUM_CRYPTO_STREAM_NONCEBYTES);
    $ciphertext = sodium_crypto_stream_xor($phrase, $nonce, $key);

    return base64_encode($nonce . $ciphertext);
}

load_env(__DIR__ . '/.env');

$apiBase = $_ENV['CRYPTO_OFFICE_API_BASE_URL'] ?? 'https://public.crypto-office.com/api';
$public = $_ENV['CRYPTO_OFFICE_PUBLIC_KEY'] ?? null;
$secret = $_ENV['CRYPTO_OFFICE_SECRET_KEY'] ?? null;

if (!$public || !$secret) {
    throw new RuntimeException('Missing CRYPTO_OFFICE_PUBLIC_KEY or CRYPTO_OFFICE_SECRET_KEY');
}

[$phraseStatus, $phraseBody] = request_json($apiBase . '/get-phrase', ['Accept: application/json']);
printf("get-phrase HTTP %d\n", $phraseStatus);

if (!isset($phraseBody['data']['phrase'])) {
    echo json_encode($phraseBody, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
    exit(1);
}

$phrase = $phraseBody['data']['phrase'] . '|' . time();
$token = $public . '|' . encrypt_phrase($secret, $phrase);

[$authStatus, $authBody] = request_json(
    $apiBase . '/auth/generate-request-hash',
    [
        'Accept: application/json',
        'Content-Type: application/json',
        'Authorization: External ' . $token,
    ],
    'POST',
);

printf("auth HTTP %d\n", $authStatus);
echo json_encode($authBody, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;

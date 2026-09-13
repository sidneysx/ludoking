<?php
header('Content-Type: application/json; charset=utf-8');

$dir = __DIR__ . '/../data/rooms';
if(!is_dir($dir)) mkdir($dir, 0775, true);

function bad($msg, $code = 400){
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

function roomFile($dir, $code){
    if(!preg_match('/^[A-Z0-9]{4,8}$/', $code)) bad('Código de sala inválido');
    return $dir . '/' . $code . '.json';
}

$method = $_SERVER['REQUEST_METHOD'];

if($method === 'GET'){
    $code = strtoupper(trim($_GET['code'] ?? ''));
    if($code === '') bad('Código não informado');
    $file = roomFile($dir, $code);
    if(!file_exists($file)) bad('Sala não encontrada', 404);
    readfile($file);
    exit;
}

if($method === 'POST'){
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    if(!is_array($data) || empty($data['code'])) bad('Estado inválido');
    $code = strtoupper(trim($data['code']));
    $file = roomFile($dir, $code);
    $fp = fopen($file, 'c+');
    if(!$fp) bad('Não foi possível salvar a sala', 500);
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    fwrite($fp, json_encode($data));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    echo json_encode(['ok' => true]);
    exit;
}

bad('Método não suportado', 405);

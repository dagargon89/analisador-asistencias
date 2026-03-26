<?php

namespace App\Services;

use RuntimeException;

class GeminiChatService
{
    private string $apiKey;

    public function __construct(?string $apiKey = null)
    {
        $this->apiKey = trim((string) ($apiKey ?? env('gemini.apiKey', '')));
    }

    public function isEnabled(): bool
    {
        return $this->apiKey !== '';
    }

    /**
     * @param list<array{role:string,text:string}> $history
     */
    public function ask(string $question, string $context, array $history = []): string
    {
        if (!$this->isEnabled()) {
            throw new RuntimeException('La variable gemini.apiKey no está configurada en el backend.');
        }

        $system = "Eres un asistente experto en asistencia laboral. Responde solo en español. "
            . "Usa exclusivamente el contexto SQL proporcionado y no inventes datos.";

        $contents = [];
        foreach ($history as $msg) {
            if (!isset($msg['role'], $msg['text'])) {
                continue;
            }
            $role = $msg['role'] === 'model' ? 'model' : 'user';
            $contents[] = [
                'role' => $role,
                'parts' => [['text' => (string) $msg['text']]],
            ];
        }

        $contents[] = [
            'role' => 'user',
            'parts' => [[
                'text' => "Contexto:\n" . $context . "\n\nPregunta:\n" . $question,
            ]],
        ];

        $payload = [
            'system_instruction' => [
                'parts' => [['text' => $system]],
            ],
            'contents' => $contents,
            'generationConfig' => [
                'temperature' => 0.2,
                'maxOutputTokens' => 700,
            ],
        ];

        $url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='
            . urlencode($this->apiKey);
        $raw = $this->postJson($url, $payload);
        $json = json_decode($raw, true);

        $text = $json['candidates'][0]['content']['parts'][0]['text'] ?? null;
        if (!is_string($text) || trim($text) === '') {
            throw new RuntimeException('Gemini no devolvió contenido utilizable.');
        }

        return trim($text);
    }

    private function postJson(string $url, array $payload): string
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
        ]);
        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if (!is_string($response)) {
            throw new RuntimeException('Error de red al contactar Gemini: ' . $err);
        }
        if ($httpCode < 200 || $httpCode >= 300) {
            throw new RuntimeException('Gemini devolvió HTTP ' . $httpCode . ': ' . $response);
        }
        return $response;
    }
}


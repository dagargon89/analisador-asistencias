<?php

declare(strict_types=1);

namespace App\Services;

use CodeIgniter\Email\Email;
use Config\Services;
use Throwable;

/**
 * Notificaciones transaccionales para el flujo de ausencias.
 *
 * Implementación síncrona: usa el Email service de CI4 si está configurado en .env
 * (email.*). Si no, hace no-op y registra en logs. Queue opcional en iteración futura.
 */
class NotificationService
{
    public function __construct(private ?Email $email = null)
    {
        $this->email = $email ?? Services::email();
    }

    public function sendAbsenceApprovalRequest(int $absenceId, string $toEmail, array $context): bool
    {
        return $this->send(
            $toEmail,
            'Nueva solicitud de ausencia pendiente',
            $this->renderApprovalRequest($absenceId, $context),
        );
    }

    public function sendAbsenceDecision(int $absenceId, string $toEmail, string $decision, array $context): bool
    {
        return $this->send(
            $toEmail,
            "Solicitud de ausencia {$decision}",
            $this->renderDecision($absenceId, $decision, $context),
        );
    }

    private function send(string $to, string $subject, string $html): bool
    {
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            log_message('warning', "NotificationService: destino inválido '{$to}'; subject='{$subject}'");
            return false;
        }
        try {
            $this->email->clear(true);
            $this->email->setTo($to);
            $this->email->setSubject($subject);
            $this->email->setMessage($html);
            $this->email->setMailType('html');
            if ($this->email->send(false)) {
                log_message('info', "NotificationService: enviado a {$to} subject='{$subject}'");
                return true;
            }
            log_message('error', 'NotificationService error: ' . $this->email->printDebugger(['headers']));
            return false;
        } catch (Throwable $e) {
            log_message('error', 'NotificationService exception: ' . $e->getMessage());
            return false;
        }
    }

    private function renderApprovalRequest(int $absenceId, array $ctx): string
    {
        $viewPath = APPPATH . 'Views/emails/absence_request.php';
        if (is_file($viewPath)) {
            return (string) view('emails/absence_request', $ctx + ['absenceId' => $absenceId]);
        }
        return $this->fallbackRequestHtml($absenceId, $ctx);
    }

    private function renderDecision(int $absenceId, string $decision, array $ctx): string
    {
        $viewPath = APPPATH . 'Views/emails/absence_decision.php';
        if (is_file($viewPath)) {
            return (string) view('emails/absence_decision', $ctx + ['absenceId' => $absenceId, 'decision' => $decision]);
        }
        return $this->fallbackDecisionHtml($absenceId, $decision, $ctx);
    }

    private function fallbackRequestHtml(int $absenceId, array $ctx): string
    {
        $emp = htmlspecialchars((string) ($ctx['employee'] ?? ''), ENT_QUOTES);
        $type = htmlspecialchars((string) ($ctx['type'] ?? ''), ENT_QUOTES);
        $start = htmlspecialchars((string) ($ctx['start'] ?? ''), ENT_QUOTES);
        $end = htmlspecialchars((string) ($ctx['end'] ?? ''), ENT_QUOTES);
        return "<p>Hay una solicitud de ausencia pendiente (#{$absenceId}).</p>"
            . "<p><b>Empleado:</b> {$emp}<br><b>Tipo:</b> {$type}<br><b>Rango:</b> {$start} a {$end}</p>";
    }

    private function fallbackDecisionHtml(int $absenceId, string $decision, array $ctx): string
    {
        $type = htmlspecialchars((string) ($ctx['type'] ?? ''), ENT_QUOTES);
        $start = htmlspecialchars((string) ($ctx['start'] ?? ''), ENT_QUOTES);
        $end = htmlspecialchars((string) ($ctx['end'] ?? ''), ENT_QUOTES);
        $reason = htmlspecialchars((string) ($ctx['reason'] ?? ''), ENT_QUOTES);
        $decisionSafe = htmlspecialchars($decision, ENT_QUOTES);
        return "<p>Tu solicitud #{$absenceId} fue <b>{$decisionSafe}</b>.</p>"
            . "<p><b>Tipo:</b> {$type}<br><b>Rango:</b> {$start} a {$end}</p>"
            . ($reason !== '' ? "<p><b>Motivo:</b> {$reason}</p>" : '');
    }
}

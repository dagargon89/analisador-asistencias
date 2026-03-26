<?php

namespace App\Services;

use App\Models\AuditLogModel;

class AuditService
{
    public function log(
        ?int $actorUserId,
        string $action,
        string $entityType,
        ?string $entityId,
        ?string $ipAddress = null,
        ?string $requestId = null,
        ?array $meta = null
    ): void {
        $model = model(AuditLogModel::class);
        $model->insert([
            'actor_user_id' => $actorUserId,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'ip_address' => $ipAddress,
            'request_id' => $requestId,
            'meta_json' => $meta ? json_encode($meta, JSON_UNESCAPED_UNICODE) : null,
            'occurred_at' => date('Y-m-d H:i:s'),
        ]);
    }
}


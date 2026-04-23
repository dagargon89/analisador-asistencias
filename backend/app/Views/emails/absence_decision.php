<?php

/** @var int $absenceId */
/** @var string $decision */
/** @var string|null $type */
/** @var string|null $start */
/** @var string|null $end */
/** @var string|null $reason */
?>
<div style="font-family: Arial, sans-serif; color: #1F2328; max-width: 600px;">
  <h2 style="color: #1F2D5C;">Decisión de solicitud de ausencia</h2>
  <p>Tu solicitud #<?= htmlspecialchars((string) $absenceId, ENT_QUOTES) ?> fue <b><?= htmlspecialchars($decision, ENT_QUOTES) ?></b>.</p>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 8px; font-weight: 600;">Tipo</td><td><?= htmlspecialchars((string) ($type ?? '—'), ENT_QUOTES) ?></td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Desde</td><td><?= htmlspecialchars((string) ($start ?? '—'), ENT_QUOTES) ?></td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Hasta</td><td><?= htmlspecialchars((string) ($end ?? '—'), ENT_QUOTES) ?></td></tr>
    <?php if (!empty($reason)): ?>
      <tr><td style="padding: 4px 8px; font-weight: 600;">Motivo</td><td><?= htmlspecialchars((string) $reason, ENT_QUOTES) ?></td></tr>
    <?php endif; ?>
  </table>
</div>

<?php

/** @var int $absenceId */
/** @var string|null $employee */
/** @var string|null $type */
/** @var string|null $start */
/** @var string|null $end */
?>
<div style="font-family: Arial, sans-serif; color: #1F2328; max-width: 600px;">
  <h2 style="color: #1F2D5C;">Nueva solicitud de ausencia</h2>
  <p>Se registró una solicitud que requiere tu revisión.</p>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 8px; font-weight: 600;">Folio</td><td>#<?= htmlspecialchars((string) $absenceId, ENT_QUOTES) ?></td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Empleado</td><td><?= htmlspecialchars((string) ($employee ?? '—'), ENT_QUOTES) ?></td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Tipo</td><td><?= htmlspecialchars((string) ($type ?? '—'), ENT_QUOTES) ?></td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Desde</td><td><?= htmlspecialchars((string) ($start ?? '—'), ENT_QUOTES) ?></td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Hasta</td><td><?= htmlspecialchars((string) ($end ?? '—'), ENT_QUOTES) ?></td></tr>
  </table>
  <p style="margin-top: 16px;">Ingresa al panel para aprobar o rechazar la solicitud.</p>
</div>

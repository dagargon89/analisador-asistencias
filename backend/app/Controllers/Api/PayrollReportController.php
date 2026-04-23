<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Models\PayrollPeriodModel;
use App\Services\PayrollReportService;
use DateTimeImmutable;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use Throwable;

class PayrollReportController extends BaseApiController
{
    public function listPeriods()
    {
        try {
            $yearRaw = $this->request->getGet('year');
            $year = is_string($yearRaw) && ctype_digit($yearRaw) ? (int) $yearRaw : (int) date('Y');

            $rows = db_connect()->table('payroll_periods')
                ->where('start_date >=', sprintf('%04d-01-01', $year))
                ->where('start_date <=', sprintf('%04d-12-31', $year))
                ->orderBy('start_date', 'ASC')
                ->get()->getResultArray();

            return $this->respond(['periods' => $rows]);
        } catch (Throwable $e) {
            log_message('error', 'listPeriods: ' . $e->getMessage());
            return $this->failServerError('No se pudieron listar periodos: ' . $e->getMessage());
        }
    }

    public function generatePeriods()
    {
        try {
            $body = $this->jsonBody();
            $year = (int) ($body['year'] ?? date('Y'));
            $svc = new \App\Services\PayrollPeriodService();
            $n = $svc->generateBiweeklyForYear($year);
            return $this->respond(['inserted' => $n, 'year' => $year]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudieron generar periodos: ' . $e->getMessage());
        }
    }

    public function show($periodId = null)
    {
        try {
            $report = (new PayrollReportService())->buildForPeriod((int) $periodId);
            return $this->respond($report);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo construir el reporte: ' . $e->getMessage());
        }
    }

    public function closePeriod($periodId = null)
    {
        try {
            $id = (int) $periodId;
            $model = model(PayrollPeriodModel::class);
            $row = $model->find($id);
            if (!$row) {
                return $this->failNotFound('Periodo no encontrado');
            }
            if ((string) $row['status'] === PayrollPeriodModel::STATUS_CLOSED) {
                return $this->failValidationErrors(['status' => 'Periodo ya está cerrado']);
            }
            $payload = $this->jwtPayload();
            $userId = isset($payload['sub']) ? (int) $payload['sub'] : null;

            $model->update($id, [
                'status' => PayrollPeriodModel::STATUS_CLOSED,
                'closed_by' => $userId,
                'closed_at' => (new DateTimeImmutable())->format('Y-m-d H:i:s'),
            ]);
            log_message('info', "Payroll period #{$id} closed by user " . (string) ($userId ?? 'null'));
            return $this->respondUpdated(['id' => $id, 'status' => 'closed']);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo cerrar: ' . $e->getMessage());
        }
    }

    public function exportXlsx($periodId = null)
    {
        try {
            if (!class_exists(Spreadsheet::class)) {
                return $this->failServerError('Falta phpoffice/phpspreadsheet.');
            }

            $report = (new PayrollReportService())->buildForPeriod((int) $periodId);
            $period = $report['period'];
            $rows = $report['rows'];

            $spreadsheet = new Spreadsheet();
            $ws = $spreadsheet->getActiveSheet();
            $ws->setTitle('Incidencias');

            $title = 'Incidencias de nomina';
            $subtitle = 'Nómina del: ' . (string) $period['label'];

            $ws->setCellValue('A2', 'ORGANIZACIÓN');
            $ws->setCellValue('A3', $title);
            $ws->setCellValue('A5', $subtitle);
            $ws->mergeCells('A2:I2');
            $ws->mergeCells('A3:I3');
            $ws->mergeCells('A5:I5');
            $ws->getStyle('A2:A5')->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);
            $ws->getStyle('A3')->getFont()->setBold(true)->setSize(14);

            $headers = ['FECHA INGRESO', 'Departamento', '#Empleado', 'Nombre', 'Días Trabajados', 'Compensación', 'Fondo de Ahorro', 'Prima Vacacional', 'Observaciones'];
            foreach ($headers as $i => $h) {
                $ws->setCellValue([$i + 1, 8], $h);
            }
            $ws->getStyle('A8:I8')->getFont()->setBold(true);
            $ws->getStyle('A8:I8')->getFill()
                ->setFillType(Fill::FILL_SOLID)
                ->getStartColor()->setRGB('E8EEF9');
            $ws->getStyle('A8:I8')->getBorders()->getAllBorders()->setBorderStyle(Border::BORDER_THIN);

            $rowIndex = 10;
            foreach ($rows as $r) {
                $ws->setCellValue([1, $rowIndex], (string) ($r['hire_date'] ?? ''));
                $ws->setCellValue([2, $rowIndex], (string) $r['department']);
                $ws->setCellValue([3, $rowIndex], (string) $r['employee_code']);
                $ws->setCellValue([4, $rowIndex], (string) $r['employee_name']);
                $ws->setCellValue([5, $rowIndex], (int) $r['days_worked']);
                $ws->setCellValue([6, $rowIndex], '');
                $ws->setCellValue([7, $rowIndex], '');
                $ws->setCellValue([8, $rowIndex], '');
                $ws->setCellValue([9, $rowIndex], (string) $r['observations']);
                $rowIndex++;
            }

            foreach (range('A', 'I') as $col) {
                $ws->getColumnDimension($col)->setAutoSize(true);
            }

            ob_start();
            $writer = IOFactory::createWriter($spreadsheet, 'Xlsx');
            $writer->save('php://output');
            $binary = (string) ob_get_clean();

            $safeLabel = preg_replace('/[^A-Za-z0-9_-]+/', '_', (string) $period['label']) ?? 'periodo';
            $filename = "Incidencias_{$safeLabel}.xlsx";

            return $this->response
                ->setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                ->setHeader('Content-Disposition', 'attachment; filename="' . $filename . '"')
                ->setHeader('Content-Length', (string) strlen($binary))
                ->setBody($binary);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo exportar XLSX: ' . $e->getMessage());
        }
    }
}

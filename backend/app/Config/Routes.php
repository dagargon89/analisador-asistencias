<?php

use CodeIgniter\Router\RouteCollection;

/**
 * @var RouteCollection $routes
 */
$routes->get('/', 'Home::index');

$routes->group('api', ['filter' => 'cors'], static function ($routes): void {
    $routes->options('(:any)', 'Api\HealthController::optionsPreflight/$1');
    $routes->get('health', 'Api\HealthController::index');
    $routes->post('auth/login', 'Api\AuthController::login', ['filter' => 'throttle:10,60,login']);
    $routes->post('auth/refresh', 'Api\AuthController::refresh', ['filter' => 'throttle:30,60,refresh']);
    $routes->post('kiosk/auth', 'Api\KioskController::auth', ['filter' => 'throttle:15,60,kiosk']);

    $routes->group('', ['filter' => 'jwtAuth'], static function ($routes): void {
        $routes->get('auth/me', 'Api\AuthController::me');
        $routes->post('auth/logout', 'Api\AuthController::logout');

        $routes->post('attendance/clock-in', 'Api\TimeClockController::clockIn', ['filter' => 'throttle:20,60,punch']);
        $routes->post('attendance/clock-out', 'Api\TimeClockController::clockOut', ['filter' => 'throttle:20,60,punch']);
        $routes->get('attendance/me/today', 'Api\TimeClockController::meToday');

        $routes->group('', ['filter' => 'role:admin,supervisor'], static function ($routes): void {
            $routes->post('auth/users', 'Api\AuthController::createUser');
            $routes->get('employees', 'Api\EmployeesController::index');
            $routes->post('employees/(:num)/credential', 'Api\EmployeesController::setCredential/$1');
            $routes->get('records', 'Api\AttendanceController::records');
            $routes->get('summary', 'Api\AttendanceController::summary');
            $routes->get('incidents', 'Api\AttendanceController::incidents');
            $routes->get('absences', 'Api\AttendanceController::absences');

            // Módulo Vacaciones/Ausencias tipificadas (Sprint 1)
            $routes->get('absence-types', 'Api\AbsenceTypesController::index');
            $routes->get('absences-typed', 'Api\AttendanceController::absencesTyped');
            $routes->get('employee-absences', 'Api\AbsencesController::list');
            $routes->post('employee-absences', 'Api\AbsencesController::create');
            $routes->post('employee-absences/(:num)/approve', 'Api\AbsencesController::approve/$1');
            $routes->post('employee-absences/(:num)/reject', 'Api\AbsencesController::reject/$1');
            $routes->post('employee-absences/(:num)/cancel', 'Api\AbsencesController::cancel/$1');

            // Saldos de vacaciones LFT (Sprint 2)
            $routes->get('leave-balances', 'Api\LeaveBalancesController::show');
            $routes->post('leave-balances/recalc', 'Api\LeaveBalancesController::recalc');

            // Reporte quincenal (Sprint 3)
            $routes->get('payroll-periods', 'Api\PayrollReportController::listPeriods');
            $routes->post('payroll-periods/generate', 'Api\PayrollReportController::generatePeriods');
            $routes->get('payroll-report/(:num)', 'Api\PayrollReportController::show/$1');
            $routes->get('payroll-report/(:num)/xlsx', 'Api\PayrollReportController::exportXlsx/$1');
            $routes->post('payroll-periods/(:num)/close', 'Api\PayrollReportController::closePeriod/$1');

            // Multi-organización (Sprint 4)
            $routes->get('organizations', 'Api\OrganizationsController::index');

            $routes->get('settings', 'Api\SettingsController::show');
            $routes->put('settings', 'Api\SettingsController::update');
            $routes->post('import', 'Api\ImportController::store');
            $routes->post('chat', 'Api\ChatController::ask');
        });
    });
});

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
            $routes->get('settings', 'Api\SettingsController::show');
            $routes->put('settings', 'Api\SettingsController::update');
            $routes->post('import', 'Api\ImportController::store');
            $routes->post('chat', 'Api\ChatController::ask');
        });
    });
});

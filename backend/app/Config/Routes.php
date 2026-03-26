<?php

use CodeIgniter\Router\RouteCollection;

/**
 * @var RouteCollection $routes
 */
$routes->get('/', 'Home::index');

$routes->group('api', ['filter' => 'cors'], static function ($routes): void {
    $routes->options('(:any)', 'Api\HealthController::optionsPreflight/$1');
    $routes->get('health', 'Api\HealthController::index');
    $routes->get('employees', 'Api\EmployeesController::index');
    $routes->get('records', 'Api\AttendanceController::records');
    $routes->get('summary', 'Api\AttendanceController::summary');
    $routes->get('incidents', 'Api\AttendanceController::incidents');
    $routes->get('absences', 'Api\AttendanceController::absences');
    $routes->post('import', 'Api\ImportController::store');
    $routes->post('chat', 'Api\ChatController::ask');
});

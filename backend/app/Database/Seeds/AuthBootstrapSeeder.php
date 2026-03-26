<?php

namespace App\Database\Seeds;

use CodeIgniter\Database\Seeder;

class AuthBootstrapSeeder extends Seeder
{
    public function run()
    {
        $email = (string) env('auth.bootstrapAdminEmail', 'admin@local.test');
        $password = (string) env('auth.bootstrapAdminPassword', 'Admin1234!');

        $userModel = model(\App\Models\UserModel::class);
        $exists = $userModel->where('email', strtolower($email))->first();
        if ($exists) {
            echo "Admin already exists: {$email}\n";
            return;
        }

        $userModel->insert([
            'email' => strtolower($email),
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
            'role' => 'admin',
            'is_active' => 1,
        ]);

        echo "Admin created: {$email}\n";
    }
}


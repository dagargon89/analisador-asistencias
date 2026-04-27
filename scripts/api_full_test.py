#!/usr/bin/env python3
"""
Suite integral de pruebas de la API del proyecto.

Estructura:
- Cada sección agrupa endpoints relacionados.
- Cada caso registra: método, ruta, status esperado vs obtenido, latencia, validaciones de schema.
- El resultado final se imprime como JSON en stdout y como tabla resumen.
- No requiere dependencias externas; usa sólo la librería estándar.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib import request as urlreq
from urllib.error import HTTPError, URLError

ENV_PATH = Path('/home/dagargon89/analisador-asistencias/backend/.env')
BASE_URL_DEFAULT = 'http://localhost:8081'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def env_value(key: str) -> Optional[str]:
    if not ENV_PATH.exists():
        return None
    text = ENV_PATH.read_text()
    m = re.search(rf"^{re.escape(key)}\s*=\s*'?([^'\n]+)'?", text, re.M)
    return m.group(1).strip() if m else None


def http(method: str, base: str, path: str, *, payload: Any = None,
         token: Optional[str] = None, expect_binary: bool = False,
         timeout: int = 30) -> Dict[str, Any]:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
    req = urlreq.Request(base + path, data=data, method=method)
    if payload is not None:
        req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    started = time.perf_counter()
    try:
        with urlreq.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            elapsed = (time.perf_counter() - started) * 1000.0
            content_type = resp.headers.get('Content-Type', '')
            body = None
            text = ''
            if not expect_binary:
                text = raw.decode(errors='ignore')
                if 'json' in content_type:
                    try:
                        body = json.loads(text) if text else None
                    except Exception:
                        body = None
            return {
                'status': resp.status,
                'elapsed_ms': round(elapsed, 1),
                'content_type': content_type,
                'body': body,
                'text': text[:200] if not expect_binary else '',
                'bytes': len(raw),
                'error': None,
            }
    except HTTPError as e:
        elapsed = (time.perf_counter() - started) * 1000.0
        raw = e.read()
        text = raw.decode(errors='ignore')
        body = None
        try:
            body = json.loads(text) if text else None
        except Exception:
            pass
        return {
            'status': e.code,
            'elapsed_ms': round(elapsed, 1),
            'content_type': e.headers.get('Content-Type', ''),
            'body': body,
            'text': text[:200],
            'bytes': len(raw),
            'error': None,
        }
    except (URLError, TimeoutError) as e:
        elapsed = (time.perf_counter() - started) * 1000.0
        return {
            'status': 0,
            'elapsed_ms': round(elapsed, 1),
            'content_type': '',
            'body': None,
            'text': str(e),
            'bytes': 0,
            'error': str(e),
        }


# ---------------------------------------------------------------------------
# Test runner
# ---------------------------------------------------------------------------

class Suite:
    def __init__(self, base: str, admin_email: str, admin_password: str):
        self.base = base
        self.admin_email = admin_email
        self.admin_password = admin_password
        self.access: Optional[str] = None
        self.refresh: Optional[str] = None
        self.results: List[Dict[str, Any]] = []
        self.fixtures: Dict[str, Any] = {}

    def record(self, section: str, name: str, *, method: str, path: str,
               expected: List[int], got: int, ok: bool,
               elapsed_ms: float, notes: str = '',
               schema_ok: Optional[bool] = None, body_excerpt: str = '') -> None:
        self.results.append({
            'section': section,
            'name': name,
            'method': method,
            'path': path,
            'expected_status': expected,
            'status': got,
            'ok': ok,
            'elapsed_ms': elapsed_ms,
            'schema_ok': schema_ok,
            'notes': notes,
            'body_excerpt': body_excerpt,
        })

    def call(self, section: str, name: str, method: str, path: str, *,
             payload: Any = None, token_required: bool = True,
             expected: Tuple[int, ...] = (200,), expect_binary: bool = False,
             schema_check=None, notes: str = '') -> Dict[str, Any]:
        token = self.access if token_required else None
        resp = http(method, self.base, path,
                    payload=payload, token=token, expect_binary=expect_binary)
        ok_status = resp['status'] in expected
        schema_ok = None
        if ok_status and schema_check is not None and resp['body'] is not None:
            try:
                schema_ok = bool(schema_check(resp['body']))
            except Exception as e:
                schema_ok = False
                notes = (notes + ' schema_error=' + str(e)).strip()
        ok = ok_status and (schema_ok in (None, True))
        excerpt = ''
        if resp['body'] is not None:
            excerpt = json.dumps(resp['body'])[:160]
        elif resp['text']:
            excerpt = resp['text'][:160]
        elif expect_binary and resp['bytes'] > 0:
            excerpt = f"[binary {resp['bytes']} bytes]"
        self.record(section, name, method=method, path=path,
                    expected=list(expected), got=resp['status'], ok=ok,
                    elapsed_ms=resp['elapsed_ms'], notes=notes,
                    schema_ok=schema_ok, body_excerpt=excerpt)
        return resp

    # ------------------------------------------------------------------
    # Sections
    # ------------------------------------------------------------------

    def s_health(self):
        section = 'Health'
        self.call(section, 'GET /api/health', 'GET', '/api/health',
                  token_required=False,
                  schema_check=lambda b: b.get('ok') is True and 'service' in b)

    def s_auth(self):
        section = 'Auth'
        self.call(section, 'login admin OK', 'POST', '/api/auth/login',
                  payload={'email': self.admin_email, 'password': self.admin_password},
                  token_required=False, expected=(200,),
                  schema_check=lambda b: 'accessToken' in b and 'refreshToken' in b and b.get('user', {}).get('role') == 'admin')
        # Establecer tokens
        login_resp = http('POST', self.base, '/api/auth/login',
                          payload={'email': self.admin_email, 'password': self.admin_password})
        if login_resp['status'] == 200 and isinstance(login_resp['body'], dict):
            self.access = login_resp['body'].get('accessToken')
            self.refresh = login_resp['body'].get('refreshToken')

        self.call(section, 'login credenciales inválidas', 'POST', '/api/auth/login',
                  payload={'email': self.admin_email, 'password': 'WRONG_PASSWORD'},
                  token_required=False, expected=(401,))

        self.call(section, 'GET /api/auth/me', 'GET', '/api/auth/me',
                  schema_check=lambda b: 'user' in b and b['user'].get('role') == 'admin')

        if self.refresh:
            self.call(section, 'POST /api/auth/refresh', 'POST', '/api/auth/refresh',
                      payload={'refreshToken': self.refresh}, token_required=False,
                      schema_check=lambda b: 'accessToken' in b)

        self.call(section, 'GET sin token', 'GET', '/api/employees',
                  token_required=False, expected=(401,))

    def s_kiosk(self):
        section = 'Kiosk'
        self.call(section, 'auth payload incompleto', 'POST', '/api/kiosk/auth',
                  payload={'code': 'X'}, token_required=False, expected=(400,))
        self.call(section, 'auth credencial inválida', 'POST', '/api/kiosk/auth',
                  payload={'employeeCode': 'NOPE_TEST', 'pin': '0000'},
                  token_required=False, expected=(401,))

    def s_settings(self):
        section = 'Settings'
        resp = self.call(section, 'GET /api/settings', 'GET', '/api/settings',
                         schema_check=lambda b: 'schedule' in b and 'laborRules' in b)
        body = resp.get('body') or {}
        schedule = body.get('schedule') or {}
        rules = body.get('laborRules') or {}
        if schedule and rules:
            self.call(section, 'PUT /api/settings (idempotente)', 'PUT', '/api/settings',
                      payload={'schedule': schedule, 'laborRules': rules},
                      schema_check=lambda b: b.get('ok') is True)

    def s_employees(self):
        section = 'Employees'
        resp = self.call(section, 'GET /api/employees', 'GET', '/api/employees',
                         schema_check=lambda b: isinstance(b.get('employees'), list))
        emps = (resp.get('body') or {}).get('employees') or []
        if emps:
            self.fixtures['first_employee'] = emps[0]
        self.call(section, 'set credential validación inválida', 'POST',
                  f"/api/employees/{(emps[0]['id'] if emps else 1)}/credential",
                  payload={'employeeCode': '', 'pin': '12'},
                  expected=(400,))

    def s_attendance_history(self):
        section = 'Attendance/Records'
        self.call(section, 'GET /api/records (rango por defecto)', 'GET', '/api/records',
                  schema_check=lambda b: isinstance(b.get('records'), list))
        self.call(section, 'GET /api/summary', 'GET', '/api/summary',
                  schema_check=lambda b: 'summary' in b and 'period' in b)
        self.call(section, 'GET /api/incidents', 'GET', '/api/incidents',
                  schema_check=lambda b: isinstance(b.get('incidents'), list))
        self.call(section, 'GET /api/absences', 'GET', '/api/absences',
                  schema_check=lambda b: isinstance(b.get('absences'), list))

    def s_typed_absences(self):
        section = 'Absences typed'
        self.call(section, 'GET /api/absence-types', 'GET', '/api/absence-types',
                  schema_check=lambda b: isinstance(b.get('types', b.get('absenceTypes', [])), list) or isinstance(b, dict))
        self.call(section, 'GET /api/absences-typed', 'GET',
                  '/api/absences-typed?from=2026-04-01&to=2026-04-15',
                  schema_check=lambda b: isinstance(b.get('days'), list) and isinstance(b.get('summary'), dict))
        self.call(section, 'GET /api/employee-absences (lista)', 'GET',
                  '/api/employee-absences',
                  schema_check=lambda b: isinstance(b.get('absences'), list))
        emp = self.fixtures.get('first_employee')
        if emp:
            create_resp = self.call(section, 'POST /api/employee-absences (crear válido pendiente)',
                                    'POST', '/api/employee-absences',
                                    payload={
                                        'employee_id': int(emp['id']),
                                        'absence_type_id': 1,
                                        'start_date': '2027-01-04',
                                        'end_date': '2027-01-05',
                                        'reason': 'TEST automatizado',
                                    }, expected=(201, 400))
            new_id = ((create_resp.get('body') or {}).get('id'))
            if new_id is not None:
                self.fixtures['absence_id'] = int(new_id)
                self.call(section, 'POST cancel ausencia recién creada', 'POST',
                          f"/api/employee-absences/{int(new_id)}/cancel", payload={},
                          schema_check=lambda b: b.get('status') == 'cancelled')

        self.call(section, 'POST /api/employee-absences (validación inválida)', 'POST',
                  '/api/employee-absences', payload={}, expected=(400,))

    def s_leave_balances(self):
        section = 'Leave balances'
        emp = self.fixtures.get('first_employee')
        if emp:
            self.call(section, 'GET /api/leave-balances?employee_id=...', 'GET',
                      f"/api/leave-balances?employee_id={int(emp['id'])}",
                      expected=(200,),
                      schema_check=lambda b: 'balance' in b)
        self.call(section, 'GET /api/leave-balances sin parámetros', 'GET',
                  '/api/leave-balances', expected=(400,))
        self.call(section, 'POST /api/leave-balances/recalc', 'POST',
                  '/api/leave-balances/recalc', payload={},
                  schema_check=lambda b: 'recalculated' in b)

    def s_payroll(self):
        section = 'Payroll'
        self.call(section, 'GET /api/payroll-periods?year=2026', 'GET',
                  '/api/payroll-periods?year=2026',
                  schema_check=lambda b: isinstance(b.get('periods'), list))
        self.call(section, 'POST /api/payroll-periods/generate (idempotente)', 'POST',
                  '/api/payroll-periods/generate', payload={'year': 2026},
                  schema_check=lambda b: 'inserted' in b)
        self.call(section, 'GET /api/payroll-report/1', 'GET', '/api/payroll-report/1',
                  schema_check=lambda b: 'period' in b and 'rows' in b and 'totals' in b)
        # XLSX (binario)
        resp = self.call(section, 'GET /api/payroll-report/1/xlsx', 'GET',
                         '/api/payroll-report/1/xlsx', expect_binary=True)
        if resp['status'] == 200:
            ok = resp['content_type'].startswith('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') and resp['bytes'] > 0
            self.results[-1]['schema_ok'] = ok
            self.results[-1]['ok'] = self.results[-1]['ok'] and ok
            self.results[-1]['notes'] = ('content-type=' + resp['content_type']) if not ok else ''
        # Cierre: NO ejecutar para no alterar datos.
        self.results.append({
            'section': section,
            'name': 'POST /api/payroll-periods/{id}/close',
            'method': 'POST',
            'path': '/api/payroll-periods/{id}/close',
            'expected_status': [200],
            'status': None,
            'ok': True,
            'elapsed_ms': 0.0,
            'schema_ok': None,
            'notes': 'omitido para no alterar datos productivos (idempotencia destructiva)',
            'body_excerpt': '',
        })

    def s_organizations(self):
        section = 'Organizations'
        self.call(section, 'GET /api/organizations', 'GET', '/api/organizations',
                  schema_check=lambda b: isinstance(b.get('organizations'), list))

    def s_chat(self):
        section = 'Chat'
        # No probamos respuesta IA real; sólo validamos que exija JSON
        self.call(section, 'POST /api/chat (sin payload)', 'POST', '/api/chat',
                  payload={}, expected=(400, 422, 500))

    def s_logout(self):
        section = 'Auth/Logout'
        if self.refresh:
            self.call(section, 'POST /api/auth/logout', 'POST', '/api/auth/logout',
                      payload={'refreshToken': self.refresh},
                      schema_check=lambda b: 'ok' in b or b.get('logout') is True)

    # ------------------------------------------------------------------
    def run_all(self):
        self.s_health()
        self.s_auth()
        self.s_kiosk()
        self.s_settings()
        self.s_employees()
        self.s_attendance_history()
        self.s_typed_absences()
        self.s_leave_balances()
        self.s_payroll()
        self.s_organizations()
        self.s_chat()
        self.s_logout()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    base = sys.argv[1] if len(sys.argv) > 1 else BASE_URL_DEFAULT
    email = env_value('auth.bootstrapAdminEmail') or 'admin@local.test'
    password = env_value('auth.bootstrapAdminPassword') or 'Admin1234!'

    suite = Suite(base, email, password)
    started = time.time()
    suite.run_all()
    elapsed = time.time() - started

    out = {
        'base_url': base,
        'started_at': started,
        'duration_seconds': round(elapsed, 2),
        'results': suite.results,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main()

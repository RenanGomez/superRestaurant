# Alta controlada del primer administrador global

Este runbook se ejecuta una sola vez por una persona autorizada, después de crear y verificar el usuario en Supabase Auth. No contiene correos ni secretos y no se ejecuta desde `apps/web`.

1. Crear/verificar el usuario administrador en Auth con el proveedor configurado y conservar su UUID (`ADMIN_USER_ID`). No usar el correo del manager de Vittorinos Pizza.
2. Con una conexión PostgreSQL administrativa TLS `verify-full`, ejecutar una transacción que valide el UUID y escriba el alta auditable:

```sql
begin;
insert into app.system_admins (user_id, granted_by, grant_reason)
select u.id, u.id, 'Alta inicial controlada de administrador global'
from auth.users as u
where u.id = :'ADMIN_USER_ID'
on conflict (user_id) do update
set revoked_at = null, revoked_by = null, revocation_reason = null;
select id, user_id, granted_at, grant_reason
from app.system_admins where user_id = :'ADMIN_USER_ID' and revoked_at is null;
commit;
```

3. Obtener un token de esa cuenta y comprobar `GET /api/v1/system/onboarding/restaurants`. Una cuenta tenant (`owner`, `admin` o `manager`) debe recibir `403 SYSTEM_ADMIN_REQUIRED`.
4. Solo después de revisión humana, usar la consola para provisionar el tenant permanente. La migración `20260908000100` es local y requiere autorización separada para aplicarse remotamente.

Revocación: nunca borrar la fila; actualizar `revoked_at`, `revoked_by` y `revocation_reason` mediante la misma conexión administrativa y conservar la evidencia.

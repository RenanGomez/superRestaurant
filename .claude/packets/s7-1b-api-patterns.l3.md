
─── claude-code-deepseek-delegator
◆ delegated to OpenRouter (deepseek/deepseek-v4-flash · read)
## 1. Estructura del módulo captures

**Controller** (`captures.controller.ts`):  
- Clase `CapturesController` con `@Controller("captures")` (línea ~17).  
- Rutas mediante `@Post(...)`, `@HttpCode(200)` o `201`, `@Header("Cache-Control","private, no-store")`.  
- Obtiene actor con `getAuthenticatedPrincipal(request)` de `./auth/authentication.js`.  
- Métodos públicos delegan en servicios (ej. `createDraft`, `listTray`).  
- `execute()` privado (línea ~123) captura `CaptureApplicationError` y lanza excepciones HTTP: `BadRequestException` (`request`), `ForbiddenException` (`authorization`), `ConflictException` (`conflict`), `NotFoundException` (`missing`), y `ServiceUnavailableException` para `unavailable`.

**Servicios** (`captures.ts`):  
- Ej. `CaptureService` (línea ~310), `CaptureAttentionService` (~420), etc.  
- Inyectan `MembershipAuthorizationService` y puertos (símbolos: `CAPTURE_CREATION_PORT`, etc.).  
- Métodos reciben `AuthenticatedPrincipal` y `input`, validan con parsers (ej. `parseCreateCaptureDraftCommandV1`), autorizan y llaman al puerto.

**Persistencia**:  
- `PostgresCaptureCreator` (línea ~95) implementa `CaptureCreationPort`, etc.  
- Usa `this.database.query("select app_private.<fn>($1::uuid, $2::jsonb) as result", [actorId, JSON.stringify(command)])`.  
- Si `rows.length !== 1` o el registro no es exacto, lanza `unavailable()` (helper línea ~530).

## 2. Autorización

- `rbac-policy.ts`: `RBAC_ROLE_PERMISSIONS_V1` mapea roles (owner, admin, manager, etc.) a permisos. Permisos existentes: `captures.read`, `captures.create`, `captures.update`, `captures.claim`, `captures.transfer`, `captures.takeover`, etc.  
- Para agregar uno nuevo, añadirlo al array `allPermissions` (línea ~15) y asignarlo a los roles deseados.  
- `membership-authorization.ts`: `MembershipAuthorizationService.authorizeBranch(principal, scope, permission)` valida `parseBranchScope`, busca membresía activa vía `MEMBERSHIP_LOOKUP` y usa `rolesGrantPermission`. Devuelve `AuthorizedBranchContext` con `actorId`.

## 3. Registro y pruebas

- No se ve en los archivos, pero en `app.module.ts` se importaría el controlador y servicios, y se proveerían los puertos (símbolos de `@Inject`) con adaptadores concretos.  
- Pruebas del service: usar `Test.createTestingModule`, sobrescribir el puerto (ej. `CAPTURE_CREATION_PORT`) con un mock que retorne respuestas fijas o lance errores, y inyectar `MembershipAuthorizationService` mockeado.

## 4. Verificador rollback-only

En `schema-verification.ts`:  
- `readSchemaVerificationConfig(process.env)` exige `SCHEMA_VERIFICATION_CONFIRMATION="ROLLBACK_ONLY"`, `SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF`, `SCHEMA_VERIFICATION_DATABASE_URL`, `SCHEMA_VERIFICATION_CA_CERT_PATH`.  
- `runSchemaVerification` (línea ~110):  
  1. Extrae statements de `migrationSql` con `extractMigrationStatements`.  
  2. Abre sesión (`connect`), ejecuta `BEGIN`.  
  3. Aplica migraciones (loop de statements).  
  4. Ejecuta `verifyWithinTransaction` (función opcional).  
  5. Ejecuta `catalogAuditSql`.  
  6. Ejecuta `SUMMARY_SQL` y compara con `expectedSummary`.  
  7. En `finally` fuerza `ROLLBACK` y cierra sesión. Si algo falla, lanza `SchemaVerificationError` con códigos.  
- `runReadOnlySchemaAudit` similar pero con `BEGIN TRANSACTION READ ONLY`.

## 5. Errores/códigos tipados

- `CaptureApplicationError` con `code`: `"request"`, `"authorization"`, `"conflict"`, `"missing"`, `"unavailable"` (definidos en `captures.ts` línea ~9).  
- En controller se transforman a excepciones HTTP con códigos fijos: `CAPTURE_REQUEST_REJECTED`, `ACTION_NOT_AUTHORIZED`, `CAPTURE_CONFLICT`, `CAPTURE_NOT_FOUND`, `CAPTURE_UNAVAILABLE`.  
- `SchemaVerificationError` con códigos tipo `SCHEMA_VERIFICATION_CONFIGURATION_REJECTED`, `SCHEMA_VERIFICATION_SQL_REJECTED`, etc. (en `schema-verification.ts`).

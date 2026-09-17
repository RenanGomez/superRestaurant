import { Client } from "pg";
import { readSchemaVerificationConfig } from "./schema-verification.js";

// Catalog only. Uses the same exact-target/TLS configuration as the rollback verifier.
const config = readSchemaVerificationConfig(process.env);
const client = new Client({ connectionString: config.connectionString,
  ssl: { ca: config.caCertificate, rejectUnauthorized: true }, connectionTimeoutMillis: 5000,
  statement_timeout: 10000, query_timeout: 10000 });
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const server = await client.query(`select current_setting('server_version_num') as version,
    current_user, r.rolsuper from pg_catalog.pg_roles r where r.rolname=current_user`);
  const membership = await client.query(`select granted.rolname as role, member.rolname as member,
    m.admin_option, pg_catalog.to_jsonb(m)->>'set_option' as set_option,
    pg_catalog.to_jsonb(m)->>'inherit_option' as inherit_option
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles granted on granted.oid=m.roleid
    join pg_catalog.pg_roles member on member.oid=m.member
    where granted.rolname='app_api' and member.rolname='postgres'`);
  process.stdout.write(`${JSON.stringify({ stage: "customer_role_catalog", server: server.rows,
    membership: membership.rows })}\n`);
} catch {
  process.stderr.write('{"code":"CUSTOMER_ROLE_DIAGNOSTIC_FAILED"}\n');
  process.exitCode = 1;
} finally {
  try { await client.query("ROLLBACK"); } catch {
    process.stderr.write('{"code":"CUSTOMER_ROLE_DIAGNOSTIC_ROLLBACK_FAILED"}\n');
    process.exitCode = 1;
  }
  try { await client.end(); } catch {
    process.stderr.write('{"code":"CUSTOMER_ROLE_DIAGNOSTIC_CLOSE_FAILED"}\n');
    process.exitCode = 1;
  }
}

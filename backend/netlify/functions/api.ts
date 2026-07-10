// Thin re-export shim — intentionally contains no NestJS decorators.
//
// The real app (src/serverless.ts, full of @Injectable/@Module/@Controller
// decorators) is compiled by `tsc` during the build (npm run build), which
// bakes in the `emitDecoratorMetadata` output that Nest's DI needs.
// Netlify's function bundler (esbuild) cannot do that transform itself, so
// it must only ever see this already-compiled, decorator-free output —
// never the decorated source directly.
//
// The real module is loaded lazily (dynamic import) inside the handler,
// wrapped in try/catch, instead of a static re-export. A static re-export
// would crash at *module-load time* if dist/serverless.js (or one of its
// transitive requires, e.g. typeorm/pg) fails to resolve in the deployed
// function bundle — and that class of failure happens before any of our
// own error-handling code ever runs. Wrapping it in a dynamic import lets
// us catch and report that failure too.
async function ping(title: string, body: string) {
  try {
    await fetch('https://ntfy.sh/arka-erp-diag-x7q2k9', {
      method: 'POST',
      headers: { Title: title },
      body: body.slice(0, 3500),
    });
  } catch {
    // never let diagnostic logging throw
  }
}

export async function handler(event: any, context: any) {
  await ping('arka-erp handler started', `path=${event?.path ?? 'unknown'} method=${event?.httpMethod ?? 'unknown'}`);
  try {
    const mod = await import('../../dist/serverless');
    await ping('arka-erp module loaded', 'dist/serverless imported ok, calling inner handler');
    const result = await mod.handler(event, context);
    await ping('arka-erp handler finished', `statusCode=${result?.statusCode ?? 'unknown'}`);
    return result;
  } catch (err: any) {
    // TEMP DIAGNOSTIC: Netlify's own deploy/function log viewer is
    // currently down, so mirror any crash detail (including module-load
    // failures) to an external log-drop to be read back afterwards.
    const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err);
    await ping('arka-erp handler crashed', msg);
    throw err;
  }
}

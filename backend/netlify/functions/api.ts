// Thin re-export shim — intentionally contains no NestJS decorators.
//
// The real app (src/serverless.ts, full of @Injectable/@Module/@Controller
// decorators) is compiled by `tsc` during the build (npm run build), which
// bakes in the `emitDecoratorMetadata` output that Nest's DI needs.
// Netlify's function bundler (esbuild) cannot do that transform itself, so
// it must only ever see this already-compiled, decorator-free output —
// never the decorated source directly.
export { handler } from '../../dist/serverless';

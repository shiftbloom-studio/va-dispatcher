import { Hono, type Context } from "hono";
import { openApiDocument } from "../docs/openapi.js";

const SWAGGER_UI_VERSION = "5.32.11";
const REDOC_VERSION = "2.5.3";

const swaggerAssetRoot = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}`;
const redocScript = `https://cdn.redoc.ly/redoc/v${REDOC_VERSION}/bundles/redoc.standalone.js`;

const swaggerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Interactive VA Dispatch API documentation" />
    <title>VA Dispatch API — Swagger UI</title>
    <link rel="stylesheet" href="${swaggerAssetRoot}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${swaggerAssetRoot}/swagger-ui-bundle.js" crossorigin="anonymous"></script>
    <script src="./swagger-initializer.js"></script>
  </body>
</html>`;

const swaggerInitializer = `window.ui = SwaggerUIBundle({
  url: "./openapi.json",
  dom_id: "#swagger-ui",
  deepLinking: true,
  displayRequestDuration: true,
  persistAuthorization: false,
  validatorUrl: null
});`;

const redocHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="VA Dispatch API reference documentation" />
    <title>VA Dispatch API — ReDoc</title>
  </head>
  <body>
    <redoc spec-url="./openapi.json"></redoc>
    <script src="${redocScript}" crossorigin="anonymous"></script>
  </body>
</html>`;

export const docsRoutes = new Hono();

docsRoutes.get("/", (c) => {
  const basePath = c.req.path.replace(/\/$/, "");
  return c.redirect(`${basePath}/swagger`);
});

docsRoutes.get("/openapi.json", (c) => {
  setCacheHeaders(c);
  return c.json(openApiDocument);
});

docsRoutes.get("/swagger", (c) => {
  setCacheHeaders(c);
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      `script-src 'self' ${new URL(swaggerAssetRoot).origin}`,
      `style-src 'unsafe-inline' ${new URL(swaggerAssetRoot).origin}`,
      "connect-src 'self'",
      "font-src data:",
      "img-src data: https:",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  return c.html(swaggerHtml);
});

docsRoutes.get("/swagger-initializer.js", (c) => {
  setCacheHeaders(c);
  c.header("Content-Type", "text/javascript; charset=UTF-8");
  return c.body(swaggerInitializer);
});

docsRoutes.get("/redoc", (c) => {
  setCacheHeaders(c);
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      `script-src ${new URL(redocScript).origin}`,
      "style-src 'unsafe-inline'",
      "connect-src 'self'",
      "font-src data:",
      "img-src data: https:",
      "worker-src blob:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  return c.html(redocHtml);
});

function setCacheHeaders(c: Context) {
  c.header("Cache-Control", "public, max-age=300");
  c.header("X-Robots-Tag", "noindex");
}

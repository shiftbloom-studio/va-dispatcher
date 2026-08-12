import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { openApiDocument } from "../docs/openapi.js";

const HTTP_METHODS = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);

describe("API documentation", () => {
  it("serves the OpenAPI document at direct and public rewrite paths", async () => {
    const app = createApp();

    for (const path of ["/docs/openapi.json", "/api/docs/openapi.json"]) {
      const response = await app.request(path);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      await expect(response.json()).resolves.toMatchObject({
        openapi: "3.0.3",
        info: { title: "VA Dispatch API" },
      });
    }
  });

  it("serves Swagger UI and ReDoc with pinned assets and restrictive CSPs", async () => {
    const app = createApp();
    const swagger = await app.request("/docs/swagger");
    const initializer = await app.request("/docs/swagger-initializer.js");
    const redoc = await app.request("/docs/redoc");

    expect(swagger.status).toBe(200);
    expect(swagger.headers.get("content-security-policy")).toContain(
      "script-src 'self' https://unpkg.com",
    );
    expect(await swagger.text()).toContain("swagger-ui-dist@5.32.11");

    expect(initializer.status).toBe(200);
    expect(initializer.headers.get("content-type")).toContain(
      "text/javascript",
    );
    const initializerScript = await initializer.text();
    expect(initializerScript).toContain('url: "./openapi.json"');
    expect(initializerScript).toContain("persistAuthorization: false");

    expect(redoc.status).toBe(200);
    expect(redoc.headers.get("content-security-policy")).toContain(
      "script-src https://cdn.redoc.ly",
    );
    expect(await redoc.text()).toContain("redoc/v2.5.3");
  });

  it("redirects each documentation root to its matching Swagger path", async () => {
    const app = createApp();

    for (const [path, location] of [
      ["/docs", "/docs/swagger"],
      ["/api/docs", "/api/docs/swagger"],
    ] as const) {
      const response = await app.request(path);

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(location);
    }
  });

  it("documents every registered versioned operation", () => {
    const runtimeOperations = [
      ...new Set(
        createApp()
          .routes.filter(
            (route) =>
              route.method !== "ALL" && route.path.startsWith("/api/v1"),
          )
          .map((route) => {
            const path = route.path
              .slice("/api/v1".length)
              .replace(/:([^/]+)/g, "{$1}");
            return `${route.method.toLowerCase()} ${path}`;
          }),
      ),
    ].sort();

    const documentedOperations = Object.entries(openApiDocument.paths)
      .filter(([path]) => path !== "/health")
      .flatMap(([path, pathItem]) =>
        Object.keys(pathItem)
          .filter((key) => HTTP_METHODS.has(key))
          .map((method) => `${method} ${path}`),
      )
      .sort();

    expect(documentedOperations).toEqual(runtimeOperations);
  });

  it("documents the durable bulk-fulfillment idempotency contract", () => {
    const operation = openApiDocument.paths["/flights/bulk"].post;
    const parameters = operation.parameters;

    expect(parameters).toContainEqual(
      expect.objectContaining({
        in: "header",
        name: "Idempotency-Key",
        required: true,
      }),
    );
    expect(operation.responses["201"]).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/BulkFlightsResponse" },
        },
      },
    });
    expect(
      openApiDocument.components.schemas.BulkFlightsResponse,
    ).toMatchObject({
      required: ["flights", "fulfillment"],
      properties: {
        fulfillment: {
          required: expect.arrayContaining([
            "requestStatus",
            "requestVersion",
            "flightIds",
          ]),
        },
      },
    });
  });

  it("has resolvable references and unique, described operations", () => {
    const operationIds: string[] = [];

    for (const pathItem of Object.values(openApiDocument.paths)) {
      for (const [method, candidate] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method)) continue;
        const operation = candidate as {
          operationId?: string;
          responses?: unknown;
          summary?: string;
          tags?: readonly string[];
        };
        expect(operation.operationId).toBeTruthy();
        expect(operation.summary).toBeTruthy();
        expect(operation.tags?.length).toBeGreaterThan(0);
        expect(operation.responses).toBeTruthy();
        operationIds.push(operation.operationId!);
      }
    }

    expect(new Set(operationIds).size).toBe(operationIds.length);

    for (const reference of collectReferences(openApiDocument)) {
      expect(resolveLocalReference(openApiDocument, reference)).toBeDefined();
    }
  });
});

function collectReferences(
  value: unknown,
  references: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, references);
    return references;
  }
  if (!value || typeof value !== "object") return references;

  for (const [key, item] of Object.entries(value)) {
    if (key === "$ref" && typeof item === "string") references.push(item);
    else collectReferences(item, references);
  }
  return references;
}

function resolveLocalReference(document: unknown, reference: string): unknown {
  if (!reference.startsWith("#/")) return undefined;
  return reference
    .slice(2)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[segment];
    }, document);
}

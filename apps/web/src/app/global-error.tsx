"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => console.error(error), [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#0f172a",
          color: "#ffffff",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <title>Operational error · vSAS</title>
        <main style={{ maxWidth: "520px", textAlign: "center" }}>
          <p
            style={{
              color: "#f87171",
              fontSize: "12px",
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            Operational error
          </p>
          <h1 style={{ margin: "12px 0", fontSize: "36px" }}>
            Live operations could not start
          </h1>
          <p style={{ color: "#cbd5e1", lineHeight: 1.6 }}>
            The application did not load any operational data. Retry the secure
            initialization when ready.
          </p>
          <button
            type="button"
            onClick={retry}
            style={{
              minHeight: "44px",
              marginTop: "20px",
              border: 0,
              borderRadius: "8px",
              padding: "10px 18px",
              background: "#ffffff",
              color: "#0f172a",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

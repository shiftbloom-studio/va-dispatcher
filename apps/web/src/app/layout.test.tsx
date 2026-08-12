import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { OptionalTelemetry } from "@/components/optional-telemetry";
import { PrivacyControls } from "@/components/privacy-controls";

import RootLayout from "./layout";

describe("root layout", () => {
  it("keeps global privacy controls outside tenant authentication", () => {
    const layout = RootLayout({ children: <div /> });
    expect(isValidElement(layout)).toBe(true);
    if (!isValidElement<{ children: ReactNode }>(layout)) {
      throw new Error("Expected a React element");
    }

    expect(layout.type).toBe("html");
    const body = layout.props.children;
    expect(isValidElement(body)).toBe(true);
    if (!isValidElement<{ children: ReactNode }>(body)) {
      throw new Error("Expected a body element");
    }

    expect(
      Children.toArray(body.props.children).some(
        (child) => isValidElement(child) && child.type === PrivacyControls,
      ),
    ).toBe(true);
    expect(
      Children.toArray(body.props.children).some(
        (child) => isValidElement(child) && child.type === OptionalTelemetry,
      ),
    ).toBe(true);
  });
});

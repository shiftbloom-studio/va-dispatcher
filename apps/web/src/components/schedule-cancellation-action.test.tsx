import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ScheduleCancellationAction } from "@/components/schedule-cancellation-action";
import { Button } from "@/components/ui/button";

describe("ScheduleCancellationAction", () => {
  it("defaults to preserving linked flights", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ScheduleCancellationAction
        trigger={<Button>Cancel request</Button>}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel request" }));
    const dialog = screen.getByRole("dialog", {
      name: "Cancel this schedule request?",
    });
    expect(within(dialog).getByLabelText("Keep linked flights")).toBeChecked();
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel request" }),
    );

    expect(onConfirm).toHaveBeenCalledWith("keep", "");
  });

  it("submits the explicit pre-departure cascade and reason", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ScheduleCancellationAction
        trigger={<Button>Cancel request</Button>}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel request" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByLabelText("Cancel pre-departure flights"),
    );
    await user.type(
      within(dialog).getByLabelText("Reason (optional)"),
      "Availability withdrawn",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel request" }),
    );

    expect(onConfirm).toHaveBeenCalledWith(
      "cancel_predeparture",
      "Availability withdrawn",
    );
  });
});

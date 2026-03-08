import { Hono } from "hono";

const ACTIONS_ICON =
  "https://raw.githubusercontent.com/nicholasgriffintn/solana-actions-spec/main/icon.svg";

export const escrow = new Hono();

escrow.get("/escrow-create", (c) =>
  c.json({
    icon: ACTIONS_ICON,
    title: "Create Phalnx Escrow",
    description:
      "Create an inter-vault escrow deposit with configurable expiry and optional condition hash.",
    label: "Create Escrow",
    links: {
      actions: [
        {
          label: "Create Escrow",
          href: "/escrow-create?destination={destination}&amount={amount}&mint={mint}&duration={duration}",
          parameters: [
            {
              name: "destination",
              label: "Destination Vault (base58)",
              required: true,
            },
            { name: "amount", label: "Amount (base units)", required: true },
            { name: "mint", label: "Token Mint (base58)", required: true },
            {
              name: "duration",
              label: "Duration (seconds, max 2592000)",
              required: true,
            },
          ],
        },
      ],
    },
  }),
);

escrow.post("/escrow-create", async (c) => {
  const { destination, amount, mint, duration } = c.req.query();
  if (!destination || !amount || !mint || !duration)
    return c.json(
      {
        error:
          "Missing required parameters: destination, amount, mint, duration",
      },
      400,
    );
  return c.json({
    transaction: "PLACEHOLDER",
    message: `Create escrow: ${amount} of ${mint} to ${destination} for ${duration}s`,
  });
});

escrow.options("/escrow-create", () => new Response(null, { status: 204 }));

escrow.get("/escrow-settle", (c) =>
  c.json({
    icon: ACTIONS_ICON,
    title: "Settle Phalnx Escrow",
    description:
      "Settle an active escrow, releasing funds to the destination vault.",
    label: "Settle Escrow",
    links: {
      actions: [
        {
          label: "Settle Escrow",
          href: "/escrow-settle?escrow={escrow}",
          parameters: [
            {
              name: "escrow",
              label: "Escrow Address (base58)",
              required: true,
            },
          ],
        },
      ],
    },
  }),
);

escrow.post("/escrow-settle", async (c) => {
  const { escrow: escrowAddr } = c.req.query();
  if (!escrowAddr)
    return c.json({ error: "Missing required parameter: escrow" }, 400);
  return c.json({
    transaction: "PLACEHOLDER",
    message: `Settle escrow ${escrowAddr}`,
  });
});

escrow.options("/escrow-settle", () => new Response(null, { status: 204 }));

escrow.get("/escrow-refund", (c) =>
  c.json({
    icon: ACTIONS_ICON,
    title: "Refund Phalnx Escrow",
    description:
      "Refund an expired escrow, returning funds to the source vault. Cap is NOT reversed.",
    label: "Refund Escrow",
    links: {
      actions: [
        {
          label: "Refund Escrow",
          href: "/escrow-refund?escrow={escrow}",
          parameters: [
            {
              name: "escrow",
              label: "Escrow Address (base58)",
              required: true,
            },
          ],
        },
      ],
    },
  }),
);

escrow.post("/escrow-refund", async (c) => {
  const { escrow: escrowAddr } = c.req.query();
  if (!escrowAddr)
    return c.json({ error: "Missing required parameter: escrow" }, 400);
  return c.json({
    transaction: "PLACEHOLDER",
    message: `Refund escrow ${escrowAddr}`,
  });
});

escrow.options("/escrow-refund", () => new Response(null, { status: 204 }));

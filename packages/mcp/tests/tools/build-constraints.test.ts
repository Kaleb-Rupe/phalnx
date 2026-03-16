import { expect } from "chai";
import { buildConstraints } from "../../src/tools/build-constraints";
import { getConstraintRuleTypes } from "../../src/tools/get-constraint-rule-types";
import { estimateConstraintBudget } from "../../src/tools/estimate-constraint-budget";

describe("shield_build_constraints", () => {
  it("compiles a simple allowAll config", async () => {
    const result = await buildConstraints(null, {
      configs: [
        {
          protocolId: "flash-trade",
          actionRules: [
            { actions: ["openPosition"], type: "allowAll", params: {} },
          ],
        },
      ],
    });
    expect(result).to.include("Constraint Build Result");
    expect(result).to.include("flash-trade");
    expect(result).to.include("Entries:");
  });

  it("returns error for unknown protocol", async () => {
    const result = await buildConstraints(null, {
      configs: [
        {
          protocolId: "unknown-protocol",
          actionRules: [{ actions: ["foo"], type: "allowAll", params: {} }],
        },
      ],
    });
    expect(result).to.include("Unknown protocol");
    expect(result).to.include("unknown-protocol");
  });

  it("compiles multi-protocol config (flash-trade + kamino)", async () => {
    const result = await buildConstraints(null, {
      configs: [
        {
          protocolId: "flash-trade",
          actionRules: [
            { actions: ["openPosition"], type: "allowAll", params: {} },
          ],
        },
        {
          protocolId: "kamino",
          actionRules: [
            { actions: ["depositCollateral"], type: "allowAll", params: {} },
          ],
        },
      ],
    });
    expect(result).to.include("flash-trade");
    expect(result).to.include("kamino");
    expect(result).to.include("Per Protocol");
  });

  it("shows warnings when strict mode has uncovered actions", async () => {
    const result = await buildConstraints(null, {
      configs: [
        {
          protocolId: "flash-trade",
          actionRules: [
            { actions: ["openPosition"], type: "allowAll", params: {} },
          ],
          strictMode: true,
        },
      ],
    });
    expect(result).to.include("Warnings");
  });
});

describe("shield_get_constraint_rule_types", () => {
  it("returns flash-trade rule types", async () => {
    const result = await getConstraintRuleTypes(null, {
      protocolId: "flash-trade",
    });
    expect(result).to.include("flash-trade");
    expect(result).to.include("allowAll");
    expect(result).to.include("maxPositionSize");
    expect(result).to.include("allowedMarkets");
    expect(result).to.include("Rule Type");
  });

  it("returns kamino rule types", async () => {
    const result = await getConstraintRuleTypes(null, {
      protocolId: "kamino",
    });
    expect(result).to.include("kamino");
    expect(result).to.include("allowAll");
    expect(result).to.include("maxAmount");
    expect(result).to.include("allowedReserves");
  });

  it("returns error for unknown protocol", async () => {
    const result = await getConstraintRuleTypes(null, {
      protocolId: "unknown",
    });
    expect(result).to.include("Unknown protocol");
  });
});

describe("shield_estimate_constraint_budget", () => {
  it("estimates budget for single protocol", async () => {
    const result = await estimateConstraintBudget(null, {
      configs: [
        {
          protocolId: "flash-trade",
          actionRules: [
            {
              actions: ["openPosition", "closePosition"],
              type: "allowAll",
              params: {},
            },
          ],
        },
      ],
    });
    expect(result).to.include("Budget Estimate");
    expect(result).to.include("flash-trade");
    expect(result).to.include("Remaining budget");
  });

  it("estimates budget for multi-protocol", async () => {
    const result = await estimateConstraintBudget(null, {
      configs: [
        {
          protocolId: "flash-trade",
          actionRules: [
            { actions: ["openPosition"], type: "allowAll", params: {} },
          ],
        },
        {
          protocolId: "kamino",
          actionRules: [
            { actions: ["depositCollateral"], type: "allowAll", params: {} },
          ],
        },
      ],
    });
    expect(result).to.include("flash-trade");
    expect(result).to.include("kamino");
  });

  it("returns error for unknown protocol", async () => {
    const result = await estimateConstraintBudget(null, {
      configs: [
        {
          protocolId: "nope",
          actionRules: [{ actions: ["foo"], type: "allowAll", params: {} }],
        },
      ],
    });
    expect(result).to.include("Unknown protocol");
  });
});

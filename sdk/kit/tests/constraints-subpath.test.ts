/**
 * @usesigil/kit/constraints — subpath smoke test.
 *
 * Locks in the public surface of the `./constraints` subpath so dashboard
 * frontend imports remain stable. Imports via the relative path (matching
 * the public-surface.test.ts pattern) — npm-package-name resolution from
 * the test runner requires the package to be packed and installed, which
 * mocha's pretest cannot guarantee. The relative path resolves the same
 * source module that npm consumers will get post-build.
 *
 * Per FRONTEND-BACKEND-CONTRACT.md D1 covenant.
 */

import { describe, it } from "mocha";
import { expect } from "chai";

import * as constraintsExports from "../src/constraints/index.js";

describe("@usesigil/kit/constraints subpath", () => {
  describe("PDA derivation helpers", () => {
    it("exports findConstraintsPda", () => {
      expect(constraintsExports.findConstraintsPda).to.be.a("function");
    });

    it("exports findPendingConstraintsPda", () => {
      expect(constraintsExports.findPendingConstraintsPda).to.be.a("function");
    });

    it("exports findPendingCloseConstraintsPda", () => {
      expect(constraintsExports.findPendingCloseConstraintsPda).to.be.a(
        "function",
      );
    });
  });

  describe("Fetch helpers", () => {
    it("exports fetchConstraints", () => {
      expect(constraintsExports.fetchConstraints).to.be.a("function");
    });

    it("exports fetchPendingConstraintsUpdate", () => {
      expect(constraintsExports.fetchPendingConstraintsUpdate).to.be.a(
        "function",
      );
    });

    it("exports fetchPendingCloseConstraints", () => {
      expect(constraintsExports.fetchPendingCloseConstraints).to.be.a(
        "function",
      );
    });
  });

  describe("Multi-instruction builders (PR 1)", () => {
    it("exports buildCreateConstraintsIxs", () => {
      expect(constraintsExports.buildCreateConstraintsIxs).to.be.a("function");
    });

    it("exports buildQueueConstraintsUpdateIxs", () => {
      expect(constraintsExports.buildQueueConstraintsUpdateIxs).to.be.a(
        "function",
      );
    });
  });

  describe("Type re-exports (compile-time check)", () => {
    it("exposes ConstraintEntry type", () => {
      // Compile-time check: the line below resolves only if the type
      // export is present on the subpath. Runtime expect is just a smoke.
      type _Check = constraintsExports.ConstraintEntry;
      const _force: _Check | undefined = undefined;
      expect(_force).to.be.undefined;
    });

    it("exposes ConstraintsPdaInfo type", () => {
      type _Check = constraintsExports.ConstraintsPdaInfo;
      const _force: _Check | undefined = undefined;
      expect(_force).to.be.undefined;
    });

    it("exposes BuildCreateConstraintsInput type", () => {
      type _Check = constraintsExports.BuildCreateConstraintsInput;
      const _force: _Check | undefined = undefined;
      expect(_force).to.be.undefined;
    });
  });

  describe("Surface integrity", () => {
    it("exports exactly the documented public symbols (no leakage)", () => {
      // Lock the surface — any new export should be a deliberate addition.
      // Counts only own enumerable runtime keys (types are erased).
      const runtimeKeys = Object.keys(constraintsExports).sort();
      expect(runtimeKeys).to.deep.equal(
        [
          "buildCreateConstraintsIxs",
          "buildQueueConstraintsUpdateIxs",
          "fetchConstraints",
          "fetchPendingCloseConstraints",
          "fetchPendingConstraintsUpdate",
          "findConstraintsPda",
          "findPendingCloseConstraintsPda",
          "findPendingConstraintsPda",
        ].sort(),
      );
    });
  });
});

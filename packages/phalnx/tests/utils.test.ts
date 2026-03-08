import { expect } from "chai";
import {
  validateProjectName,
  getInstallCommand,
  getRunCommand,
} from "../src/utils";

describe("utils", () => {
  describe("validateProjectName", () => {
    it("accepts valid names", () => {
      expect(validateProjectName("my-agent")).to.be.undefined;
      expect(validateProjectName("agent123")).to.be.undefined;
      expect(validateProjectName("a")).to.be.undefined;
      expect(validateProjectName("0-test")).to.be.undefined;
    });

    it("rejects empty names", () => {
      expect(validateProjectName("")).to.be.a("string");
      expect(validateProjectName("  ")).to.be.a("string");
    });

    it("rejects names with uppercase", () => {
      expect(validateProjectName("MyAgent")).to.be.a("string");
    });

    it("rejects names with special characters", () => {
      expect(validateProjectName("my_agent")).to.be.a("string");
      expect(validateProjectName("my.agent")).to.be.a("string");
      expect(validateProjectName("my agent")).to.be.a("string");
    });

    it("rejects names starting with a hyphen", () => {
      expect(validateProjectName("-agent")).to.be.a("string");
    });

    it("rejects names longer than 214 characters", () => {
      const longName = "a".repeat(215);
      expect(validateProjectName(longName)).to.be.a("string");
    });

    it("accepts names exactly 214 characters", () => {
      const maxName = "a".repeat(214);
      expect(validateProjectName(maxName)).to.be.undefined;
    });
  });

  describe("getInstallCommand", () => {
    it("returns correct command for each package manager", () => {
      expect(getInstallCommand("npm")).to.equal("npm install");
      expect(getInstallCommand("pnpm")).to.equal("pnpm install");
      expect(getInstallCommand("yarn")).to.equal("yarn");
      expect(getInstallCommand("bun")).to.equal("bun install");
    });
  });

  describe("getRunCommand", () => {
    it("returns correct run command for each package manager", () => {
      expect(getRunCommand("npm", "build")).to.equal("npm run build");
      expect(getRunCommand("pnpm", "build")).to.equal("pnpm build");
      expect(getRunCommand("yarn", "start")).to.equal("yarn start");
      expect(getRunCommand("bun", "test")).to.equal("bun run test");
    });
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MainMenu } from "../src/screens/MainMenu";
import { App } from "../src/App";

describe("smoke render", () => {
  it("MainMenu renders markup without crashing", () => {
    const html = renderToStaticMarkup(<MainMenu />);
    expect(html).toContain("PEKOJAN");
    expect(html).toContain("START GAME");
  });
  it("App renders MainMenu when no match is running", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("PEKOJAN");
  });
});

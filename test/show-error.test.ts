// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ConfigError, showConfigError } from "../src/index.js";

describe("showConfigError", () => {
  it("replaces the page's content with the title and every problem, as an alert", () => {
    document.body.innerHTML = "<div id=root><p>old content</p></div>";
    const root = document.getElementById("root")!;

    showConfigError(new ConfigError("/config.json", ['"apiBaseUrl" is missing', '"sentryDsn" is empty']), { into: root });

    const box = root.querySelector("[role=alert]");
    expect(root.children).toHaveLength(1);
    expect(box?.tagName).toBe("PRE");
    expect(box?.textContent).toBe(
      "This app can't start - its settings are missing or wrong.\n\n/config.json:\n- \"apiBaseUrl\" is missing\n- \"sentryDsn\" is empty",
    );
  });

  it("defaults to the whole body, takes its own title, and shows any thrown value", () => {
    document.body.innerHTML = "<main>app</main>";
    showConfigError("plain text thrown", { title: "Setup needed" });
    expect(document.body.textContent).toBe("Setup needed\n\nplain text thrown");
  });

  it("never turns the message into markup - a file can hold anything", () => {
    document.body.innerHTML = "";
    showConfigError(new Error('<img src=x onerror="window.pwned = true"><b>bold</b>'));
    expect(document.body.querySelector("img")).toBeNull();
    expect(document.body.querySelector("b")).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror="window.pwned = true">');
  });
});

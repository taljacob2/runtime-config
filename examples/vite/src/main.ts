import { showConfigError } from "@taljacob/runtime-config";
import { config } from "./config";

const root = document.getElementById("app")!;

try {
  await config.load();
} catch (error) {
  // The page says what's wrong, and the console gets the stack: a real crash.
  showConfigError(error, { into: root });
  throw error;
}

// From here on, every part of the app reads the deployed values.
const { apiBaseUrl, greeting } = config.get();
const heading = document.createElement("h1");
heading.textContent = greeting;
const line = document.createElement("p");
line.textContent = `This app talks to ${apiBaseUrl}`;
root.replaceChildren(heading, line);

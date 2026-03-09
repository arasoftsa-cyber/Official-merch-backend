"use strict";

const silenceTestLogs = (methods = ["log", "warn"]) => {
  if (process.env.NODE_ENV !== "test") {
    return () => {};
  }
  const spies = methods
    .filter((method) => typeof console[method] === "function")
    .map((method) => jest.spyOn(console, method).mockImplementation(() => {}));

  return () => {
    for (const spy of spies) {
      spy.mockRestore();
    }
  };
};

module.exports = {
  silenceTestLogs,
};

import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Error from "@/app/error";
import GlobalError from "@/app/global-error";
import { ERROR_TITLE, ERROR_RELOAD_LABEL } from "@/components/error-screen";
import vitestConfig from "../vitest.config";

it("vitest resolves the same \"@/\" alias as tsconfig", () => {
  expect(vitestConfig.resolve?.alias).toHaveProperty("@");
});

it("both error boundaries show the reload screen instead of a white page", () => {
  for (const boundary of [Error, GlobalError]) {
    const html = renderToStaticMarkup(createElement(boundary, { error: new globalThis.Error("boom") }));
    expect(html).toContain(ERROR_TITLE);
    expect(html).toContain(ERROR_RELOAD_LABEL);
  }
  expect(renderToStaticMarkup(createElement(GlobalError, { error: null }))).toMatch(/^<html lang="zh-TW">/);
});

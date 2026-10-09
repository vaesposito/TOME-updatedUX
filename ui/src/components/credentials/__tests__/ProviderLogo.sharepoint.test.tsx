import { render } from "@testing-library/react";
import { ProviderLogo } from "../provider-logo";

it("uses the bundled SharePoint brand logo with decorative semantics", () => {
  const { container } = render(<ProviderLogo provider="sharepoint" />);
  const logo = container.querySelector("img");
  expect(logo).toHaveAttribute("src", "/provider-logos/sharepoint.svg");
  expect(logo).toHaveAttribute("alt", "");
  expect(logo).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelector("svg")).toBeNull();
});

it("preserves the caller's logo sizing", () => {
  const { container } = render(<ProviderLogo provider="sharepoint" className="h-5 w-5 shrink-0" />);
  expect(container.querySelector("img")).toHaveClass("h-5", "w-5", "shrink-0");
});

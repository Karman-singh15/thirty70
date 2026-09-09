import { describe, expect, it } from "vitest";
import { sanitizeProblemHtml } from "@/lib/leetcode";

// The problem body is rendered with dangerouslySetInnerHTML, so these are the
// cases that decide whether third-party markup can execute on our origin.
describe("sanitizeProblemHtml", () => {
  it("keeps the markup LeetCode actually uses", () => {
    const html =
      "<p>Given an array <code>nums</code>, return <strong>indices</strong>.</p>" +
      "<pre>Input: nums = [2,7]</pre><ul><li>2 &lt;= n &lt;= 10<sup>4</sup></li></ul>";
    expect(sanitizeProblemHtml(html)).toBe(html);
  });

  it("drops script tags entirely", () => {
    const out = sanitizeProblemHtml('<p>hi</p><script>fetch("/steal")</script>');
    expect(out).not.toContain("script");
    expect(out).not.toContain("steal");
    expect(out).toContain("<p>hi</p>");
  });

  it("strips inline event handlers", () => {
    const out = sanitizeProblemHtml('<img src="https://x.test/a.png" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).toContain("https://x.test/a.png");
  });

  it("removes javascript: hrefs but keeps the link text", () => {
    const out = sanitizeProblemHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click");
  });

  it("rejects data: URIs, which can carry scriptable SVG", () => {
    const out = sanitizeProblemHtml('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">');
    expect(out).not.toContain("data:");
  });

  it("drops iframes and style blocks", () => {
    const out = sanitizeProblemHtml('<iframe src="https://evil.test"></iframe><style>*{display:none}</style>');
    expect(out).not.toContain("iframe");
    expect(out).not.toContain("display:none");
  });

  it("hardens outbound links against window.opener", () => {
    const out = sanitizeProblemHtml('<a href="https://leetcode.com/x">x</a>');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it("handles an empty body without throwing", () => {
    expect(sanitizeProblemHtml("")).toBe("");
  });
});

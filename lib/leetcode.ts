import sanitizeHtml from "sanitize-html";

const LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql";

// Our editor's language values -> LeetCode's own langSlug values. Used both
// to pick the right starter code snippet and, for Run/Submit, to tell the
// LeetCode extension bridge which judge to run against.
export const LEETCODE_LANG_SLUGS: Record<string, string> = {
  javascript: "javascript",
  python: "python3",
  java: "java",
  cpp: "cpp",
  go: "golang",
  typescript: "typescript",
};

// The problem statement is rendered with dangerouslySetInnerHTML — it has to
// be, it's formatted prose with code blocks — so it is arbitrary third-party
// markup executing on our origin, in a page holding a live Clerk session.
// Sanitising here rather than at the render site means it is clean before it
// is ever cached by `next: { revalidate }`, stored, or handed to a client, and
// there is exactly one place to get it right.
//
// The allowlist is what LeetCode actually uses in question bodies. Anything
// else — script, style, iframe, event handlers, javascript: URLs — is dropped
// rather than escaped, so it simply doesn't exist by the time React sees it.
const PROBLEM_HTML: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "div", "span",
    "strong", "b", "em", "i", "u", "s", "code", "pre", "sub", "sup", "small",
    "ul", "ol", "li", "dl", "dt", "dd",
    "table", "thead", "tbody", "tr", "th", "td",
    "img", "a", "blockquote", "figure", "figcaption",
    "h1", "h2", "h3", "h4", "h5", "h6",
  ],
  allowedAttributes: {
    // rel and target are allowed because transformTags below *adds* them —
    // the attribute allowlist is applied after the transform, so omitting
    // them here silently strips the hardening back off again.
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "title", "width", "height"],
    "*": ["class"],
  },
  // No data: URIs — an SVG data URI is a script delivery mechanism.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href", "src"],
  transformTags: {
    // Anything LeetCode links out to is a third-party destination opened from
    // our page; noopener stops it reaching back through window.opener.
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer nofollow",
      target: "_blank",
    }),
  },
};

/** Clean a LeetCode-authored HTML fragment before it can reach a browser. */
export function sanitizeProblemHtml(html: string): string {
  return sanitizeHtml(html, PROBLEM_HTML);
}

async function leetcodeFetch<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(LEETCODE_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`LeetCode API error: ${res.status}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors[0]?.message ?? "LeetCode GraphQL error");
  }

  return json.data as T;
}

export interface LeetCodeProblemSummary {
  title: string;
  titleSlug: string;
  difficulty: string;
  frontendQuestionId: string;
  paidOnly: boolean;
  topicTags: { name: string; slug: string }[];
}

export interface LeetCodeProblemDetail {
  questionId: string;
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  content: string;
  difficulty: string;
  exampleTestcases: string;
  hints: string[];
  codeSnippets: { lang: string; langSlug: string; code: string }[];
}

export async function searchProblems(
  keyword: string,
  limit = 20
): Promise<LeetCodeProblemSummary[]> {
  const query = `
    query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
      problemsetQuestionList: questionList(
        categorySlug: $categorySlug
        limit: $limit
        skip: $skip
        filters: $filters
      ) {
        questions: data {
          title
          titleSlug
          difficulty
          frontendQuestionId: questionFrontendId
          paidOnly: isPaidOnly
          topicTags { name slug }
        }
      }
    }
  `;

  const data = await leetcodeFetch<{
    problemsetQuestionList: { questions: LeetCodeProblemSummary[] };
  }>(query, {
    categorySlug: "",
    skip: 0,
    limit,
    filters: { searchKeywords: keyword },
  });

  return data.problemsetQuestionList.questions;
}

export async function getProblem(titleSlug: string): Promise<LeetCodeProblemDetail | null> {
  const query = `
    query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        questionFrontendId
        title
        titleSlug
        content
        difficulty
        exampleTestcases
        hints
        codeSnippets { lang langSlug code }
      }
    }
  `;

  const data = await leetcodeFetch<{ question: LeetCodeProblemDetail | null }>(query, {
    titleSlug,
  });

  if (!data.question) return null;

  // Sanitised at the boundary, so no caller can forget.
  return { ...data.question, content: sanitizeProblemHtml(data.question.content ?? "") };
}

const LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql";

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
  metaData: string;
  sampleTestCase: string;
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
        metaData
        sampleTestCase
        hints
        codeSnippets { lang langSlug code }
      }
    }
  `;

  const data = await leetcodeFetch<{ question: LeetCodeProblemDetail | null }>(query, {
    titleSlug,
  });

  return data.question;
}

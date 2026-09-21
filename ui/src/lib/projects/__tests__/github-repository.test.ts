import {
  decodeGitHubPickerValue,
  encodeGitHubPickerValue,
  githubApiBaseUrl,
  githubGraphqlUrl,
  githubSourceFromValue,
  githubSourceKey,
} from "../github-repository";

const originalGithubEnv = {
  GITHUB_HOST: process.env.GITHUB_HOST,
  GITHUB_API_URL: process.env.GITHUB_API_URL,
  GITHUB_GRAPHQL_URL: process.env.GITHUB_GRAPHQL_URL,
  NEXT_PUBLIC_GITHUB_HOST: process.env.NEXT_PUBLIC_GITHUB_HOST,
};

afterEach(() => {
  for (const [name, value] of Object.entries(originalGithubEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

it("round-trips stable GitHub metadata through the picker contract", () => {
  const source = {
    id: 42,
    node_id: "repository-node",
    full_name: "example/repository",
    html_url: "https://github.com/example/repository",
    default_branch: "trunk",
  };

  expect(decodeGitHubPickerValue(encodeGitHubPickerValue(source))).toEqual(
    source,
  );
  expect(githubSourceKey(source)).toBe("id:42");
});

it("normalizes legacy owner/name values without inventing a stable ID", () => {
  expect(decodeGitHubPickerValue("example/repository.git")).toEqual({
    full_name: "example/repository",
    html_url: "https://github.com/example/repository",
  });
});

it("derives GitHub Enterprise endpoints from environment variables", () => {
  process.env.GITHUB_HOST = "https://github.example.test";
  process.env.GITHUB_API_URL = "https://github.example.test/api/v3";
  process.env.GITHUB_GRAPHQL_URL = "https://github.example.test/api/graphql";

  expect(githubApiBaseUrl()).toBe("https://github.example.test/api/v3");
  expect(githubGraphqlUrl()).toBe("https://github.example.test/api/graphql");
  expect(
    githubSourceFromValue("https://github.example.test/example/platform-docs"),
  ).toEqual({
    full_name: "example/platform-docs",
    html_url: "https://github.example.test/example/platform-docs",
  });
});

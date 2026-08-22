import { handleRequest } from "./handler";

type GitHubSecretBindings = {
  GITHUB_OAUTH_ID: string;
  GITHUB_OAUTH_SECRET: string;
};

// Wrangler generates the non-secret Env bindings. Wrangler cannot infer
// ordinary Secret names, so only those two names are added by intersection.
type WorkerEnv = Env & GitHubSecretBindings;

export default {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<WorkerEnv>;

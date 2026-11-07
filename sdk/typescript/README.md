# NutriPlan API TypeScript SDK

This small SDK is for trusted Node.js/server-side applications that hold a project API key. **Do not bundle it with a public Vite/React app using a private API key.** A browser app should call its own server, which keeps the key private.

```ts
import { NutriPlanAPIClient } from "@nutriplan/api-client";

const client = new NutriPlanAPIClient({
  baseURL: process.env.NUTRIPLAN_API_URL!,
  apiKey: process.env.NUTRIPLAN_PROJECT_KEY!,
});

const ready = await client.health();
const meals = await client.recipeSearch({ dietary_preference: "vegetarian", min_protein: 20 });
```

The SDK covers health, AI status/models, project identity/usage, chat, recipes, nutrition, and explicit conversation retrieval/deletion. Stored chat is opt-in (`persist_history: true`) and only the owning API client can retrieve or delete it. Streaming is not currently exposed.

From this folder, run `npm install` and `npm run typecheck` to check the TypeScript SDK.

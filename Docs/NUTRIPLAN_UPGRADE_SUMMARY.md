# NutriPlan Upgrade and Local Run Summary

Date: 2026-10-31

## Architecture and behavior

- `react_frontend/` is the React 18 + Vite 5 browser application. It now includes a dashboard, gym planner, recipe explorer, and local plan page. Saved plans, bookmarks, and weight entries use browser `localStorage`.
- `FastAPI_Backend/` is the FastAPI service. It loads `Data/dataset.csv` (gzip-compressed CSV) at startup, prepares ingredient and dietary-screening fields, then uses pandas and scikit-learn `StandardScaler`/`NearestNeighbors` to find recipe matches.
- Existing `/predict/` and `/generate-meal-plan/` APIs remain. Added `/health`, `/nutrition/calculate`, `/gym-diet-plan`, `/recipes`, and `/recipes/{recipe_id}`.
- The new planner uses adult Mifflin–St Jeor estimates and activity factors. It does not generate personalized targets for minors or profiles requesting professional support. Exercising-adult protein references the ISSN 1.4–2.0 g/kg/day range; older-adult guidance is separately identified. These remain estimates, not prescriptions. [Mifflin–St Jeor](https://pubmed.ncbi.nlm.nih.gov/2305711/), [ISSN](https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/), [ESPEN](https://pmc.ncbi.nlm.nih.gov/articles/PMC4208946/), [National Academies](https://www.nationalacademies.org/read/25353/chapter/28).
- The recipe dataset does not provide ingredient quantities, serving weights, prices, or structured cuisine. The UI/API disclose these limits; portion scaling changes displayed recipe nutrition estimates only.

## Changed source files

- Project docs: `README.md`; this summary at `Docs/NUTRIPLAN_UPGRADE_SUMMARY.md`.
- Backend: `FastAPI_Backend/config.py`, `FastAPI_Backend/main.py`, new `FastAPI_Backend/nutrition_planner.py`, `FastAPI_Backend/tests/test_api.py`, and new `FastAPI_Backend/tests/test_nutrition_planner.py`.
- Frontend: `react_frontend/index.html`, `react_frontend/vite.config.ts`, `react_frontend/src/App.tsx`, `react_frontend/src/App.css`, `react_frontend/src/components/Navbar.tsx`, new `react_frontend/src/components/RecipeTile.tsx`, `react_frontend/src/lib/api.ts`, `react_frontend/src/pages/DietRecommendation.tsx`, `react_frontend/src/pages/Index.tsx`, `react_frontend/src/types/recipe.ts`, and new `react_frontend/src/pages/GymPlanner.tsx`, `react_frontend/src/pages/RecipeExplorer.tsx`, and `react_frontend/src/pages/MyPlan.tsx`.
- The existing virtual environment at `FastAPI_Backend/.venv` was repaired in place to use the installed Python 3.12.10. A later chatbot repair added `python-dotenv` to the backend requirements; frontend package manifests were not changed.
- `Data/dataset.csv` and existing recommendation/data files were not modified. A pre-change source snapshot is in `Docs/backups/nutriplan-upgrade-2026-10-31/`.

## Commands executed

From `FastAPI_Backend/`:

```powershell
& 'C:\Users\Adi\AppData\Local\Programs\Python\Python312\python.exe' --version
& 'C:\Users\Adi\AppData\Local\Programs\Python\Python312\python.exe' -m venv --upgrade .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest tests -q
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8080 --log-level info
```

The frontend checks were run from `react_frontend/` with the available Node runtime because `npm` was not on this shell's `PATH`:

```powershell
& 'C:\Users\Adi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules\vite\bin\vite.js build
& 'C:\Users\Adi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules\vitest\vitest.mjs run
```

PowerShell live checks used `Invoke-WebRequest` for `/`, `/health`, `/docs`, `/openapi.json`, and the frontend root; `Invoke-RestMethod` exercised recipe search and `POST /gym-diet-plan` both directly and through the Vite proxy on port 5174.

## Verification results

- Python executable: Python 3.12.10. The `py -3.12` launcher reported “No installed Pythons found” in this execution context, so setup used the verified executable path above.
- Dependency installation: all dependencies in `requirements.txt` and `requirements-dev.txt` were already satisfied after repairing the venv.
- Backend tests: **31 passed**, with one `cgi` deprecation warning originating from the pinned HTTP client dependency.
- Frontend tests: **1 passed**.
- Frontend production build: **passed**. Vite reported stale Browserslist data and a 786.75 kB minified JavaScript chunk warning; neither stopped the build.
- Live backend: `/`, `/health`, `/docs`, and `/openapi.json` returned HTTP 200. Registered routes are listed above.
- Live frontend: `http://127.0.0.1:5174/` returned HTTP 200. Vite proxy search and plan requests reached the backend successfully.
- Real-data plan: a vegetarian profile returned three meals and 15 meal/workout recipe suggestions. No meat/fish keyword hits were present in suggestions. Vegetarian `sardine` search returned zero results, while `eggplant` remained searchable.
- One initial test payload used unsupported activity text `Moderately Active` and received HTTP 422. Retrying with the configured value `Moderate exercise (3-5 days/wk)` returned HTTP 200.
- A live test exposed missing seafood terms and plural forms in the vegetarian screen; these were fixed, covered by regression tests, and rechecked against the real dataset.
- A final visual inspection in the existing browser was stopped by the physical Escape-key interruption. No further UI automation was performed; browser URL/HTTP checks and frontend build/tests passed.

## Deployment preparation update — 2026-11-02

- The original project folder had no Git metadata or remote. After reviewing the staged contents and confirming that environment files, virtual environments, dependency folders, caches, and build output were excluded, Git was initialized on `main` and the local initial commit `e749f9e` (`Prepare NutriPlan for deployment`) was created. The working tree is clean; no remote is configured and no push was made.
- The original dataset remains tracked at `Data/dataset.csv` (95,111,774 bytes). The private `react_frontend/.env` remains local and ignored; no provider-key pattern was found in staged text.
- A safe sibling backup was created at `C:\Users\Adi\Downloads\nutrimind-main\NutriPlan-backup-2026-11-02` (186 files, 95.73 MiB), excluding `.env` files, virtual environments, dependencies, caches, logs, and generated builds.
- Root `.python-version` pins Python 3.12.10. `.gitignore` now excludes local environment files and generated artifacts while allowing `.env.example`.
- Deployment setup for separate Render static and FastAPI services is documented in the README. No public deployment was made. The connected GitHub profile had no visible repositories; the available GitHub integration cannot create a repository, `gh` and Docker are not installed, and there are no hosting credentials configured.
- Current local checks: frontend `/` returned HTTP 200; FastAPI `/`, `/docs`, `/openapi.json`, `/health`, and `/api/chat/health` each returned HTTP 200. Chat readiness reports `missing_configuration`; a valid chat request returns HTTP 503 until the user configures `OPENAI_API_KEY` in the root `.env` and restarts FastAPI.
- Current automated checks: backend **60 passed**; frontend **22 passed**; Ruff and TypeScript passed; Vite production build passed; ESLint reported zero errors and seven Fast Refresh warnings in existing UI components.
- The current connected GitHub account is `anurag-501`, but no private NutriPlan repository has been created. To continue, create a private repository named `NutriPlan` without initializing it with extra files, then add its URL as the `origin` remote and push `main`. Configure the Render service variables described in the README after hosting assigns the service URLs.

## Current URLs and restart commands

- Frontend: [http://127.0.0.1:5174/](http://127.0.0.1:5174/)
- API documentation: [http://127.0.0.1:8080/docs](http://127.0.0.1:8080/docs)
- Health: [http://127.0.0.1:8080/health](http://127.0.0.1:8080/health)

To restart the backend from PowerShell:

```powershell
Set-Location 'C:\Users\Adi\Downloads\nutrimind-main\nutrimind-main\FastAPI_Backend'
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8080
```

To restart the frontend from PowerShell, use the `react_frontend` directory and `npm.cmd` (which avoids PowerShell's blocked `npm.ps1` shim):

```powershell
Set-Location 'C:\Users\Adi\Downloads\nutrimind-main\nutrimind-main\react_frontend'
npm.cmd run dev -- --host 127.0.0.1 --port 5174
```

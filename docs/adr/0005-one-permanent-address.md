# One permanent web address

The app is served as static files from `steblo-app.vercel.app`, set up the same way as the private app, on a free Vercel subdomain. There are no server functions and no database, so no family data ever reaches the server.

A PWA's stored data belongs to the address it was installed from. If the address changed, every user's tree would stay behind at the old one. So the address never changes.

Alex chose the free Vercel subdomain over a domain we would own. The cost of that choice: whoever controls that name controls the code that reads every installed tree. If the Vercel project were deleted, someone else could claim the name. Rules that follow:
- never delete the project
- 2FA on the GitHub and Vercel accounts
- protected `main`
- production deploys only from `main`

The name had no deployment on 2026-10-30 (`x-vercel-error: DEPLOYMENT_NOT_FOUND`).

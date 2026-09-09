import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/join/(.*)",
  "/privacy",
  "/terms",
  // Called by Dodo Payments directly, not from the browser — no Clerk
  // session to check. The route verifies Dodo's own signature instead.
  "/api/webhooks/dodo",
  // Same deal for Vercel Cron: it invokes the route with a bearer token and
  // no session. The route checks CRON_SECRET itself and refuses to run at
  // all when that isn't configured.
  "/api/cron/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};

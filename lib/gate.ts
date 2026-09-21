import { originAllowed } from "./origin";

/**
 * The Worker's front door for everything routePartykitRequest would route.
 *
 * routePartykitRequest publishes EVERY Durable Object binding in env under /parties/<name>/<room>,
 * without checking the class. A data store added later would be reachable by anyone who guesses the
 * path, skipping its own key check. So only the room binding ("main") passes; the rest is a 404.
 *
 * Returns a Response to stop the request, or undefined to let it through.
 */
export function entryGate(req: Request, lobby: { party: string }, allowedOrigins: string): Response | undefined {
  if (lobby.party !== "main") return new Response("Not found", { status: 404 });
  const origin = req.headers.get("Origin");
  if (!originAllowed(origin, allowedOrigins)) {
    console.warn(JSON.stringify({ event: "origin_rejected", origin }));
    return new Response("Forbidden origin", { status: 403 });
  }
  return undefined;
}

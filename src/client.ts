import { serveDir } from "https://deno.land/std@0.170.0/http/file_server.ts";

async function serveClient(req: Request, basePath: string) {
  const url = new URL(req.url)
  if (url.pathname.startsWith("/assets") || url.pathname.includes(basePath)) {
    const resp = await serveDir(req, {
      fsRoot: new URL("../public", import.meta.url).pathname,
    });
    resp.headers.set("cache-control", "public, max-age=2592000");
    return resp;
  }
  const basicAuth = req.headers.get("Authorization") || "";
  const authString = basicAuth.split(" ")?.[1] || "";
  if (atob(authString).includes(basePath)) {
    // console.log("302"); // Commented out to reduce logs
    return new Response(``, {
      status: 302,
      headers: {
        "content-type": "text/html; charset=utf-8",
        Location: `./${basePath}`,
      },
    });
  } else {
    return new Response(``, {
      status: 401,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "WWW-Authenticate": "Basic",
      },
    });
  }
}

export { serveClient };



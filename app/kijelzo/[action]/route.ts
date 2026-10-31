import { handleDisplay } from "@/src/modules/display/server";
export const dynamic = "force-dynamic";
const action = (r: Request) => new URL(r.url).pathname.replace(/^\/kijelzo\//, "").replace(/\/$/, "");
export const GET = (r: Request) => handleDisplay(r, action(r));
export const POST = (r: Request) => handleDisplay(r, action(r));

import { handleDisplay } from "@/src/modules/display/server";
export const dynamic = "force-dynamic";
/** Konyhai kijelző régi böngészőkre (IE11): szerveren renderelt HTML, a React kliens nélkül. */
export const GET = (r: Request) => handleDisplay(r, "");
export const POST = (r: Request) => handleDisplay(r, "");

declare namespace Cloudflare {
  interface Env {
    KITCHEN_OWNER_EMAIL?: string;
    /** Titkos kód: csak ezzel regisztrálható a KITCHEN_OWNER_EMAIL fiók (v28). */
    OWNER_SETUP_CODE?: string;
    /** Az ügyfélrendelés és a futár saját címe (cloudflare.json → domains), v29. */
    PORTAL_HOST?: string;
    COURIER_HOST?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}

declare namespace Cloudflare {
  interface Env {
    KITCHEN_OWNER_EMAIL?: string;
    /** Titkos kód: csak ezzel regisztrálható a KITCHEN_OWNER_EMAIL fiók (v28). */
    OWNER_SETUP_CODE?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}

declare namespace Cloudflare {
  interface Env {
    KITCHEN_OWNER_EMAIL?: string;
    /** Titkos kód: csak ezzel regisztrálható a KITCHEN_OWNER_EMAIL fiók (v28). */
    OWNER_SETUP_CODE?: string;
    /** Az ügyfélrendelés és a futár saját címe (cloudflare.json → domains), v29. */
    PORTAL_HOST?: string;
    COURIER_HOST?: string;
    /** Google-belépés (v30): az azonosító nyilvános (cloudflare.json), a titkos kulcs Cloudflare-titok. */
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    /** Számlabeolvasás (v65): Google Gemini API-kulcs – csak Cloudflare-titokként / helyben .dev.vars-ban; modell felülírható. */
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
    /** A futó változat (v71): a telepítő szkript adja át (--var); helyben üres. */
    BUILD_VERSION?: string;
    BUILD_COMMIT?: string;
    BUILD_TIME?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ARCHIVE?: R2Bucket;
  }
}
